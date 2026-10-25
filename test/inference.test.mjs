import test from 'node:test';
import assert from 'node:assert/strict';
import {GlmInference} from '../src/inference.mjs';
import {DEFAULT_POLICY} from '../src/policy.mjs';

function mock(config = {}) {
  const calls = [];
  const c = new GlmInference({model: 'glm-5.3-flash-local', maxOutputTokens: 1024, ...config}, {fetchImpl: async (url, init) => {
    calls.push({url, init});
    return new Response(JSON.stringify(url.endsWith('/models') ? {data: [{id: 'glm-5.3-flash-local', context_window: 524288, max_output_tokens: 16384}]} :
      {model: 'glm-5.3-flash-local', choices: [{finish_reason: 'stop', message: {content: '{"changes":{},"rationale":"Keep baseline"}'}}], usage: {total_tokens: 200}}));
  }});
  c.token = () => 'test-token'; return {c, calls};
}
test('discovers capacity, pins GLM and reserves budget before the one paid request', async () => {
  const {c, calls} = mock(); let reserved = false;
  const r = await c.propose({policy: DEFAULT_POLICY, rounds: [], reserve: n => {
    assert.equal(calls.length, 1); assert.ok(n > 1024); reserved = true;
  }});
  assert.equal(reserved, true); assert.equal(calls.length, 2); assert.deepEqual(r.proposal.changes, {});
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.model, 'glm-5.3-flash-local'); assert.equal(payload.max_tokens, 1024);
  assert.equal(calls[1].init.redirect, 'error'); assert.equal(payload.stream, false);
});
test('budget rejection prevents paid request; missing capacity never falls back', async () => {
  const {c, calls} = mock();
  await assert.rejects(c.propose({policy: DEFAULT_POLICY, rounds: [], reserve: () => { throw new Error('cap'); }}), /cap/);
  assert.equal(calls.length, 1);
  const missing = mock({model: 'glm-unknown'});
  await assert.rejects(missing.c.propose({policy: DEFAULT_POLICY, rounds: [], reserve() { assert.fail(); }}), /capacity/);
  assert.equal(missing.calls.length, 1);
});
test('provider error bodies never enter errors and failed generation is not retried', async () => {
  const {c} = mock(); const original = c.fetch; let posts = 0;
  c.fetch = (url, init) => { if (init.method !== 'POST') return original(url, init); posts++; return new Response('secret provider body', {status: 429}); };
  await assert.rejects(c.propose({policy: DEFAULT_POLICY, rounds: [], reserve() {}}), /Pioneer HTTP 429/);
  assert.equal(posts, 1);
});
