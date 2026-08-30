# Security Policy

## Supported versions

JSkelet is pre-1.0. Only the latest published `0.x` release receives security
fixes; there are no backports to earlier `0.x` versions.

| Version | Supported |
| --- | --- |
| latest `0.x` | yes |
| older `0.x` | no |

The framework requires **Node.js 22 or newer**. Running it on an unsupported
Node version is not a JSkelet vulnerability.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use one of these channels instead:

- GitHub's private reporting form: **Security → Report a vulnerability** on
  [the repository](https://github.com/ayberkenis/jskelet/security/advisories/new).
- Email **ayberk@ayberkenis.com.tr**.

Include as much of the following as you can:

- The affected version and the surface involved (server, build, dev server,
  client runtime).
- A description of the impact — what an attacker can read, change or run.
- Steps to reproduce, ideally as a minimal application based on
  `examples/minimal`.
- Whether the issue requires a specific `jskelet.config.mjs` shape, and which
  fields.

## What to expect

- We aim to acknowledge a report within **72 hours**.
- We will confirm the issue, agree on a severity, and tell you our intended fix
  and timeline.
- Once a fix is released we publish an advisory. You will be credited unless you
  ask us not to be.
- Please give us a reasonable window to ship a fix before disclosing publicly.

## In scope

- Cross-site scripting through render helpers, metadata, or template locals.
- Cache poisoning or cross-request leakage in the HTML TTL cache — for example a
  personalized response being stored and then served to another visitor.
- Path traversal in static asset serving, view resolution, or the build
  pipeline.
- Bypass of the dev gate, or exposure of dev-only surfaces (devtools overlay,
  report page, dev endpoints) in production.
- Server-side request forgery through the upstream proxy or rewrites.
- Header or redirect injection through `headers()`, `redirects()` or
  `rewrites()`.

## Out of scope

- Vulnerabilities in an application built with JSkelet that come from its own
  code, its data sources, or its configuration — report those to that project.
- Missing hardening headers that the application chose not to configure.
  Defaults are documented in [docs/07-yapilandirma.md](./docs/07-yapilandirma.md).
- Denial of service caused purely by request volume against a single Node
  process, or by a `revalidate` value the application set itself.
- Vulnerabilities that require the attacker to already run code in the server
  process or to control the source tree.
- Findings from automated scanners with no demonstrated impact.

## Note on cached HTML

By design, HTML rendered through `route()` is cached and shared by every
visitor. A report showing that user-specific content placed in a cached page
leaks to other users is a valid *application* bug, but it is only a framework
vulnerability if the framework caused the personalization to be cached despite
the documented contract. Per-user markup belongs in fragment endpoints marked
`no-store`; see [docs/06-cache.md](./docs/06-cache.md).
