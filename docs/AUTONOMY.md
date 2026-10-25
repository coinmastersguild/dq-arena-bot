# Continuous Arena operation and GLM review

Version 0.8.0 adds an opt-in service that plays indefinitely. The previous five-round
tournament runner remains available separately. Manual mode still has a session
deadline and never automatically readies after reconnecting.

The service joins, chooses its configured team and readies when another human
occupies the opposing side. After a played round it records the result and holds
readiness for at least five minutes. One GLM review runs during that interval.
Validated settings activate only after an unready lobby acknowledgement. Inference
failure, an exhausted budget or an invalid proposal keeps the current policy and
allows play to continue. Pausing prevents future ready commands; an underway fight
continues until completion.

## Configure

Add this to your ignored `bot.config.json`:

```json
{
  "autonomy": {
    "enabled": true,
    "reviewSeconds": 300,
    "retainRuns": 100,
    "inference": {
      "enabled": true,
      "model": "glm-5.3-flash-local",
      "maxOutputTokens": 2048,
      "requestsPerDay": 12,
      "tokensPerDay": 120000
    }
  }
}
```

Set `PIONEERS_API_KEY` in the service's environment. An existing Pioneer login can
instead be read from `autonomy.inference.authTokenFile`, a private JSON file with a
`token` field. Relative paths resolve beside the config. Neither an API key nor a
JWT belongs in source control or a launchd plist. Authentication is sent only to
`https://alpha.pioneers.dev/api/v1` with redirects disabled. The service reads the
credential for each review, allowing external renewal without restarting it.

The [Alpha API documentation](https://alpha.pioneers.dev/docs) describes authenticated
model discovery and paid chat completions. This client requires the concrete GLM
model's advertised context and output capacity; it never switches to another model.
There is one request at most per reviewed round, no paid request replay, and no
credit purchases. UTC daily request and conservative token reservations persist
across process restarts. Reservations include UTF-8 prompt bytes plus formatting
allowance and maximum output; failed calls still consume the local reservation.
These are usage limits, not a currency-denominated spending guarantee. Alpha's own
credit balance and billing remain authoritative.

## Run and supervise

```sh
npm run service -- --config bot.config.json
```

This process retries broken connections/startup with exponential backoff capped at
five minutes. It checks stale sockets, renews the Arena connection lease, recovers
dead-process locks, and preserves review state across restarts. A process supervisor
is still needed to restart the service process itself after a crash.

On macOS, generate a credential-free launchd definition:

```sh
npm run service:plist -- --config bot.config.json
launchctl bootstrap gui/$(id -u) "$PWD/.local/dq-arena-bot.plist"
launchctl print gui/$(id -u)/dev.coinmastersguild.dq-arena-bot
```

The workspace plist stays registered for the current login session. To register
again after login, the operator can install it in `~/Library/LaunchAgents/` using
normal macOS administration. An always-on Linux host can instead supervise
`node /absolute/path/bin/service.mjs --config /absolute/path/bot.config.json` with
systemd (`Restart=always`, a dedicated user and the correct working directory).
No hosting or machine-sleep settings are changed by this repository.

```sh
npm run bot -- status --config bot.config.json
npm run bot -- pause --config bot.config.json
npm run bot -- resume --config bot.config.json
npm run bot -- stop --config bot.config.json
```

`unready` also pauses autonomy. `ready` resumes it but honors the five-minute gate.
`stop` writes a durable `service.halt` marker before stopping the runner, so a
supervisor does not immediately undo the operator's stop. To resume after stop,
remove `<stateDirectory>/service.halt`; the supervised service notices within a
second. To unload launchd completely:

```sh
launchctl bootout gui/$(id -u)/dev.coinmastersguild.dq-arena-bot
```

Inspect `status.json`, `service.json`, `autonomy.json`, and `last-event.json` in the
configured private state directory. Launch failures before initialization go to
`service-error.log`; rotate that operator log if failures persist. Real uptime
requires an awake, connected host, a running login/service supervisor and valid
Arena/Pioneer authentication. Connection-lease renewal does not renew login cookies.
The bot does not sign wallet messages or buy access when authentication expires.

## What GLM can change

The model receives numerical combat summaries, current strategy settings and
explicit bounds. It gets no player names, wallet data, cookies, files, chat, raw
events or tool access. A response can change at most two of nine parameters, each
with a bounded step: casting/retreat spacing, shield health threshold, healer/tank
priority, execute health, target stickiness, focus reevaluation timing and LOS delay.

Proposals pass schema, bounds and six behavioral smoke checks before activation.
The model cannot alter command gates, spell legality, credentials, endpoints,
readiness timing, budgets, code or dependencies. The controller rejects policy
changes in countdown/fight. A review superseded by combat is discarded. A trial
that produces no completed casts despite thirty seconds alive queues its parent
policy for rollback at the next lobby.

Versions have two layers: code release `0.8.0`, and policy IDs `p0000`, `p0001`, etc.
Private policy records preserve parameters, parent ID, source round, model, usage,
rationale and validation. Round records bind outcomes to the policy actually used.
These are experiments: smoke checks catch invalid behavior, not weak strategy, and
automatic rollback detects only one severe failure. Changing teams/opponents means
raw win rates cannot prove a policy improved.

Recordings rotate at the next countdown after each result. Up to `retainRuns` new
continuous-mode recordings are retained, each capped at 64 MiB; older manual runs
are untouched. Private policy history is retained separately. Results have immutable
round IDs as well as the backward-compatible latest `result.json`. Reports are
matched to result time and saved into that result's recording directory.
