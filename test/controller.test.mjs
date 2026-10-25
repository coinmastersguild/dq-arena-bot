import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatController} from '../src/controller.mjs';

function harness() {
  const sent = [], diagnostics = [];
  const bot = new CombatController({send: m => sent.push(m), onDiagnostic: d => diagnostics.push(d)});
  bot.setRules({version: 'native-arena-v1', tickHz: 20, specs: [{id: 'frost_mage', abilities: [
    {id: 'frostbolt', cost: 62, castTime: 2.2}, {id: 'ice_barrier', cost: 90, castTime: 0},
  ]}]});
  bot.observe({t: 'welcome', state: 'countdown', pid: 1, side: 'freehold'});
  const snap = (tick, overrides = {}) => ({t: 'snap', state: 'fight', tick, full: 1,
    ents: [{id: 1, x: 0, z: 0, f: 0, hp: 400, mhp: 400}, {id: 2, x: 0, z: 25, hp: 400, mhp: 400}],
    chars: {1: {side: 'freehold'}, 2: {side: 'coinfall'}}, self: {id: 1, res: 1000, known: ['frostbolt', 'ice_barrier'], gcd: 0, cds: {}}, ...overrides});
  return {bot, sent, diagnostics, snap};
}
test('entity rows replace absent fields, full snapshots replace maps, gone removes entries', () => {
  const {bot, snap} = harness();
  bot.observe(snap(1, {state: 'countdown', ents: [{id: 1, cast: 'old'}]}));
  bot.observe(snap(2, {state: 'countdown', full: 0, ents: [{id: 1, hp: 10}]}));
  assert.equal(bot.entities.get(1).cast, undefined);
  bot.observe(snap(3, {state: 'countdown', ents: [{id: 2}]})); assert.equal(bot.entities.has(1), false);
  bot.observe(snap(4, {state: 'countdown', full: 0, ents: [], gone: [2]})); assert.equal(bot.entities.size, 0);
});
test('snapshot phase triggers combat and a legal target/cast without requiring battle message', () => {
  const {bot, sent, snap} = harness(); bot.observe(snap(201));
  assert.ok(sent.some(m => m.cmd === 'target' && m.id === 2));
  assert.ok(sent.some(m => m.cmd === 'cast' && m.ability === 'frostbolt'));
});
test('no combat actions in lobby, countdown, results, or spectator mode', () => {
  for (const state of ['lobby', 'countdown', 'results']) {
    const {bot, sent, snap} = harness(); bot.observe(snap(1, {state})); assert.equal(sent.length, 0);
  }
  const {bot, sent, snap} = harness(); bot.spectator = true; bot.observe(snap(1)); assert.equal(sent.length, 0);
});
test('team focus happens outside personal spell range', () => {
  const {bot, sent, snap} = harness(); bot.leader = true;
  const m = snap(201); m.ents[1].z = 100; bot.observe(m);
  assert.ok(sent.some(m => m.cmd === 'coach' && m.order === 'focus'));
  assert.ok(!sent.some(m => m.cmd === 'cast'));
});
test('embedded actor-scoped LOS errors start recovery and suppress immediate repeat casts', () => {
  const {bot, sent, diagnostics, snap} = harness(); bot.nav.offset = 0; bot.observe(snap(201)); sent.length = 0;
  bot.observe(snap(225, {evs: [{type: 'error', pid: 1, text: 'Line of sight.'}]}));
  assert.ok(diagnostics.some(d => d.type === 'navigation-recovery'));
  assert.ok(!sent.some(m => m.cmd === 'cast'));
  assert.ok(sent.some(m => m.t === 'input' && m.mi.f === 1));
});
test('foreign errors do not change this player LOS state', () => {
  const {bot, snap} = harness(); bot.observe(snap(201));
  bot.observe(snap(225, {evs: [{type: 'error', pid: 2, text: 'Line of sight.'}]}));
  assert.equal(bot.losUntil.size, 0);
});
test('cast gating respects learned abilities, mana, GCD, cooldown and pending casts', () => {
  for (const override of [{known: []}, {res: 0}, {gcd: 1}, {cds: {frostbolt: 3}}]) {
    const {bot, sent, snap} = harness(); const m = snap(201); Object.assign(m.self, override); bot.observe(m);
    assert.ok(!sent.some(m => m.cmd === 'cast'));
  }
  const {bot, sent, snap} = harness(); bot.observe(snap(201)); bot.observe(snap(225));
  assert.equal(sent.filter(m => m.cmd === 'cast').length, 1);
});
test('results stop previously issued movement', () => {
  const {bot, sent} = harness(); bot.input(1, 1); bot.observe({t: 'battle', state: 'results'});
  assert.equal(sent.at(-1).mi.f, 0);
});
test('embedded cast and damage outcomes are observed; prolonged inactivity raises diagnostics', () => {
  const {bot, diagnostics, snap} = harness(); bot.observe(snap(201));
  bot.observe(snap(205, {evs: [{type: 'damage', sourceId: 1, amount: 80}]})); assert.equal(bot.lastEffect, 205);
  bot.observe(snap(509)); assert.ok(diagnostics.some(d => d.type === 'no-combat-effect'));
});
test('root pauses navigation without treating it as a collision', () => {
  const {bot, sent, snap} = harness(); const m = snap(201); m.ents[1].z = 100;
  m.ents[0].auras = [{kind: 'root', end: 400}]; bot.observe(m);
  assert.ok(!sent.some(m => m.mi?.f === 1)); assert.equal(bot.nav.attempts, 0);
});
test('synthetic obstacle: recovery reaches casting range instead of repeating a blocked heading', () => {
  const {bot, sent, diagnostics, snap} = harness();
  let x = 0, z = 0, input = {facing: 0, mi: {f: 0}};
  for (let tick = 201; tick < 801; tick += 4) {
    const m = snap(tick); m.ents[0].x = x; m.ents[0].z = z; m.ents[1].z = 45;
    const before = sent.length; bot.observe(m);
    for (const command of sent.slice(before)) if (command.t === 'input') input = command;
    const nx = x + Math.sin(input.facing) * input.mi.f * 1.4;
    const nz = z + Math.cos(input.facing) * input.mi.f * 1.4;
    // Deliberately simple synthetic wall; this is not the Arena collision model.
    if (!(Math.abs(nx) <= 2 && nz >= 4 && nz <= 7)) { x = nx; z = nz; }
    if (sent.some(command => command.cmd === 'cast')) break;
  }
  assert.ok(diagnostics.some(d => d.type === 'navigation-recovery'));
  assert.ok(sent.some(command => command.cmd === 'cast' && command.ability === 'frostbolt'));
  assert.ok(Math.hypot(x, 45 - z) <= 30);
});
test('LOS retry requires both backoff expiry and meaningful repositioning', () => {
  const {bot, snap} = harness(); bot.nav.offset = 0; bot.observe(snap(201));
  bot.observe(snap(205, {evs: [{type: 'error', pid: 1, text: 'Line of sight.'}]}));
  assert.equal(bot.losUntil.get(2), 365);
  bot.observe(snap(369)); assert.ok(bot.losUntil.get(2) > 369);
  const moved = snap(373); moved.ents[0].x = 5; bot.observe(moved);
  assert.equal(bot.losUntil.has(2), false);
});
test('repeated LOS failures increase backoff and confirmed damage clears it', () => {
  const {bot, snap} = harness();
  const full = (tick, extra={}) => {
    const m=snap(tick, extra);m.ents.push({id:3,x:0,z:100,hp:400,mhp:400},{id:4,x:0,z:100,hp:400,mhp:400});
    m.chars[3]={side:'coinfall'};m.chars[4]={side:'coinfall'};return m;
  };
  bot.observe(full(201));
  bot.observe(full(205, {evs: [{type: 'error', pid: 1, text: 'Line of sight.'}]}));
  bot.observe(full(225, {evs: [{type: 'error', pid: 1, text: 'Line of sight.'}]}));
  assert.equal(bot.losUntil.get(2), 545);
  bot.observe(snap(229, {evs: [{type: 'damage', sourceId: 1, targetId: 2, amount: 70}]}));
  assert.equal(bot.losUntil.has(2), false); assert.equal(bot.losFailures.has(2), false);
});
test('last-survivor LOS backoff is bounded at eight seconds', () => {
  const {bot,snap}=harness();bot.observe(snap(201));
  for(const tick of [205,225,245])bot.observe(snap(tick,{evs:[{type:'error',pid:1,text:'Line of sight.'}]}));
  assert.equal(bot.losUntil.get(2),405);
});
test('retreat from a nearby attacker while preserving a farther healer as damage target', () => {
  const {bot,sent,snap}=harness();bot.nav.offset=0;
  bot.targeting.roles.set('priest','healer');bot.targeting.roles.set('tank','bossTank');
  const m=snap(201);m.self.known=['frostbolt'];m.chars[2].spec='priest';
  m.ents.push({id:3,x:4,z:0,hp:1000,mhp:1000,tgt:1});m.chars[3]={side:'coinfall',spec:'tank'};
  bot.observe(m);
  assert.equal(bot.targetId,2);
  const move=sent.find(m=>m.mi?.b===1);
  assert.ok(move);assert.ok(Math.abs(move.facing-Math.PI/2)<.01);
  assert.ok(!sent.some(m=>m.cmd==='cast'&&m.ability==='frostbolt'));
});
test('cast pushback cannot trap a pressured low-health mage in the casting wait', () => {
  const {bot,sent,snap,diagnostics}=harness();bot.nav.offset=0;
  const m=snap(201);m.ents[0].hp=120;m.ents[0].cast='frostbolt';m.ents[0].castEnd=500;
  m.ents[1].tgt=1;bot.observe(m);
  assert.ok(sent.some(m=>m.mi?.b===1));
  assert.ok(diagnostics.some(d=>d.type==='defensive-cast-break'));
  assert.ok(!sent.some(m=>m.cmd==='cast'));
});
test('finish a safe cast, and never try to move out of a root while casting', () => {
  for(const rooted of [false,true]){
    const {bot,sent,snap}=harness();bot.nav.offset=0;const m=snap(201);
    Object.assign(m.ents[0],{cast:'frostbolt',castEnd:240});
    if(rooted){m.ents[1].z=5;m.ents[0].auras=[{kind:'root',end:500}];}
    bot.observe(m);assert.ok(!sent.some(m=>m.mi?.f||m.mi?.b));assert.ok(!sent.some(m=>m.cmd==='cast'));
  }
});
test('when the focused enemy dies, immediately approach and coach focus on the last survivor', () => {
  const {bot,sent,snap}=harness();bot.nav.offset=0;bot.leader=true;bot.observe(snap(201));sent.length=0;
  const m=snap(249);m.ents[1].dead=1;m.ents[1].hp=0;
  m.ents.push({id:3,x:0,z:80,hp:120,mhp:400});m.chars[3]={side:'coinfall'};
  bot.observe(m);assert.equal(bot.targetId,3);
  assert.ok(sent.some(m=>m.cmd==='coach'&&m.order==='focus'));assert.ok(sent.some(m=>m.mi?.f===1));
});
test('after LOS reposition, hold safe casting range until backoff expires', () => {
  const {bot, sent, snap} = harness(); bot.nav.offset = 0; bot.observe(snap(201));
  bot.observe(snap(205, {evs: [{type: 'error', pid: 1, text: 'Line of sight.'}]}));
  // Simulate the completed sidestep without forging a successful spell.
  bot.nav.recovery = null; bot.lastInputMoving = true; sent.length = 0;
  const moved = snap(241); moved.ents[0].x = 5; bot.observe(moved);
  assert.ok(!sent.some(m => m.mi?.f === 1));
  assert.ok(!sent.some(m => m.cmd === 'cast'));
});
test('use a learned in-range instant spell while retreating, without starting a timed cast', () => {
  const {bot, sent, snap} = harness(); bot.nav.offset = 0;
  bot.abilities.set('fire_blast', {cost: 85, castTime: 0, range: 20});
  const m = snap(201); m.ents[1].z = 8; m.self.known = ['fire_blast', 'frostbolt']; bot.observe(m);
  assert.ok(sent.some(m => m.mi?.b === 1 && m.mi.f === 0 && Math.abs(m.facing) < 0.01));
  assert.ok(sent.some(m => m.cmd === 'cast' && m.ability === 'fire_blast'));
  assert.ok(!sent.some(m => m.cmd === 'cast' && m.ability === 'frostbolt'));
});
test('movement spell still respects LOS and its runtime range', () => {
  for (const reason of ['los', 'range']) {
    const {bot, sent, snap} = harness(); bot.nav.offset = 0;
    bot.abilities.set('fire_blast', {cost: 85, castTime: 0, range: reason === 'range' ? 5 : 20});
    if (reason === 'los') bot.losUntil.set(2, 500);
    const m = snap(201);m.ents[1].z = 8;m.self.known = ['fire_blast'];bot.observe(m);
    assert.ok(!sent.some(m => m.cmd === 'cast'));
  }
});
