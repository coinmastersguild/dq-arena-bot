# Security and local data

The runner reads an existing session cookie, not a wallet seed or private key.
Keep cookies/state under `.secrets/` with directory mode 0700 and files 0600.
The cookie jar and legacy local wallet files are unencrypted and must not be shared.

Git ignores `.secrets/`, `.local/`, `runs/`, local config, environment files,
and downloaded admission helpers. npm uses an explicit file allowlist. Do not
force-add ignored files. Review the entire history before public release.

Recordings recursively redact structured credential fields, but arbitrary free-form
server text may still contain sensitive data. Recordings remain private and ignored;
review and sanitize before sharing. A recording-limit file marks truncation.

The configured HTTPS origin receives the session cookie. Cookies are filtered by
domain, expiry, secure flag, and root path; redirects are rejected. Configure only
an origin you trust. This package uses no operator endpoints and signs no transactions.

Report vulnerabilities privately to the eventual repository maintainer. Until a
public security contact exists, do not post credentials or exploit details in issues.
Rotate any exposed session before sharing evidence.
