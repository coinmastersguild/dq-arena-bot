import test from 'node:test';
import assert from 'node:assert/strict';
import {Navigator} from '../src/navigation.mjs';

test('calibration uses measured displacement and stops the probe', () => {
  const nav = new Navigator(); const target = {x: 0, z: 100};
  assert.equal(nav.plan({x: 0, z: 0}, target, 0).forward, 1);
  assert.equal(nav.plan({x: 0, z: 1}, target, 6).forward, 0);
  assert.equal(nav.offset, 0);
});
test('stationary movement exhausts four attempts, pauses, then retries instead of abandoning the match', () => {
  const diagnostics = [], nav = new Navigator({onDiagnostic: d => diagnostics.push(d)}); nav.offset = 0;
  const me = {x: 4561.7, z: -947.61, f: -1.6}, target = {x: 4500, z: -950};
  const headings = [];
  for (let tick = 0; tick <= 400 && !nav.blocked; tick += 4) headings.push(nav.plan(me, target, tick));
  assert.equal(diagnostics.filter(d => d.type === 'navigation-recovery').length, 4);
  assert.equal(nav.blocked, true);
  assert.equal(headings.at(-1).forward, 0);
  assert.ok(new Set(headings.map(h => h.facing)).size >= 4);
  assert.equal(nav.plan(me, target, nav.blockedUntil - 1).forward, 0);
  assert.equal(nav.plan(me, target, nav.blockedUntil).forward, 1);
  assert.ok(diagnostics.some(d => d.type === 'navigation-retry'));
});
test('movement around a stationary goal without approach progress triggers recovery', () => {
  const diagnostics = [], nav = new Navigator({onDiagnostic: d => diagnostics.push(d)}); nav.offset = 0;
  for (let tick = 0; tick <= 324; tick += 4) {
    const a = tick / 20;
    nav.plan({x: 40 * Math.sin(a), z: 40 * Math.cos(a)}, {id: 9, x: 0, z: 0}, tick);
  }
  assert.ok(diagnostics.some(d => d.reason === 'no approach progress'));
  assert.deepEqual(diagnostics.filter(d => d.reason === 'no approach progress').map(d => d.attempt), [1, 2]);
});
test('pause time and a moving goal do not falsely count as failed approach', () => {
  const diagnostics = [], nav = new Navigator({onDiagnostic: d => diagnostics.push(d)}); nav.offset = 0;
  nav.plan({x: 0, z: 0}, {id: 9, x: 0, z: 40}, 0); nav.pause();
  nav.plan({x: 0, z: 0}, {id: 9, x: 0, z: 40}, 1000);
  for(let tick = 1004; tick <= 1204; tick += 4) nav.plan({x: 0, z: (tick - 1000) / 4}, {id: 9, x: 0, z: 40 + (tick - 1000) / 4}, tick);
  assert.ok(!diagnostics.some(d => d.reason === 'no approach progress'));
});
test('continuous displacement does not trigger false stalls', () => {
  const nav = new Navigator(); nav.offset = 0;
  for (let tick = 0; tick < 200; tick += 4) nav.plan({x: 0, z: tick / 4}, {x: 0, z: 100}, tick);
  assert.equal(nav.attempts, 0); assert.equal(nav.blocked, false);
});
test('pauses do not accrue blocked movement time', () => {
  const nav = new Navigator(); nav.offset = 0;
  nav.plan({x: 0, z: 0}, {x: 0, z: 100}, 0); nav.pause();
  nav.plan({x: 0, z: 0}, {x: 0, z: 100}, 200);
  assert.equal(nav.attempts, 0);
});
test('LOS cooldown frames do not consume escape attempts while making progress', () => {
  const nav = new Navigator(); nav.offset = 0;
  nav.escape(0, 0, 'line-of-sight');
  for (let tick = 0; tick < 200; tick += 4) nav.plan({x: tick / 4, z: 0}, {x: 100, z: 50}, tick, {lineOfSight: true});
  assert.equal(nav.blocked, false); assert.equal(nav.attempts, 0);
});
test('abort an escape that produces no displacement and try the opposite side promptly', () => {
  const diagnostics = [], nav = new Navigator({onDiagnostic: d => diagnostics.push(d)}); nav.offset = 0;
  nav.escape(0, 0, 'no displacement');
  const me = {x: 0, z: 0}, target = {x: 0, z: 100};
  const initial = nav.plan(me, target, 0);
  const retry = nav.plan(me, target, 12);
  assert.ok(initial.facing > 0); assert.ok(retry.facing < 0);
  assert.equal(diagnostics.at(-1).reason, 'escape produced no displacement');
});
test('remember the side of a successful detour for the next obstruction', () => {
  const nav = new Navigator(); nav.offset = 0; nav.attempts = 1;
  nav.escape(0, 0, 'no displacement'); nav.plan({x: 0, z: 0}, {x: 0, z: 100}, 0);
  nav.plan({x: -12, z: 0}, {x: 0, z: 100}, 40);
  assert.equal(nav.preferredAngle, -Math.PI / 2);
  nav.attempts = 0; nav.escape(44, 0, 'no displacement');
  assert.ok(nav.recovery.heading < 0);
});
