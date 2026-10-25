import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Autonomy, resultId} from '../src/autonomy.mjs';
import {CombatController} from '../src/controller.mjs';
import {DEFAULT_POLICY, POLICY_LIMITS, validateProposal, summarizeRound} from '../src/policy.mjs';
import {evaluatePolicy} from '../src/policy-eval.mjs';
import {loadConfig} from '../src/config.mjs';

function harness(t, inference) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-autonomy-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  let time = 1700000000000;
  const sent = [], diagnostics = [];
  const config = loadConfig(); config.stateDirectory = directory;
  config.side = 'freehold'; config.autonomy.enabled = true; config.autonomy.inference.enabled = true;
  const client = {config, name: 'OwnBot', lastMessageAt: time,
    state: {connected: true, state: 'lobby', lobby: {sides: {
      freehold: [{you: true, human: true, ready: false}], coinfall: [{human: true}]} }},
    controller: new CombatController({send() {}}), diagnostic: d => diagnostics.push(d), send: m => sent.push(m)};
  const now = () => time;
  const a = new Autonomy(client, {now, inference: inference || {propose: async ({reserve}) => {
    reserve(10000); return {proposal: {changes: {preferredRange: 26}, rationale: 'Reduce approaches'}, model: 'glm-test', usage: {total_tokens: 500}};
  }}});
  const result = {winner: 'freehold', diagnostics: {durationS: 60}, players: [{name: 'OwnBot', human: true,
    side: 'freehold', damage: 500, deaths: 0, metrics: {aliveS: 60, castCompletions: 6, errors: {}}}]};
  return {a, client, sent, result, now, advance: ms => { time += ms; client.lastMessageAt = time; }};
}
test('proposal rejects arbitrary fields, unbounded changes and oversized steps', () => {
  for (const changes of [{shell: 'rm'}, {preferredRange: 90}, {preferredRange: 22},
    {preferredRange: 26, retreatRange: 11, shieldHealth: 0.6}, JSON.parse('{"__proto__": 4}')]) {
    assert.throws(() => validateProposal({changes, rationale: ''}, DEFAULT_POLICY));
  }
  assert.throws(() => validateProposal({changes: {}, rationale: '', command: 'x'}, DEFAULT_POLICY));
  assert.equal(validateProposal({changes: {preferredRange: 26}, rationale: ''}, DEFAULT_POLICY).preferredRange, 26);
});
test('all single-parameter boundary policies retain cast legality', () => {
  for (const [key, [min, max]] of Object.entries(POLICY_LIMITS)) {
    for (const value of [min, max]) assert.equal(evaluatePolicy({...DEFAULT_POLICY, [key]: value}).passed, true);
  }
});
test('result summary excludes arbitrary text, identities and nested credentials', () => {
  const r = {winner: 'freehold', diagnostics: {durationS: 50}, players: [{human: true, name: 'secret-name',
    side: 'freehold', cookie: 'secret-cookie', metrics: {errors: {'injected prompt': 100, 'Line of sight.': 2}}}]};
  const s = summarizeRound(r, 'secret-name', 'p0000');
  assert.equal(s.losErrors, 2);
  assert.doesNotMatch(JSON.stringify(s), /secret|injected|cookie/);
});
test('result dedup persists across restart and five-minute wait precedes ready', async t => {
  const h = harness(t); const id = resultId(h.result);
  h.a.result(h.result, id); h.a.result(h.result, id);
  assert.equal(h.a.data.totalRounds, 1);
  await h.a.review(); h.a.tick(); assert.equal(h.sent.length, 0);
  const resumed = new Autonomy(h.client, {now: h.now}); resumed.result(h.result, id);
  assert.equal(resumed.data.totalRounds, 1);
  h.advance(300001); resumed.tick();
  assert.equal(h.client.controller.policy.preferredRange, 26);
  assert.equal(h.sent.at(-1).ready, true);
});
test('new policies never promote during countdown or combat, or while server still reports ready', async t => {
  const h = harness(t); h.a.result(h.result, 'round'); await h.a.review(); h.advance(300001);
  for (const state of ['countdown', 'fight']) {
    h.client.state.state = state; h.client.controller.phase = state; h.a.tick();
    assert.equal(h.a.data.active.id, 'p0000'); assert.equal(h.sent.length, 0);
  }
  h.client.state.state = 'lobby'; h.client.controller.phase = 'lobby';
  h.client.state.lobby.sides.freehold[0].ready = true; h.a.tick();
  assert.equal(h.sent.at(-1).ready, false); assert.equal(h.a.data.active.id, 'p0000');
});
test('failed inference preserves the active policy and does not block subsequent rounds', async t => {
  let calls = 0;
  const h = harness(t, {propose: async ({reserve}) => { calls++; reserve(5000); throw new Error('Pioneer HTTP 429'); }});
  h.a.result(h.result, 'round'); await h.a.review(); await h.a.review();
  assert.equal(calls, 1); assert.equal(h.a.data.budget.requests, 1);
  h.advance(300001); h.a.tick(); assert.equal(h.sent.at(-1).ready, true);
  assert.equal(h.a.data.active.id, 'p0000');
});
test('daily reservations are durable, reject over-cap requests and roll over by UTC date', t => {
  const h = harness(t); h.client.config.autonomy.inference.requestsPerDay = 1;
  h.a.reserve(5000); assert.throws(() => h.a.reserve(5000));
  const resumed = new Autonomy(h.client, {now: h.now}); assert.throws(() => resumed.reserve(5000));
  h.advance(86400000); resumed.reserve(5000); assert.equal(resumed.data.budget.requests, 1);
});
test('crash during inference is not replayed on restart', t => {
  const h = harness(t); h.a.data.review = {roundId: 'round', status: 'running'}; h.a.save();
  const resumed = new Autonomy(h.client, {now: h.now}); assert.equal(resumed.data.review.status, 'interrupted');
});
test('manual pause, absent opponent and stale connection suppress automatic readiness', t => {
  const h = harness(t); h.a.pause(true); h.a.tick(); assert.equal(h.sent.length, 0);
  h.a.pause(false); h.client.lastMessageAt -= 20000; h.a.tick(); assert.equal(h.sent.length, 0);
  h.advance(1); h.client.state.lobby.sides.coinfall = []; h.a.tick(); assert.equal(h.sent.length, 0);
});
test('zero completed casts while alive for thirty seconds rolls trial back in the next lobby', async t => {
  const h = harness(t); h.a.result(h.result, 'round1'); await h.a.review(); h.advance(300001); h.a.tick();
  assert.equal(h.a.data.active.id, 'p0001');
  h.result.players[0].metrics.castCompletions = 0; h.a.result(h.result, 'round2');
  assert.equal(h.a.data.review.status, 'rollback'); h.advance(300001); h.a.tick();
  assert.equal(h.a.data.active.id, 'p0000'); assert.equal(h.client.controller.policy.preferredRange, 27);
});
