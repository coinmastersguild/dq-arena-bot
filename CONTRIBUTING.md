# Contributing

Use Node.js 22+ and `npm ci`. Run `npm test`, `npm run check`, and
`npm pack --dry-run` before proposing changes. Tests need no network or account.

Keep decisions independent of transport and wallets. Inject sends and diagnostics.
Use minimal synthetic protocol fixtures; do not commit actual cookie jars or
raw user recordings. Movement changes need displacement/stall/stop tests.
Combat changes need failed and ignored actions as well as successful sends.

Update the changelog and state what has not been verified live. Coordinate live
tests with participants using your own account. Do not use operator diagnostics
or spectator data to bypass MAD restrictions.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for release and live acceptance gates.
