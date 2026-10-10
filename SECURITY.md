# Security policy

## Report a vulnerability

Do not open a public issue for a security problem.

Report it privately on GitHub: open the
[Security tab](https://github.com/Checkend/checkend/security) and click **Report a vulnerability**.
Include the steps to reproduce, the affected version (`GET /health` shows it), and the impact.

We confirm each report within 3 working days. We tell you when the fix is released, and we
credit you in the release notes if you want.

## Supported versions

Checkend is in early development. Only the latest release and `main` get security fixes.

## Scope

In scope: the code in this repository (the Worker, its adapters, migrations and tools).

Out of scope: vulnerabilities in Cloudflare, in Sentry SDKs, or in your own deployment settings.
Report those to their owners.
