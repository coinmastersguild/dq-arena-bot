import test from 'node:test';
import assert from 'node:assert/strict';
import {readyGate, finishRound} from '../src/tournament.mjs';
const now = Date.parse('2026-10-25T00:15:00Z');
const tournament = {rounds: [], roundLimit: 5, improvementSeconds: 300, readyNotBefore: new Date(now).toISOString(),
  account: 'BotA', opponent: 'BotB', side: 'freehold'};
const lobby = {connected: true, state: 'lobby', name: 'BotA', side: 'freehold', runDirectory: '/run/one',
  updatedAt: new Date(now).toISOString(), lobby: {sides: {freehold: [{human: true, name: 'BotA'}], coinfall: [{human: true, name: 'BotB'}]}}};
test('readiness requires elapsed improvement window, fresh lobby, and opposing player', () => {
  assert.equal(readyGate(tournament, lobby, now), null);
  assert.match(readyGate(tournament, lobby, now - 1), /window/);
  assert.match(readyGate(tournament, {...lobby, updatedAt: '2020-01-01'}, now), /stale/);
  assert.match(readyGate(tournament, {...lobby, lobby: {sides: {freehold: []}}}, now), /opponent/);
  assert.match(readyGate({...tournament, rounds: Array(5)}, lobby, now), /complete/);
});
test('record only active run once and open a five-minute improvement window', () => {
  const active = {...tournament, activeRun: '/run/one'};
  const result = {state: 'results', winner: 'freehold', diagnostics: {durationS: 90}, players: [
    {human: true, name: 'BotA', side: 'freehold', damage: 100, metrics: {}},
    {human: true, name: 'BotB', side: 'coinfall', damage: 50}]};
  const next = finishRound(active, result, '/run/one', '0.4.0', now);
  assert.equal(next.rounds[0].outcome, 'win'); assert.equal(next.activeRun, null);
  assert.equal(Date.parse(next.readyNotBefore) - now, 300000);
  assert.throws(() => finishRound(next, result, '/run/one', '0.4.0', now), /active/);
});
