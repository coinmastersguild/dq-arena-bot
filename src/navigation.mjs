const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Small reactive navigator, not a navmesh/pathfinding implementation. */
export class Navigator {
  constructor({tickHz = 20, onDiagnostic = () => {}} = {}) {
    this.tickHz = tickHz;
    this.onDiagnostic = onDiagnostic;
    this.reset();
  }
  reset() {
    this.offset = null;
    this.probe = null;
    this.anchor = null;
    this.moving = false;
    this.recovery = null;
    this.attempts = 0;
    this.blocked = false;
  }
  pause() { this.moving = false; this.anchor = null; this.probe = null; }
  observe(position, tick) {
    if (!this.moving) { this.anchor = null; return; }
    if (!this.anchor) { this.anchor = {...position, tick}; return; }
    if (distance(position, this.anchor) >= 0.5) {
      this.anchor = {...position, tick};
      if (!this.recovery) this.attempts = 0;
    }
  }
  escape(tick, heading, reason) {
    if (this.blocked || this.recovery) return;
    if (this.attempts >= 4) {
      this.blocked = true;
      this.onDiagnostic({type: 'navigation-blocked', tick, reason});
      return;
    }
    const angles = [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75];
    this.recovery = {heading: heading + angles[this.attempts++], until: tick + this.tickHz * 1.2};
    this.anchor = null;
    this.onDiagnostic({type: 'navigation-recovery', tick, reason, attempt: this.attempts});
  }
  plan(me, target, tick, {retreat = false} = {}) {
    if (this.blocked) return {facing: me.f || 0, forward: 0};
    if (this.offset === null) {
      if (!this.probe) this.probe = {...me, tick, facing: this.attempts * Math.PI / 2};
      const elapsed = tick - this.probe.tick;
      const moved = distance(me, this.probe);
      if (elapsed >= this.tickHz * 0.3 && moved > 0.15) {
        this.offset = Math.atan2(me.x - this.probe.x, me.z - this.probe.z) - this.probe.facing;
        this.onDiagnostic({type: 'navigation-calibrated', tick, offset: this.offset});
        this.probe = null;
        this.moving = false;
        this.attempts = 0;
        return {facing: me.f || 0, forward: 0};
      }
      if (elapsed > this.tickHz * 1.5) {
        this.probe = null;
        if (++this.attempts >= 4) {
          this.blocked = true;
          this.onDiagnostic({type: 'navigation-blocked', tick, reason: 'calibration failed'});
        }
        return {facing: me.f || 0, forward: 0};
      }
      this.moving = true;
      return {facing: this.probe.facing, forward: 1};
    }
    const heading = Math.atan2(target.x - me.x, target.z - me.z) - this.offset + (retreat ? Math.PI : 0);
    this.observe(me, tick);
    if (this.recovery && tick >= this.recovery.until) {
      this.recovery = null;
      this.anchor = {...me, tick};
    }
    // LOS recovery is triggered once by a server error, not every cooldown frame.
    // Repeating it here consumed all escape attempts even while moving freely.
    if (this.anchor && tick - this.anchor.tick >= this.tickHz * 1.5) this.escape(tick, heading, 'no displacement');
    if (this.blocked) { this.moving = false; return {facing: me.f || 0, forward: 0}; }
    this.moving = true;
    return {facing: this.recovery?.heading ?? heading, forward: 1};
  }
}
