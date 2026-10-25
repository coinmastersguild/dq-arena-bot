import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DEFAULT_POLICY, validatePolicy, validateProposal, summarizeRound} from './policy.mjs';
import {evaluatePolicy} from './policy-eval.mjs';
import {GlmInference} from './inference.mjs';
import {privateJson} from './recording.mjs';

export class Autonomy {
  constructor(client, {now = Date.now, inference} = {}) {
    this.client = client; this.config = client.config.autonomy; this.now = now;
    this.file = path.join(client.config.stateDirectory, 'autonomy.json');
    this.inference = inference || new GlmInference(this.config.inference);
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file)) : {
      schema: 1, revision: 0, active: {id: 'p0000', params: {...DEFAULT_POLICY}}, previous: null,
      rounds: [], seen: [], readyNotBefore: 0, review: null, paused: false, budget: {}, totalRounds: 0,
    };
    if (this.data.schema !== 1) throw new Error('Unsupported autonomy state');
    validatePolicy(this.data.active.params);
    if (this.data.previous) validatePolicy(this.data.previous.params);
    if (this.data.pending) validatePolicy(this.data.pending.params);
    // A request interrupted by a crash is never submitted again.
    if (this.data.review?.status === 'running') this.data.review.status = 'interrupted';
    this.client.controller.setPolicy(this.data.active.params); this.save();
    this.lastReady = 0;
  }
  save() { privateJson(this.file, this.data); }
  pause(value) { this.data.paused = value; this.save(); }
  summary() {
    return {enabled: true, paused: this.data.paused, policyId: this.data.active.id,
      totalRounds: this.data.totalRounds, readyNotBefore: this.data.readyNotBefore,
      review: this.data.review?.status ?? 'idle', inferenceEnabled: this.config.inference.enabled,
      budget: this.data.budget};
  }
  result(result, roundId) {
    if (this.data.seen.includes(roundId)) return;
    const summary = summarizeRound(result, this.client.name, this.data.active.id);
    if (!summary) return;
    this.data.totalRounds++;
    this.data.seen = [...this.data.seen, roundId].slice(-256);
    this.data.rounds = [...this.data.rounds, summary].slice(-50);
    this.data.readyNotBefore = this.now() + this.config.reviewSeconds * 1000;
    this.data.review = {roundId, status: 'queued'};
    // Severe observed failure of a trial restores its parent at the next lobby.
    if (this.data.previous && summary.aliveS >= 30 && summary.castCompletions === 0) {
      this.data.pending = {...this.data.previous, rollback: true};
      this.data.review.status = 'rollback';
    }
    this.save();
    this.client.diagnostic({type: 'autonomy-round', roundId, ...summary});
  }
  reserve(tokens) {
    const date = new Date(this.now()).toISOString().slice(0, 10);
    const b = this.data.budget.date === date ? this.data.budget : {date, requests: 0, reservedTokens: 0};
    const c = this.config.inference;
    if (b.requests >= c.requestsPerDay || b.reservedTokens + tokens > c.tokensPerDay) throw new Error('Daily inference limit reached');
    this.data.budget = {...b, requests: b.requests + 1, reservedTokens: b.reservedTokens + tokens};
    this.save();
  }
  async review() {
    if (this.busy || this.data.review?.status !== 'queued') return;
    if (!this.config.inference.enabled) { this.data.review.status = 'disabled'; this.save(); return; }
    const roundId = this.data.review.roundId;
    this.busy = true; this.data.review.status = 'running'; this.save();
    try {
      const response = await this.inference.propose({policy: this.data.active.params,
        rounds: this.data.rounds, reserve: n => this.reserve(n)});
      // A host-forced new fight/result can supersede this review; never apply a stale proposal.
      if (this.client.stopping || this.data.review.roundId !== roundId || this.client.controller.phase === 'fight' ||
          this.client.controller.phase === 'countdown') throw new Error('Review superseded by combat');
      const params = validateProposal(response.proposal, this.data.active.params);
      const gate = evaluatePolicy(params);
      const changed = JSON.stringify(params) !== JSON.stringify(this.data.active.params);
      if (changed) {
        const id = 'p' + String(++this.data.revision).padStart(4, '0');
        this.data.pending = {id, params};
        privateJson(path.join(this.client.config.stateDirectory, 'policies', `${id}.json`),
          {id, parent: this.data.active.id, params, roundId, model: response.model, usage: response.usage,
            rationale: response.proposal.rationale, gate, createdAt: new Date(this.now()).toISOString()});
      }
      this.data.review = {roundId, status: changed ? 'validated' : 'unchanged', model: response.model, usage: response.usage};
    } catch (error) {
      if (this.data.review.roundId === roundId) this.data.review = {roundId, status: 'failed'};
      // Error messages are code-owned: provider bodies and proposals never reach diagnostics.
      this.client.diagnostic({type: 'inference-skipped', message: error.message});
    } finally { this.busy = false; this.save(); }
  }
  tick() {
    const c = this.client, now = this.now();
    if (c.stopping || !c.state.connected || now - c.lastMessageAt > 15000) return;
    if (!['results', 'lobby'].includes(c.state.state)) return;
    if (!this.data.paused) void this.review();
    if (c.state.state !== 'lobby' || c.controller.phase !== 'lobby') return;
    const lobby = c.state.lobby;
    const entries = Object.entries(lobby?.sides || {});
    const mine = entries.find(([, slots]) => slots.some(p => p.you));
    if (!mine || (c.config.side && mine[0] !== c.config.side)) return;
    const slot = mine[1].find(p => p.you);
    if (this.data.paused || this.busy || now < this.data.readyNotBefore) {
      if (slot.ready && now - this.lastReady >= 3000) { c.send({t: 'cmd', cmd: 'ready', ready: false}); this.lastReady = now; }
      return;
    }
    if (this.data.pending) {
      // First obtain an unready lobby acknowledgement, preventing a queued start racing promotion.
      if (slot.ready) { c.send({t: 'cmd', cmd: 'ready', ready: false}); return; }
      c.controller.setPolicy(this.data.pending.params);
      const old = this.data.active;
      this.data.active = {id: this.data.pending.id, params: this.data.pending.params};
      this.data.previous = this.data.pending.rollback ? null : old;
      delete this.data.pending; this.save();
      c.diagnostic({type: 'policy-activated', policyId: this.data.active.id});
    }
    const opponent = entries.some(([side, slots]) => side !== mine[0] && slots.some(p => p.human));
    if (!slot.ready && opponent && now - this.lastReady >= 5000) {
      c.send({t: 'cmd', cmd: 'ready', ready: true}); this.lastReady = now;
    }
  }
}

export function resultId(result) {
  return createHash('sha256').update(JSON.stringify({winner: result.winner, players: result.players,
    duration: result.diagnostics?.durationS, score: result.score})).digest('hex').slice(0, 24);
}
