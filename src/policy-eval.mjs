import {CombatController} from './controller.mjs';
import {validatePolicy} from './policy.mjs';

/** A behavioral smoke gate, not a simulator or evidence of improved win rate. */
export function evaluatePolicy(policy) {
  validatePolicy(policy);
  for (const restriction of ['none', 'mana', 'unlearned', 'cooldown', 'gcd', 'controlled']) {
    const sent = [];
    const bot = new CombatController({policy, send: m => sent.push(m)});
    bot.setRules({version: 'native-arena-v1', tickHz: 20, specs: [{id: 'frost_mage', role: 'dps',
      abilities: [{id: 'frostbolt', cost: 62, castTime: 2.2}]}]});
    bot.observe({t: 'welcome', state: 'countdown', pid: 1, side: 'freehold'});
    bot.nav.offset = 0;
    bot.observe({t: 'snap', state: 'fight', tick: 200, full: 1,
      ents: [{id: 1, x: 0, z: 0, hp: 400, mhp: 400, f: 0,
        auras: restriction === 'controlled' ? [{kind: 'stun', end: 500}] : []},
      {id: 2, x: 0, z: policy.preferredRange - 1, hp: 400, mhp: 400}],
      chars: {1: {side: 'freehold'}, 2: {side: 'coinfall'}},
      self: {id: 1, res: restriction === 'mana' ? 0 : 1000,
        known: restriction === 'unlearned' ? [] : ['frostbolt'],
        gcd: restriction === 'gcd' ? 1 : 0, cds: {frostbolt: restriction === 'cooldown' ? 10 : 0}}});
    const casts = sent.filter(m => m.cmd === 'cast');
    if ((restriction === 'none' && casts.length !== 1) || (restriction !== 'none' && casts.length)) {
      throw new Error('Candidate failed cast legality smoke gate');
    }
    bot.observe({t: 'battle', state: 'results'});
    for (const m of sent) if (m.t === 'input' && !Number.isFinite(m.facing)) throw new Error('Invalid navigation output');
  }
  return {passed: true, scenarios: 6, kind: 'behavioral-smoke'};
}
