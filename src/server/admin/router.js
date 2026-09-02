/**
 * Admin paneli Express router'ı.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { FRAMEWORK_ROOT } from "../../config/index.js";
import {
  ACTION_HEADER,
  authenticated,
  clearSessionCookie,
  createSession,
  destroySession,
  passwordMatches,
  sessionCookie,
} from "./auth.js";
import { clearOffender, gateMiddleware, noteFailure } from "./gate.js";
import { snapshot } from "./snapshot.js";
import { runAction } from "./actions.js";
import {
  list as listLogs,
  subscribeLive,
} from "./event-log.js";
import {
  listExpressRoutes,
  listRouteModules,
  listViews,
  routeActivity,
} from "./inventory.js";
import {
  cloudflareConfigured,
  fetchCacheAnalytics,
  fetchCloudflareOverview,
  fetchPathEdges,
} from "../cloudflare.js";

const PANEL_DIR = path.join(FRAMEWORK_ROOT, "src", "client", "admin");

/**
 * @param {() => typeof import('../../config/defaults.js').DEFAULT_ADMIN} getSettings
 * @param {import('express').Express} app
 * @returns {import('express').Router}
 */
export function createAdminRouter(getSettings, app) {
  const api = express.Router();

  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  api.use(gateMiddleware(getSettings));

  // Soft page routes → aynı shell (client path ile sekme seçer).
  // JSON API'ler ayrı `/api/*` altında: `/logs` hem sayfa hem döküm olamaz.
  const shellPages = ["/", "/cache", "/routes", "/views", "/logs", "/system"];
  for (const page of shellPages) {
    api.get(page, (req, res) => {
      const settings = getSettings();
      const bare = req.originalUrl.split("?")[0];
      if (page === "/" && !bare.endsWith("/")) {
        res.redirect(302, `${settings.basePath}/`);
        return;
      }

      res.type("html");
      sendFile(res, authenticated(req) ? "panel.html" : "login.html");
    });
  }

  api.get("/panel.css", (req, res) => {
    res.type("text/css");
    sendFile(res, "panel.css");
  });

  api.get("/i18n.js", (req, res) => {
    res.type("application/javascript");
    sendFile(res, "i18n.js");
  });

  api.get("/logo.png", (req, res) => {
    res.type("image/png");
    fs.createReadStream(path.join(FRAMEWORK_ROOT, "src", "logo.png")).pipe(res);
  });

  api.post("/login", express.json({ limit: "4kb" }), (req, res) => {
    const settings = getSettings();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!passwordMatches(password)) {
      noteFailure(req, password ? "wrong password" : "empty password", settings);
      res.status(401).json({ ok: false, message: "Invalid password" });
      return;
    }

    const { token, maxAge } = createSession(settings.sessionHours);
    clearOffender(req);
    res.setHeader("Set-Cookie", sessionCookie(settings.basePath, token, maxAge));
    res.json({ ok: true });
  });

  api.use((req, res, next) => {
    if (authenticated(req)) return next();

    if (req.method !== "GET" && req.method !== "HEAD") {
      noteFailure(req, `unauthenticated ${req.method} ${req.path}`, getSettings());
    }

    res.status(404).type("text/plain").send("Not Found");
  });

  api.post("/logout", (req, res) => {
    const settings = getSettings();
    destroySession(req);
    res.setHeader("Set-Cookie", clearSessionCookie(settings.basePath));
    res.json({ ok: true });
  });

  api.get("/panel.js", (req, res) => {
    res.type("application/javascript");
    sendFile(res, "panel.js");
  });

  api.get("/data", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    res.json(await snapshot(query));
  });

  api.get("/api/routes", (req, res) => {
    res.json({
      routes: listExpressRoutes(app),
      modules: listRouteModules(),
      activity: routeActivity(),
    });
  });

  api.get("/api/views", (req, res) => {
    res.json({ views: listViews() });
  });

  api.get("/api/logs", (req, res) => {
    const after = Number(req.query.after) || 0;
    const limit = Number(req.query.limit) || 200;
    res.json({ entries: listLogs(after, limit) });
  });

  api.get("/api/logs/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const replay = listLogs(0, 100);
    for (const entry of replay) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsubscribe = subscribeLive((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  api.get("/cloudflare", async (req, res) => {
    res.json(await fetchCloudflareOverview({ force: req.query.force === "1" }));
  });

  api.post("/cloudflare/analytics", express.json({ limit: "8kb" }), async (req, res) => {
    if (!cloudflareConfigured()) {
      res.json({ ok: false, error: "not configured" });
      return;
    }

    const hours = Number(req.body?.hours) || undefined;
    const pathValue = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    res.json(
      pathValue
        ? await fetchPathEdges({ path: pathValue, hours })
        : await fetchCacheAnalytics({ hours }),
    );
  });

  api.post("/action", express.json({ limit: "64kb" }), async (req, res) => {
    if (req.get(ACTION_HEADER) !== "1") {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    try {
      res.json(await runAction(req.body ?? {}, req));
    } catch (error) {
      console.error("[admin] action failed", error);
      res.status(500).json({ ok: false, message: "Action failed, see server logs" });
    }
  });

  return api;
}

/**
 * @param {import('express').Response} res
 * @param {string} name
 */
function sendFile(res, name) {
  fs.createReadStream(path.join(PANEL_DIR, name)).pipe(res);
}
