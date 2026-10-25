# Changelog

## 0.3.0 — 2026-10-24

Rematch candidate; live tactical validation pending.

- Role-aware target selection prioritizes accessible healers/casters over tanks.
- Preserve nearby finishing opportunities and penalize excessive pursuit away from an allied healer.
- Reassess focus after eight seconds of damage offset by healing with little health progress.
- Notify allied NPCs immediately when the focus changes; finish active casts before changing targets.
- Add target-choice diagnostics and six policy regression tests.

## 0.2.0 — 2026-10-24

Candidate release; offline-tested, live acceptance pending.

- Separate controller, navigator, session, recorder, runner, and CLI modules.
- Configurable account-session paths and team selection; no hard-coded identity.
- Displacement-based stall detection and bounded alternate headings.
- Embedded error handling and LOS repositioning.
- Leader focus independent of personal casting range.
- Pending-cast gates, target hysteresis, phase resets, stops, and no-effect diagnostics.
- Finite reconnects without auto-ready, process lock, and clean release.
- Version/source/build recording and authenticated saved reports.
- Offline tests, replay, CI, contributor docs, and package file allowlisting.

## 0.1.0 — 2026-10-24

First live match baseline, preserved as `v0.1.0`.

- Native admission, heartbeat, renewal, initial frost-mage policy and recording.
- Known failure: 174 seconds without displacement; no recovery or embedded error
  handling; team focus delayed until personal casting range.
- Lost the first measured match in 196.1 seconds, dealing 356 damage.
