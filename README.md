# DQ Arena Bot

An experimental JavaScript toolkit for native DegenQuest Arena bots. Version
**0.9.0** supplies a frost-mage controller, a session/WebSocket runner, offline
regression tests, and versioned recordings. This is an unofficial client,
not the game server or the separate MAD team-coach API.

The first live controller lost after getting stuck. This version addresses that
failure with bounded movement recovery and observable decisions. **Offline
validation is not a claim of live playability or a winning strategy.**

## Requirements and setup

Use Node.js 22+ and an authenticated, named account with paid Arena access.
Follow the [official docs](https://degenquest.ai/docs) to establish a session.
The runner consumes a Netscape-format cookie jar; it does not create wallets,
sign messages, purchase access, or load private keys.

```sh
npm ci
cp bot.config.example.json bot.config.json
# Put your own cookie jar at .secrets/cookies.txt (file mode 0600).
# Edit bot.config.json for your side and paths.
npm start -- --config bot.config.json
```

Configuration paths are relative to the config file. The sample chooses Freehold;
`side: null` accepts the server default. Only `frost_mage` strategy is implemented.
Character IDs must exist in the current server release.

In another terminal:

```sh
npm run bot -- status --config bot.config.json
npm run bot -- ready --config bot.config.json
npm run bot -- unready --config bot.config.json
npm run bot -- stop --config bot.config.json
```

In default manual mode, joining does not ready. `npm start -- --config bot.config.json --ready`
readies the initial connection after side selection. Manual reconnect never auto-readies.
Check server status: queueing a command is not acknowledgement. Keep the process running.

For supervised continuous play with five-minute intermissions and bounded GLM
strategy reviews through Alpha, see [Autonomy](docs/AUTONOMY.md). This mode is opt-in,
uses separate code/policy versions, and continues with the current policy if inference fails.

## Controller behavior

- Native full/delta snapshots, replacement rows, embedded combat events.
- Role-aware focus: prefer reachable healers/casters, finish low-health targets,
  and reassess damage repeatedly offset by healing. Avoid Polymorphed targets.
- Leader focus orders independent of personal casting range.
- Displacement calibration, stalled approach detection, four bounded escape directions,
  then a five-second pause and a changed-direction retry.
- Repositioning after actor-scoped line-of-sight errors.
- Frostbolt, situational Fire Blast, Frost Nova, and Ice Barrier gated by learned
  spells, mana, cooldown, GCD, and observed casting.
- No-effect diagnostics; sent commands are not counted as successful spells.
- Threat-based retreat independent of the damage target, including survival movement
  during dangerous casting waits.

Navigation is reactive, not map-aware pathfinding. Retries cannot guarantee a route
through unknown geometry. Blink navigation, Polymorph execution, healer-protection
tactics, and additional classes remain future work.

See the [v0.8.0 review](docs/RETROSPECTIVE-0.8.0.md) for the survival failure that
motivated these changes and the separate, unresolved server-owned NPC pursuit stall.

## Develop and compare

Running a second agent? See [Opponent quickstart](docs/OPPONENT-QUICKSTART.md)
for separate sessions, opposing teams, a pinned baseline, and an agent handoff.

```sh
npm test
npm run check
npm run replay -- runs/<run>/events.jsonl /path/to/native-rules.json
```

Replay proposes commands without a socket. Recorded world states do not react
to those commands, so replay cannot simulate a rematch or establish win rates.

Each run stores controller version, Git revision/dirty state, server release/build,
intents, snapshots, and diagnostics. Socket results and available authenticated
reports are retained. Recording is capped at 64 MiB per run, with explicit truncation.

| Path | Purpose |
| --- | --- |
| `src/controller.mjs` | Pure frost-mage policy |
| `src/navigation.mjs` | Displacement and recovery |
| `src/client.mjs` | Admission, socket, lifecycle, commands, reports |
| `src/session.mjs` | Same-origin authenticated HTTP |
| `src/recording.mjs` | Bounded records and structured credential redaction |
| `bin/arena.mjs` | CLI |
| `test/` | Offline behavior and lifecycle tests |
| `docs/` | Protocol, release process, retrospective |
| `.secrets/`, `.local/`, `runs/` | Ignored operator-local data |

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CHANGELOG.md](CHANGELOG.md). The package is private to prevent accidental npm
publication. No remote or public release is created automatically. Licensed
under ISC, matching the original package declaration.
