// Native player controller. Uses only this player's replication stream.
export class CombatController {
  constructor(send) {
    this.send = send;
    this.entities = new Map(); this.chars = {}; this.self = {};
    this.phase = 'lobby'; this.tick = 0; this.seq = 0;
    this.lastCast = -100; this.lastDecision = -100;
    this.abilities = new Map(); this.probe = null; this.forwardOffset = null;
  }
  setRules(rules) {
    this.abilities = new Map((rules.specs.find(s => s.id === 'frost_mage')?.abilities || []).map(a => [a.id, a]));
  }
  observe(m) {
    if (m.t === 'welcome') { this.side = m.side; this.pid = m.pid; this.phase = m.state; }
    if (m.t === 'lobby') {
      this.phase = m.state || 'lobby';
      this.leader = m.leaders?.[this.side] === 'FrostByteAgent';
      if (this.phase === 'lobby') {
        this.entities.clear(); this.self = {}; this.chars = {}; this.probe = null;
        this.forwardOffset = null; this.lastCast = -100; this.lastDecision = -100;
      }
    }
    if (m.t === 'battle') this.phase = m.state || this.phase;
    if (m.t === 'chars') Object.assign(this.chars, m.chars || {});
    if (m.t === 'self') this.self = m.self || m;
    if (m.t !== 'snap') return;
    this.tick = m.tick;
    if (m.full) this.entities.clear();
    for (const row of m.ents || []) this.entities.set(row.id, row);
    for (const id of m.gone || []) this.entities.delete(id);
    if (m.chars) Object.assign(this.chars, m.chars);
    if (m.self) this.self = m.self;
    if (this.tick - this.lastDecision < 4) return;
    this.lastDecision = this.tick;
    this.decide();
  }
  input(facing, forward = 0) {
    this.send({t: 'input', seq: ++this.seq, facing, mi: {f: forward, b: 0, sl: 0, sr: 0, j: 0}});
  }
  cast(id, target) {
    const a = this.abilities.get(id);
    if (!a || !this.self.known?.includes(id) || (this.self.cds?.[id] || 0) > 0 ||
        (this.self.gcd || 0) > 0 || this.self.res < a.cost || this.tick - this.lastCast < 20) return false;
    if (target != null) this.send({t: 'cmd', cmd: 'target', id: target});
    this.send({t: 'cmd', cmd: 'cast', ability: id}); this.lastCast = this.tick;
    return true;
  }
  decide() {
    if (this.phase !== 'fight') return;
    const me = this.entities.get(this.self.id ?? this.pid);
    if (!me || me.dead || me.hp <= 0) return;
    if (me.cast && me.castEnd > this.tick) { this.input(me.f || 0); return; }
    const auras = me.auras || [];
    if (auras.some(a => ['stun', 'polymorph', 'fear'].includes(a.kind) && a.end > this.tick)) { this.input(me.f || 0); return; }
    const enemies = [...this.entities.values()].filter(e => {
      const side = this.chars[e.id]?.side;
      return side && side !== this.side && !e.dead && e.hp > 0 && e.id !== me.id;
    });
    if (!enemies.length) { this.input(me.f || 0); return; }
    const distance = e => Math.hypot(e.x - me.x, e.z - me.z);
    // Prefer accessible vulnerable enemies; avoid breaking Polymorph.
    const targets = enemies.filter(e => !(e.auras || []).some(a => a.kind === 'polymorph' && a.end > this.tick));
    targets.sort((a, b) => (distance(a) > 30 ? 100 : 0) + a.hp / a.mhp * 20 + distance(a) -
      ((distance(b) > 30 ? 100 : 0) + b.hp / b.mhp * 20 + distance(b)));
    const target = targets[0]; if (!target) return;
    const range = distance(target);
    // Calibrate facing against displacement before pursuing or kiting.
    if (this.forwardOffset === null) {
      if (!this.probe) { this.probe = {x: me.x, z: me.z, tick: this.tick}; this.input(0, 1); return; }
      if (this.tick - this.probe.tick < 6) { this.input(0, 1); return; }
      const dx = me.x - this.probe.x, dz = me.z - this.probe.z;
      this.input(0);
      if (Math.hypot(dx, dz) > 0.15) this.forwardOffset = Math.atan2(dx, dz);
      else if (this.tick - this.probe.tick > 30) this.probe = null;
      return;
    }
    const toward = Math.atan2(target.x - me.x, target.z - me.z) - this.forwardOffset;
    const near = enemies.some(e => distance(e) < 10);
    if (near && this.cast('frost_nova')) { this.input(toward + Math.PI, 1); return; }
    if ((near || me.hp < me.mhp * 0.7) && !auras.some(a => a.kind === 'absorb' && a.end > this.tick) && this.cast('ice_barrier')) return;
    if (range > 27 || range < 12) { this.input(range < 12 ? toward + Math.PI : toward, 1); return; }
    this.input(toward);
    if (this.leader && this.tick - (this.lastCoach || -100) >= 60) {
      this.send({t: 'cmd', cmd: 'target', id: target.id});
      this.send({t: 'cmd', cmd: 'coach', order: 'focus', pid: null}); this.lastCoach = this.tick;
    }
    if (range <= 20 && target.hp < 80 && this.cast('fire_blast', target.id)) return;
    this.cast('frostbolt', target.id);
  }
}
