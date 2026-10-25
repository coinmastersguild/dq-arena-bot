# Improvement tournament

Tournament mode is an operator/agent workflow, not an unattended code-generating bot.
Each round uses a fixed committed controller version. After results, spend five
minutes reviewing evidence, making a focused change, and testing it. Restart into
the lobby unready; ready only after the window ends and the opponent is present.
Use the last passing version if a candidate fails checks. Never edit code during a fight.

The local ledger at `.local/tournament/state.json` records round limit, account,
opponent, side, improvement window, active recording, and completed results. It is
private and ignored. Initialize it for your own participants before using the CLI.
Example fields: `roundLimit: 5`, `improvementSeconds: 300`, `rounds: []`,
`account`, `opponent`, `side`, and an ISO timestamp `readyNotBefore`.

```sh
npm run tournament -- status
npm run tournament -- ready
# After the active run has a complete result:
npm run tournament -- record
```

The gate checks elapsed time, fresh lobby state, player identity, opposing seat,
and round limit. Recording validates both participants and prevents duplicate rounds.
Each round should use a fresh runner/recording directory. Keep both sides' improvement
windows aligned; an early-ready opponent still waits for the other seat.

Report wins, losses, duration, damage, casting, and errors per version. Log lineup
and server-build changes from the full reports. An evolving-agent tournament is
not a controlled estimate of one version's win rate. Do not read the other agent's
workspace or credentials to improve your policy.
