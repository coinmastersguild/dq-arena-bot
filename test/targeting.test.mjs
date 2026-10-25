import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetSelector} from '../src/targeting.mjs';

function harness() {
  const diagnostics = [], selector = new TargetSelector({onDiagnostic: d => diagnostics.push(d)});
  selector.setRules({specs: [{id: 'tank', role: 'bossTank'}, {id: 'priest', role: 'healer'}, {id: 'mage', role: 'dps'}]});
  const chars = {1: {side: 'freehold', spec: 'mage'}, 2: {side: 'coinfall', spec: 'tank'},
    3: {side: 'coinfall', spec: 'priest'}, 4: {side: 'coinfall', spec: 'mage'}};
  const entity = (id, z, hp = 400, mhp = 400) => ({id, x: 0, z, hp, mhp});
  const choose = (enemies, tick = 201, extra = {}) => selector.choose({me: entity(1, 0), enemies, chars, tick, losUntil: new Map(), ...extra});
  return {selector, diagnostics, chars, entity, choose};
}
test('reachable healer outranks an injured but non-executable frontline tank', () => {
  const {choose, entity} = harness();
  assert.equal(choose([entity(2, 18, 600, 1500), entity(3, 29), entity(4, 24)]).id, 3);
});
test('do not cross the arena for a healer when a caster is accessible', () => {
  const {choose, entity} = harness();
  assert.equal(choose([entity(3, 100), entity(4, 24)]).id, 4);
});
test('finish a low-health tank rather than switching away from a likely kill', () => {
  const {choose, entity} = harness();
  assert.equal(choose([entity(2, 18, 80, 1500), entity(3, 29)]).id, 2);
});
test('healing that offsets allied damage triggers a focus reassessment', () => {
  const {choose, entity, selector, chars, diagnostics} = harness();
  assert.equal(choose([entity(4, 20)], 201).id, 4);
  selector.events([{type: 'damage', sourceId: 1, targetId: 4, amount: 300},
    {type: 'heal2', sourceId: 3, targetId: 4, amount: 280}], chars, 'freehold');
  const alt = entity(2, 18, 500, 1500);
  assert.equal(choose([entity(4, 20, 390), alt], 365).id, 2);
  assert.ok(diagnostics.some(d => d.type === 'focus-not-progressing'));
});
test('unrelated healing does not penalize current focus', () => {
  const {choose, entity, selector, chars, diagnostics} = harness();
  choose([entity(4, 20)], 201);
  selector.events([{type: 'heal2', sourceId: 3, targetId: 2, amount: 1000}], chars, 'freehold');
  choose([entity(4, 20)], 365);
  assert.ok(!diagnostics.some(d => d.type === 'focus-not-progressing'));
});
test('avoid controlled targets and targets with recent LOS errors', () => {
  const {choose, entity} = harness(); const priest = entity(3, 25);
  priest.auras = [{kind: 'polymorph', end: 500}];
  assert.equal(choose([priest, entity(4, 25)]).id, 4);
  priest.auras = [];
  assert.equal(choose([priest, entity(4, 25)], 205, {losUntil: new Map([[3, 500]])}).id, 4);
});
test('retain an accessible caster instead of chasing a slightly out-of-range healer', () => {
  const {choose, entity} = harness(); choose([entity(4, 25)], 201);
  assert.equal(choose([entity(4, 25), entity(3, 35)], 401).id, 4);
});
