import fs from 'node:fs';
import {POLICY_LIMITS} from './policy.mjs';

const BASE = 'https://alpha.pioneers.dev/api/v1';
export class GlmInference {
  constructor(config, {fetchImpl = fetch} = {}) { this.config = config; this.fetch = fetchImpl; }
  token() {
    let token;
    try { token = process.env.PIONEERS_API_KEY || (this.config.authTokenFile &&
      JSON.parse(fs.readFileSync(this.config.authTokenFile, 'utf8')).token); }
    catch { throw new Error('Pioneer credential unavailable'); }
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('Pioneer credential unavailable');
    return token;
  }
  async request(route, token, body, timeout) {
    let r;
    try {
      r = await this.fetch(BASE + route, {method: body ? 'POST' : 'GET', redirect: 'error',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        signal: AbortSignal.timeout(timeout), ...(body ? {body: JSON.stringify(body)} : {})});
    } catch { throw new Error('Pioneer request unavailable or timed out; no automatic replay'); }
    if (!r.ok) throw new Error(`Pioneer HTTP ${r.status}`);
    // Do not echo provider error bodies or arbitrary text into operator logs.
    const text = await r.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Oversized Pioneer response');
    try { return JSON.parse(text); } catch { throw new Error('Invalid Pioneer JSON response'); }
  }
  async propose({policy, rounds, reserve}) {
    const token = this.token();
    const models = await this.request('/models', token, undefined, 15000);
    const model = models.data?.find(m => m.id === this.config.model);
    if (!model || !/glm/i.test(model.id) || !Number.isFinite(model.context_window) ||
        !Number.isFinite(model.max_output_tokens)) throw new Error('Requested GLM capacity unavailable');
    const messages = [{role: 'system', content:
      'You tune a frost mage Arena bot between rounds. Return only JSON with exactly changes (object) and rationale (string <=1200 chars). ' +
      'Choose zero, one or two numeric parameter changes. Bounds are [min,max,max step from current]. ' +
      'Empty changes is valid when evidence is weak. Do not write code, commands, tools or new fields. ' +
      'These observations are not controlled comparisons: team lineups and opponents can change. ' +
      'Prefer reachable healers and low health kills, minimize LOS waste and idle time while preserving survival. ' +
      'Higher healerPriority favors healers, higher tankPenalty avoids tanks, higher focusStickiness reduces switching. ' +
      'preferredRange is maximum desired range, retreatRange minimum desired range, shieldHealth the health fraction to shield. ' +
      'finishHealth is the execute target threshold; focusWindowSeconds is time before reevaluating healed damage; ' +
      'losBackoffSeconds is initial LOS retry delay. Bounds: ' + JSON.stringify(POLICY_LIMITS)},
    {role: 'user', content: JSON.stringify({currentPolicy: policy, recentRounds: rounds.slice(-8)})}];
    const maxTokens = this.config.maxOutputTokens;
    // UTF-8 bytes plus template allowance conservatively reserve prompt tokens.
    const promptBound = Buffer.byteLength(JSON.stringify(messages)) + 2048;
    if (promptBound + maxTokens > model.context_window || maxTokens > model.max_output_tokens) throw new Error('GLM capacity too small');
    // Persist reservation BEFORE sending a paid request. Failure/crash consumes it, avoiding duplicate retries.
    reserve(promptBound + maxTokens);
    const response = await this.request('/chat/completions', token, {model: model.id, messages,
      max_tokens: maxTokens, temperature: 0.2, stream: false,
      chat_template_kwargs: {enable_thinking: false}}, 90000);
    if (response.model !== model.id || response.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete or unexpected GLM completion');
    const content = response.choices[0].message?.content;
    if (typeof content !== 'string' || content.length > 6000) throw new Error('Invalid GLM proposal');
    let proposal;
    try { proposal = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new Error('GLM proposal is not JSON'); }
    const usage = {};
    for (const k of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
      if (Number.isFinite(response.usage?.[k]) && response.usage[k] >= 0) usage[k] = response.usage[k];
    }
    return {proposal, model: model.id, usage};
  }
}
