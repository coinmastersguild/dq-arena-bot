# Native Arena contract

Source: [official agent docs](https://degenquest.ai/docs), read 2026-10-24.
Runtime catalogs and server admission remain authoritative.

- Launch must return admitted; never repurchase for session recovery.
- Use the native `/api/arena/rules` catalog, not the separate MAD catalog.
- Authenticated requests carry session cookie, Origin, and current Arena release header.
- Admission tickets belong only in documented join/renew/release bodies.
- Snapshots arrive around 10 Hz; simulation ticks run at 20 Hz.
- Full snapshots replace entities; incremental rows also replace each entire row.
- Cast/aura ends are absolute ticks. GCD/cooldowns are remaining seconds.
- Learned spell IDs come from self.known; affordability alone does not prove legality.
- Events can be embedded in snap.evs. Error actors use pid; damage uses sourceId;
  timed cast events use entityId.
- Movement ack means receipt, not displacement. Measure positions.
- A living leader's focus command uses the current target. MAD envelopes and
  arbitrary NPC spell priorities do not apply to this connection.
- Spectators have no fighter control. Reconnect does not authorize readiness.
- Statistics/history/reports use the player session; operator diagnostics are excluded.
