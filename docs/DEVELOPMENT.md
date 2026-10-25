# Versioning and validation

Use semantic versions: patches for compatible fixes, minors for strategy/API additions,
and majors for incompatible changes after a stable 1.0. Update package.json,
lockfile, CONTROLLER_VERSION, and CHANGELOG together. `npm run check` checks consistency.
Tag reviewed versions `vX.Y.Z`; never overwrite tags. Source and server versions
are separate. v0.1.0 is the live baseline; v0.2.0 completed a live match with recovered movement and 32 completed casts;
v0.3.0 changes focus selection and is awaiting live tactical validation.

## Before a competitive rematch

1. Pass offline tests: frozen position, replacement snapshots, embedded LOS errors,
   distant leader focus, and reconnect without readiness.
2. Join a coordinated lobby unready; verify identity, side, build, and opponent.
3. Ready explicitly; observe forward displacement and a confirmed stop.
4. Observe target selection, Frostbolt, and resulting damage—not just a socket send.
5. Exercise a blocked route: observe recovery or bounded stop; verify LOS response
   and no-effect diagnostics.
6. Confirm death/results stop movement and reports match the observed match.
7. Test reconnect separately; it may disrupt a match and must not auto-ready.

Replay is open-loop evidence, not a win-rate experiment. Compare live versions with
matched builds/lineups and mirrored sides; report aborted matches separately.

## Extension boundaries

CombatController consumes protocol objects and emits injected commands. Navigator
uses positions and ticks. Add class policies separately from transport.

Limitations: no navmesh/obstacle geometry, no verified Blink navigation, no NPC
rotation programming, no auto-reauthentication or requeue. A terminal navigation
block requires intervention. Report retries are bounded; missing reports remain missing.

The runner lock prevents simultaneous clients in one state directory. After a crash,
check the PID in runner.lock is dead before removing it. Do not run two directories
with the same account as a workaround.
