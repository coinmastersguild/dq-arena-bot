# Run an opponent with the same toolkit

Use a separate clone/process and DegenQuest account. Never copy another bot's
`.secrets/`, cookie jar, admission ticket, or wallet. This repository contains no
player credentials. An existing named, paid account needs no additional purchase.
Follow the [official onboarding docs](https://degenquest.ai/docs) if needed;
any new purchase requires the wallet owner's authorization and spending limit.

## Reproducible baseline

Clone this repository and use the same tagged controller on both sides:

```sh
git checkout v0.2.0
npm ci
npm test
cp bot.config.example.json bot.config.json
```

Set `side` to `coinfall` for the opponent of a Freehold bot. Place this opponent's
own Netscape-format session cookie jar at `.secrets/cookies.txt`. Restrict the
directory to mode 0700 and cookie file to mode 0600. Session preparation is outside
the runner; it never reads a seed/private key or purchases access.

```sh
npm start -- --config bot.config.json
```

Keep the process running. In another terminal:

```sh
npm run bot -- status --config bot.config.json
```

Verify both accounts appear in the same room on opposing sides with distinct
named player seats, neither spectating. Record native build and Arena release.
This creates a native player, without a MAD invitation or operator credential.

When both operators agree to start:

```sh
npm run bot -- ready --config bot.config.json
```

Joining/reconnecting never automatically readies. Use `unready` in the lobby to
withdraw readiness, or `stop` to release this client's activity. Do not run two
processes against the same account.

## Evidence and limitations

Version 0.2.0 has offline regression coverage, including a simplified obstacle
test. Live obstacle clearance and winning performance remain unverified. Monitor
`navigation-recovery`, `navigation-blocked`, `combat-error`, and `no-combat-effect`
diagnostics during the opening. A terminal block requires intervention; record
that failure separately from tactical results.

Each runner saves versions, builds, events and intents under its own ignored
`runs/` directory and attempts to retrieve the final authenticated report.
Compare completed reports, not submitted command counts. Keep lineups/builds
fixed and mirror sides when comparing versions.

Sharing code does not require sharing live opponent observations. Review and
sanitize recordings before publishing. These are native-player tests, not an
implementation of the separate MAD competition visibility boundary.

## Handoff for another agent

> Set up this repository at v0.2.0 using your own account/session. Use Coinfall
> against the Freehold bot. Read the official native Arena docs and this guide.
> Run the tests, join without readying, and report your player name, room, side,
> controller version, and server build. Ready only when instructed to start.
> Monitor movement progress and confirmed cast outcomes. Preserve final results
> and distinguish controller failures from tactical losses. Never share credentials
> or purchase access without an explicit owner-approved spending budget.
