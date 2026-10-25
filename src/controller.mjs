import {Navigator} from './navigation.mjs';
import {TargetSelector} from './targeting.mjs';

export const CONTROLLER_VERSION = '0.5.0';
const living = e => e && !e.dead && e.hp > 0;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Pure protocol/controller core: injected sends, no sockets, wallet, or filesystem. */
export class CombatController {
  constructor({send, onDiagnostic = () => {}, spec = 'frost_mage', tickHz = 20} = {}) {
    if (spec !== 'frost_mage') throw new Error('Only frost_mage strategy is implemented');
    this.send = send;
    this.diagnostic = onDiagnostic;
    this.spec = spec;
    this.tickHz = tickHz;
    this.abilities = new Map();
    this.nav = new Navigator({tickHz, onDiagnostic});
    this.targeting = new TargetSelector({tickHz, onDiagnostic});
    this.seq = 0;
    this.reset();
  }
  reset() {
    this.entities = new Map(); this.chars = {}; this.self = {};
    this.tick = 0; this.phase = 'lobby'; this.pid = null; this.side = null;
    this.spectator = false; this.leader = false; this.name = null;
    this.lastDecision = -Infinity; this.lastCast = -Infinity; this.lastCoach = -Infinity;
    this.targetId = null; this.pendingCast = null; this.lastTargetSent = null; this.lastTargetTick = -Infinity;
    this.losUntil = new Map(); this.losFailures = new Map(); this.lastInputMoving = false;
    this.fightStart = null; this.lastEffect = null; this.lastAlert = -Infinity;
    this.nav.reset();
    this.targeting.reset(); this.lastCoachTarget = null;
  }
  setRules(rules) {
    if (rules.version !== 'native-arena-v1' || rules.tickHz !== 20) throw new Error('Unsupported native rules');
    const kit = rules.specs.find(s => s.id === this.spec);
    if (!kit?.abilities) throw new Error('Missing native spell definitions');
    this.abilities = new Map(kit.abilities.map(a => [a.id, a]));
    this.targeting.setRules(rules);
  }
  observe(m) {
    if (m.t === 'welcome') {
      this.stopMovement();
      this.reset();
      this.side = m.side; this.pid = m.pid; this.spectator = !!m.spectator;
      this.phase = m.state;
    }
    if (m.t === 'lobby') {
      if (m.state === 'lobby' && this.phase !== 'lobby') {
        this.stopMovement(); this.reset();
      }
      this.phase = m.state || 'lobby';
      for (const [side, slots] of Object.entries(m.sides || {})) {
        const mine = slots.find(slot => slot.you);
        if (mine) { this.side = side; this.name = mine.name; this.leader = m.leaders?.[side] === mine.name; }
      }
    }
    if (m.t === 'battle') {
      if (m.state) this.phase = m.state;
      if (typeof m.coach?.leader === 'boolean') this.leader = m.coach.leader;
      if (this.phase !== 'fight') this.stopMovement();
    }
    if (m.t === 'evs') this.events(m.evs || []);
    if (m.t === 'self') this.self = m.self || m;
    if (m.t === 'chars') Object.assign(this.chars, m.chars || {});
    if (m.t !== 'snap') return;
    if (!Number.isFinite(m.tick)) return;
    if (m.tick < this.tick) {
      this.stopMovement();
      const {side, leader, name} = this;
      this.reset(); Object.assign(this, {side, leader, name});
    }
    this.tick = m.tick;
    if (m.state) this.phase = m.state;
    if (m.full) this.entities.clear();
    for (const e of m.ents || []) this.entities.set(e.id, e); // Rows replace, not merge.
    for (const id of m.gone || []) { this.entities.delete(id); delete this.chars[id]; }
    if (m.chars) Object.assign(this.chars, m.chars);
    if (m.self) this.self = m.self;
    this.events(m.evs || []);
    if (this.phase !== 'fight' || this.spectator) { this.stopMovement(); return; }
    if (this.fightStart === null) this.fightStart = this.tick;
    if (this.tick - this.lastDecision < this.tickHz / 5) return;
    this.lastDecision = this.tick;
    this.decide();
  }
  events(events) {
    this.targeting.events(events, this.chars, this.side);
    const id = this.self.id ?? this.pid;
    for (const e of events) {
      if (id == null) continue;
      const own = e.pid === id || e.entityId === id || e.sourceId === id;
      if (!own) continue;
      if (e.type === 'error') {
        this.diagnostic({type: 'combat-error', tick: this.tick, text: e.text});
        if (/no target/i.test(e.text || '') && !living(this.entities.get(this.targetId))) {
          this.diagnostic({type: 'target-lost-during-cast', tick: this.tick, targetId: this.targetId});
          this.lastTargetSent = null; this.lastTargetTick = -Infinity;
        }
        if (/line of sight/i.test(e.text || '') && this.targetId != null) {
          const targetId = this.pendingCast?.target ?? this.targetId;
          const count = (this.losFailures.get(targetId)?.count || 0) + 1;
          const me = this.entities.get(id), target = this.entities.get(targetId);
          const until = this.tick + this.tickHz * Math.min(24, 8 * count);
          this.losFailures.set(targetId, {count, until, origin: me && {x: me.x, z: me.z},
            targetOrigin: target && {x: target.x, z: target.z}});
          this.losUntil.set(targetId, until);
          this.diagnostic({type: 'los-backoff', tick: this.tick, targetId, seconds: Math.min(24, 8 * count)});
          this.nav.escape(this.tick, this.entities.get(id)?.f || 0, 'line-of-sight');
        }
        this.pendingCast = null;
      }
      if (['castStart', 'castStop', 'damage', 'heal2'].includes(e.type)) {
        this.lastEffect = this.tick;
        if (e.type !== 'castStart') this.pendingCast = null;
      }
      if (e.type === 'damage' && e.sourceId === id && e.targetId != null) {
        this.losFailures.delete(e.targetId); this.losUntil.delete(e.targetId);
      }
    }
  }
  input(facing, forward = 0) {
    if (!Number.isFinite(facing)) return;
    this.lastInputMoving = !!forward;
    this.send({t: 'input', seq: ++this.seq, facing, mi: {f: forward, b: 0, sl: 0, sr: 0, j: 0}});
  }
  stopMovement(facing = 0) {
    if (this.lastInputMoving) this.input(facing, 0);
    this.nav.pause();
  }
  select(id) {
    this.targetId = id;
    if (this.self.target !== id && (this.lastTargetSent !== id || this.tick - this.lastTargetTick >= this.tickHz)) {
      this.send({t: 'cmd', cmd: 'target', id}); this.lastTargetSent = id; this.lastTargetTick = this.tick;
    }
  }
  cast(id, target) {
    const a = this.abilities.get(id);
    if (!a || !this.self.known?.includes(id) || !Number.isFinite(this.self.res) || this.self.res < a.cost ||
      (this.self.cds?.[id] || 0) > 0 || (!a.offGcd && (this.self.gcd || 0) > 0) ||
      this.tick - this.lastCast < this.tickHz || (this.pendingCast && this.tick < this.pendingCast.until)) return false;
    if (target != null) this.select(target);
    this.send({t: 'cmd', cmd: 'cast', ability: id});
    this.lastCast = this.tick;
    this.pendingCast = {id, target, until: this.tick + this.tickHz * Math.max(1, a.castTime || 0)};
    return true;
  }
  decide() {
    const me = this.entities.get(this.self.id ?? this.pid);
    if (!living(me)) { this.stopMovement(); return; }
    for (const [id, failure] of this.losFailures) {
      if (this.tick < failure.until) continue;
      const target = this.entities.get(id);
      const repositioned = (failure.origin && distance(me, failure.origin) >= 4) ||
        (target && failure.targetOrigin && distance(target, failure.targetOrigin) >= 6);
      if (repositioned) this.losUntil.delete(id);
      else this.losUntil.set(id, this.tick + this.tickHz);
    }
    const active = (me.auras || []).filter(a => a.end > this.tick);
    const controlled = active.some(a => ['stun', 'polymorph', 'fear'].includes(a.kind));
    const rooted = active.some(a => ['root', 'rooted'].includes(a.kind));
    if (controlled) { this.stopMovement(me.f); return; }
    const enemies = [...this.entities.values()].filter(e => living(e) && this.chars[e.id]?.side && this.chars[e.id].side !== this.side);
    // Finish the current cast before changing the selected damage target.
    if (me.cast && me.castEnd > this.tick) { this.stopMovement(me.f); return; }
    const allies = [...this.entities.values()].filter(e => living(e) && this.chars[e.id]?.side === this.side);
    const target = this.targeting.choose({me, enemies, allies, chars: this.chars, tick: this.tick, losUntil: this.losUntil});
    if (!target) { this.stopMovement(me.f); return; }
    this.select(target.id);
    // Leadership must work while approaching, not only inside personal casting range.
    if (this.leader && (this.lastCoachTarget !== target.id || this.tick - this.lastCoach >= this.tickHz * 3)) {
      this.send({t: 'cmd', cmd: 'coach', order: 'focus', pid: null}); this.lastCoach = this.tick; this.lastCoachTarget = target.id;
    }
    const sinceEffect = this.tick - (this.lastEffect ?? this.fightStart);
    if (sinceEffect >= this.tickHz * 15 && this.tick - this.lastAlert >= this.tickHz * 15) {
      this.diagnostic({type: 'no-combat-effect', tick: this.tick, seconds: sinceEffect / this.tickHz}); this.lastAlert = this.tick;
    }
    const range = distance(me, target);
    const near = enemies.some(e => distance(me, e) < 10);
    const facing = this.nav.offset === null ? me.f || 0 : Math.atan2(target.x - me.x, target.z - me.z) - this.nav.offset;
    if ((near || me.hp < me.mhp * 0.7) && !active.some(a => a.kind === 'absorb') && this.cast('ice_barrier')) {
      this.stopMovement(me.f); return;
    }
    if (near && this.cast('frost_nova')) { this.stopMovement(me.f); return; }
    const los = this.losUntil.get(target.id) > this.tick;
    const failed = this.losFailures.get(target.id);
    const repositioned = failed && ((failed.origin && distance(me, failed.origin) >= 4) ||
      (failed.targetOrigin && distance(target, failed.targetOrigin) >= 6));
    if (los && repositioned && range >= 12 && range <= 30 && !this.nav.recovery) {
      // The new position is sufficient; wait out the backoff instead of exhausting
      // escape attempts or walking into melee while unable to cast this target.
      this.stopMovement(facing); return;
    }
    if (!rooted && (range > 27 || range < 12 || los || this.nav.recovery)) {
      const step = this.nav.plan(me, target, this.tick, {retreat: range < 12, lineOfSight: los});
      this.input(step.facing, step.forward); return;
    }
    this.stopMovement(facing);
    this.input(facing, 0);
    if (range > 30 || los) return;
    if (range <= 20 && target.hp < 80 && this.cast('fire_blast', target.id)) return;
    this.cast('frostbolt', target.id);
  }
}
