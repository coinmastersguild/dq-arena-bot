const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Role-aware focus selection using only the native player's observed state. */
export class TargetSelector {
  constructor({tickHz = 20, onDiagnostic = () => {}} = {}) {
    this.tickHz = tickHz; this.diagnostic = onDiagnostic; this.roles = new Map(); this.reset();
  }
  reset() { this.focus = null; this.avoidUntil = new Map(); }
  setRules(rules) { this.roles = new Map(rules.specs.map(s => [s.id, s.role])); }
  role(entity, chars) { return this.roles.get(chars[entity.id]?.spec) || 'dps'; }
  events(events, chars, side) {
    if (!this.focus) return;
    for (const event of events) {
      if (event.targetId !== this.focus.id || !(event.amount > 0)) continue;
      if (event.type === 'damage' && chars[event.sourceId]?.side === side) this.focus.damage += event.amount;
      if (event.type === 'heal2' && chars[event.sourceId]?.side && chars[event.sourceId].side !== side) this.focus.healing += event.amount;
    }
  }
  choose({me, enemies, chars, tick, losUntil, allies = []}) {
    const targets = enemies.filter(e => !(e.auras || []).some(a => a.kind === 'polymorph' && a.end > tick));
    const previous = targets.find(e => e.id === this.focus?.id);
    if (previous && tick - this.focus.since >= this.tickHz * 8) {
      const progress = (this.focus.hp - previous.hp) / Math.max(1, previous.mhp);
      if (this.focus.damage >= 100 && this.focus.healing >= this.focus.damage * 0.5 && progress < 0.12) {
        this.avoidUntil.set(previous.id, tick + this.tickHz * 12);
        this.diagnostic({type: 'focus-not-progressing', tick, targetId: previous.id,
          damage: this.focus.damage, healing: this.focus.healing, healthProgress: progress});
      }
      Object.assign(this.focus, {since: tick, hp: previous.hp, damage: 0, healing: 0});
    }
    const healer = allies.find(e => this.role(e, chars) === 'healer');
    const score = e => {
      const range = distance(me, e), role = this.role(e, chars);
      const finish = e.hp <= 120 && range <= 30;
      const roleCost = role === 'bossTank' ? 60 : role === 'healer' ? -40 : 0;
      const approach = Math.max(0, range - 30) * 1.5;
      const isolation = healer ? Math.max(0, distance(healer, e) - 50) : 0;
      return range * 0.6 + approach + isolation + 15 * e.hp / Math.max(1, e.mhp) + roleCost +
        (finish ? -110 : 0) + (losUntil.get(e.id) > tick ? 90 : 0) +
        (this.avoidUntil.get(e.id) > tick && !finish ? 70 : 0);
    };
    targets.sort((a, b) => score(a) - score(b) || a.id - b.id);
    let target = targets[0];
    if (previous && target && score(previous) <= score(target) + 12) target = previous;
    // Keep productive in-range pressure instead of chasing an out-of-range upgrade.
    if (previous && target && this.role(previous, chars) !== 'bossTank' &&
        distance(me, previous) <= 30 && distance(me, target) > 30 &&
        !(losUntil.get(previous.id) > tick) && !(this.avoidUntil.get(previous.id) > tick)) target = previous;
    if (target && target.id !== this.focus?.id) {
      this.focus = {id: target.id, since: tick, hp: target.hp, damage: 0, healing: 0};
      this.diagnostic({type: 'focus-selected', tick, targetId: target.id,
        role: this.role(target, chars), range: Math.round(distance(me, target) * 10) / 10});
    }
    if (!target) this.focus = null;
    return target;
  }
}
