# 10 — Deployment

This document explains how to put a JSkelet application into production: the
prod build and start flow, the environment variables you should set, a working
Docker setup, reverse proxy and `trust proxy` notes, how a health check endpoint
is added, and how the cache behaves when you scale out. What the build steps do
is in [08-build.md](./08-build.md), cache behavior in
[06-caching.md](./06-caching.md).

## The prod flow

```bash
npm ci
npm run build     # jskelet build
npm start         # jskelet start
```

If `NODE_ENV` is not given, `jskelet build` sets it to `production` and runs all
steps: fonts, icon sprite, CSS, client JS, images, manifest, precompress.

`jskelet start` first looks for `.jskelet/manifest.json`; if it is missing, it
runs the build itself. In a Docker image the build has already happened, so this
is a no-op; the point is that someone running `npm start` directly does not end
up with an unstyled page.

When the server is ready it prints a single line:

```
jskelet → http://localhost:3000 (production)
```

The process is protected by two safety nets: `unhandledRejection` and
`uncaughtException` are logged and the process stays up. On a news site, an
error on a single page should not take the whole site down. If you want to hook
this up to your own error tracking tool (Sentry etc.), you can add your own
listener to the same events.

## Environment variables

No variable is required; all of them have a sensible default. The ones worth
considering in production:

| Variable | Recommendation | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | Template cache, reading the manifest once, throwing on a broken route module |
| `PORT` | `3000` | The port your orchestrator expects |
| `HOST` | `0.0.0.0` | Only if you need to listen on IPv4 alone; the `::` default already listens dual-stack |
| `PREWARM_MAX` | Depends on site size | Number of pages warmed at startup |
| `PREWARM_INTERVAL_SECONDS` | `0` or a long value | If you want to keep never-visited pages warm |
| `DEV_TOKEN` | Staging only | Hides an environment that is not public yet |
| `JSKELET_S3_*` | If you write access logs to S3 | Bucket + credentials; details in [07](./07-configuration.md) |

When a file or S3 sink is enabled in production, the HTTP access log middleware
mounts automatically (if `http` is in `logs.kinds`). The admin panel ring is
separate — lines written to disk/S3 do not stream into the panel.

The full list and the precedence order of the prewarm settings:
[07-configuration.md](./07-configuration.md).

Since the CLI runs with `--env-file-if-exists=.env`, a `.env` file is loaded
automatically if it exists; if not, no error is raised. In a container,
environment variables are usually injected directly instead of using this file.
Using both sources together blurs which value actually applies; not shipping a
`.env` in the prod image is the cleanest option.

**Secret keys must not go into the `clientEnv` list:** those values are embedded
into the client bundle as plain text ([08-build.md](./08-build.md)).

## Docker

A multi-stage image: the build stage compiles with dev dependencies, the runtime
stage carries only production dependencies and the build output.

```dockerfile
# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Dependencies in a separate layer: don't reinstall when sources change.
COPY package.json package-lock.json ./
RUN npm ci

# `public/fonts/` must be committed: the build should not need network access.
COPY . .

ENV NODE_ENV=production
RUN npx jskelet build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
# sharp and tailwind are only needed at build time; keep them out of the runtime image.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/jskelet.config.mjs ./jskelet.config.mjs
COPY --from=build /app/jsconfig.json ./jsconfig.json
COPY --from=build /app/routes ./routes
COPY --from=build /app/views ./views
COPY --from=build /app/lib ./lib
COPY --from=build /app/public ./public
COPY --from=build /app/.jskelet ./.jskelet

# Non-root user.
USER node

EXPOSE 3000

# Health check: assumes you added the route below.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthcheck').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "jskelet", "start"]
```

Notes:

- **`client/` and `styles/` are not needed in the runtime image:** their output
  is under `public/assets/`. `views/` and `routes/` are needed, because
  rendering happens at runtime. Copy `lib/` only if your project has one.
- **`.jskelet/` is needed:** without `manifest.json`, `asset()` cannot find the
  hashed URLs and `jskelet start` will try to run the build from scratch.
- **`sharp` is not needed in the runtime image:** it is only for build-time image
  optimization. `--omit=dev` leaves it out (if it was installed as a
  devDependency).
- If you would rather call `jskelet start` without `npx`,
  `CMD ["node", "node_modules/jskelet/bin/jskelet.mjs", "start"]` works too.

`.dockerignore`:

```
node_modules
.git
.jskelet
public/assets
.env
```

The build stage produces these itself with `npx jskelet build`.

### Deploying from a subdirectory of the repo

The examples in this repo pull jskelet with `"jskelet": "file:../.."` rather
than from npm. In tools like Coolify, Railway or Render, if you set the "base
directory" to `examples/marketing`, the build context becomes only that
directory, `../..` falls outside the context, and installation fails at
`npm ci`. The correct setting: **base directory `/`**, Dockerfile location
`/examples/marketing/Dockerfile`. The working example is in
`examples/marketing/Dockerfile` and assumes the repo root as its context:

```bash
docker build -f examples/marketing/Dockerfile -t jskelet-marketing .
docker run --rm -p 3000:3000 -e SITE_URL=https://example.com jskelet-marketing
```

In your own application jskelet will be an ordinary dependency, so this
constraint does not apply; the multi-stage image above is enough.

## Health check

The framework does **not** add a ready-made health check endpoint; you have to
put it in your own route. Since the default `devGateBypass` list contains
`/api/healthcheck`, using that name is the least surprising option: it stays
reachable even in an environment with `DEV_TOKEN` set.

```js
// routes/00-health.mjs
import { getHtmlCacheSize } from "jskelet";

export default function register(app) {
  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      uptime: process.uptime(),
      cache: getHtmlCacheSize(),
    });
  });
}
```

The `00-` prefix in the file name makes sure this route is registered before any
catch-all ([03-routing.md](./03-routing.md)).

If you are going to use a different path, update the `devGateBypass` list,
otherwise your orchestrator will see a 404 on staging:

```js
devGateBypass: ["/healthz", "/robots.txt", "/sitemap.xml", "/favicon.ico"]
```

The warming round does not affect the health check: even if prewarm fails, the
process stays up and pages are served (cold, but served).

If you need to separate readiness from liveness, you can report the warming
status too:

```js
import { prewarmProgress } from "jskelet";

app.get("/api/ready", (req, res) => {
  const warmedUp = !prewarmProgress.active && prewarmProgress.finishedAt !== null;
  res.status(warmedUp ? 200 : 503).json({ warmedUp, ...prewarmProgress });
});
```

Remember to exclude this endpoint's path from warming with `prewarmSkip` (the
default `/api/` prefix already covers it).

## Reverse proxy

The Express application sets `trust proxy` to **on**
(`app.set("trust proxy", true)`). The consequences:

- `req.protocol` is read from the `X-Forwarded-Proto` header, so if the proxy
  terminates TLS, `https` is returned correctly.
- `req.ip` is resolved from the `X-Forwarded-For` chain.
- Absolute URLs produced by `res.redirect()` carry the correct scheme.

This setting **assumes the proxy writes these headers reliably.** If you are
going to expose the application directly to the internet, remember that a client
can fabricate `X-Forwarded-*` headers; always run behind a proxy or load
balancer and make sure the proxy overwrites the incoming `X-Forwarded-For`
header.

An example nginx configuration:

```nginx
upstream jskelet {
  server 127.0.0.1:3000;
  keepalive 32;
}

server {
  listen 443 ssl http2;
  server_name example.com;

  # Response bodies already arrive compressed; don't compress a second time.
  gzip off;

  location / {
    proxy_pass http://jskelet;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        "";

    # Forward it to the upstream so we can get a compressed response.
    proxy_set_header Accept-Encoding   $http_accept_encoding;
  }
}
```

Key points:

- **Do not compress twice.** JSkelet does the brotli/gzip negotiation itself and
  stores the compressed body for cached pages. Leaving nginx's own `gzip` on can
  lead to decompressing brotli and re-gzipping it.
- **Forward `Accept-Encoding`**, otherwise the application will not compress and
  the ready-made compressed bodies in the cache go unused.
- `Vary: Accept-Encoding` is written by the application; proxy caches take it
  into account.

### Together with a CDN

The header written on cacheable pages:

```
Cache-Control: public, max-age=0, s-maxage=<revalidate>, stale-while-revalidate=60
```

`max-age=0` disables browser storage, `s-maxage` tells the CDN the duration. So
the same freshness model works across two layers together: the CDN serves its
own copy for the duration of `s-maxage`, asks the origin when it expires, and
the origin answers instantly from its own cache.

The `X-JSkelet-Cache` header makes it easier to diagnose which layer answered;
read it together with the CDN's own cache header
([06-caching.md](./06-caching.md)).

Static assets (`/assets/`, `/fonts/`) are marked `immutable`, so they can be
held indefinitely on the CDN; when the hash changes, so does the URL.

## Scaling

The HTML cache lives **in process memory**. When you run more than one replica:

- Each replica has its own cache; memory usage is multiplied by the replica
  count (at most 500 entries plus their compressed copies).
- Each replica runs its own warming round at startup. Set `PREWARM_MAX` and
  `PREWARM_CONCURRENCY` so that your upstream API can handle the load
  multiplied by the replica count.
- `clearHtmlCache()` only affects the process it is called in. If you need to
  clear all replicas, you have to solve it at the orchestrator level (a restart)
  or with a broadcast mechanism you write yourself.
- If there is a CDN in front, most requests never reach the origin and the
  per-replica cache difference becomes invisible.

To increase the capacity of a single replica, raising the `revalidate`
durations is usually more effective than adding replicas: as the cache hit rate
goes up, the work per request drops to almost zero.

## Pre-release checklist

- [ ] `NODE_ENV=production`
- [ ] `npm run build` ran and produced `.jskelet/manifest.json`
- [ ] The woff2 files under `public/fonts/` are committed
      ([08-build.md](./08-build.md))
- [ ] The `@source` directives in `styles/globals.css` cover all template
      directories
- [ ] `hooks.notFound()` is defined and there is a 404 template
- [ ] `hooks.metadata()` contains `siteUrl` (so relative `canonical`s become
      absolute)
- [ ] The `cache().html` patterns match the site's freshness profile
- [ ] `hooks.prewarmPaths()` puts the most important pages first
- [ ] CSP and security headers are defined in `headers()`
- [ ] A health check endpoint exists and is in the `devGateBypass` list
- [ ] `DEV_TOKEN` is set on staging and **not set** in production
- [ ] The reverse proxy forwards `Accept-Encoding` and does not do its own
      compression
- [ ] There are no secret keys in the `clientEnv` list

## What's next

- Cache settings and prewarm: [06-caching.md](./06-caching.md)
- All environment variables: [07-configuration.md](./07-configuration.md)
- Migrating from Next.js: [11-migration.md](./11-migration.md)
