/**
 * robots.txt altına framework Disallow bloğu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { compression } from "../src/server/middleware/compression.js";
import {
  appendFrameworkRobots,
  frameworkDisallowPaths,
  frameworkRobotsNote,
  robotsTxtMiddleware,
} from "../src/server/middleware/robots-txt.js";

const PATHS = ["/_jskelet/", "/__jskelet/", "/_fragment/"];

test("frameworkDisallowPaths: reserved prefixes, mounted custom paths only", () => {
  assert.deepEqual(frameworkDisallowPaths({}), PATHS);

  const paths = frameworkDisallowPaths(
    {
      admin: { enabled: true, basePath: "/yonetim" },
      images: { remote: { enabled: true, path: "/_jskelet/image" } },
      auth: { crossSubdomainHandoff: { path: "/auth/handoff" } },
      brand: { devBasePath: "/dev-tools" },
    },
    { dev: true },
  );

  assert.deepEqual(paths, [
    "/_jskelet/",
    "/__jskelet/",
    "/_fragment/",
    "/yonetim",
    "/auth/handoff",
    "/dev-tools",
  ]);
});

test("frameworkDisallowPaths: disabled features and production dev path stay out", () => {
  const paths = frameworkDisallowPaths(
    {
      admin: { enabled: false, basePath: "/panel" },
      images: false,
      auth: { crossSubdomainHandoff: false },
      brand: { devBasePath: "/dev-tools" },
    },
    { dev: false },
  );

  assert.deepEqual(paths, PATHS);
});

test("frameworkDisallowPaths: refuses the site root", () => {
  const paths = frameworkDisallowPaths({
    admin: { enabled: true, basePath: "/" },
  });
  assert.deepEqual(paths, PATHS);
});

test("appendFrameworkRobots: note under the file, agents repeated", () => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    "User-agent: Googlebot",
    "Disallow: /taslak",
    "",
    "Sitemap: https://example.com/sitemap.xml",
    "",
  ].join("\n");

  const next = appendFrameworkRobots(body, {
    brandName: "JSkelet",
    paths: PATHS,
  });

  assert.match(next, /Sitemap: https:\/\/example\.com\/sitemap\.xml\n\n# JSkelet — framework endpoints, not for indexing\n/);
  assert.match(next, /User-agent: \*\nUser-agent: Googlebot\nDisallow: \/_jskelet\//);
  assert.match(next, /Disallow: \/_fragment\/\n$/);
  assert.equal(
    appendFrameworkRobots(next, { brandName: "JSkelet", paths: PATHS }),
    next,
  );
});

test("appendFrameworkRobots: empty file still gets a star group", () => {
  const next = appendFrameworkRobots("", {
    brandName: "JSkelet",
    paths: PATHS,
  });
  assert.equal(next.startsWith(frameworkRobotsNote("JSkelet")), true);
  assert.match(next, /User-agent: \*/);
});

test("robots.txt route and static file gain the block; other bodies do not", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-robots-"));
  fs.writeFileSync(
    path.join(dir, "robots.txt"),
    "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n",
  );

  const app = express();
  app.use(compression());
  app.use(robotsTxtMiddleware());
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: Googlebot\nAllow: /\n");
  });
  app.get("/page", (_req, res) => {
    res.type("html").send("<p>merhaba</p>");
  });

  const origin = await listen(app);

  const fileApp = express();
  fileApp.use(compression());
  fileApp.use(robotsTxtMiddleware());
  fileApp.use(express.static(dir));
  const fileOrigin = await listen(fileApp);

  try {
    const route = await fetch(`${origin.url}/robots.txt`);
    const routeBody = await route.text();
    assert.equal(route.status, 200);
    assert.match(String(route.headers.get("content-type")), /^text\/plain/);
    assert.match(routeBody, /User-agent: Googlebot\nAllow: \//);
    assert.match(routeBody, /# JSkelet — framework endpoints, not for indexing/);
    assert.match(routeBody, /User-agent: \*\nUser-agent: Googlebot\nDisallow: \/_jskelet\//);
    assert.match(routeBody, /Disallow: \/__jskelet\//);
    assert.match(routeBody, /Disallow: \/_fragment\//);
    assert.equal((routeBody.match(/framework endpoints, not for indexing/g) || []).length, 1);

    const again = await fetch(`${origin.url}/robots.txt`, {
      headers: { "if-none-match": route.headers.get("etag") ?? "" },
    });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");

    const file = await fetch(`${fileOrigin.url}/robots.txt`, {
      headers: { "accept-encoding": "br" },
    });
    const fileBody = await file.text();
    assert.match(fileBody, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
    assert.match(fileBody, /Disallow: \/_fragment\//);

    const page = await fetch(`${origin.url}/page`);
    assert.equal(await page.text(), "<p>merhaba</p>");
  } finally {
    await origin.close();
    await fileOrigin.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("robots.txt skips html, non-text, and encoded bodies", async () => {
  const app = express();
  app.use(robotsTxtMiddleware());
  app.get("/robots.txt", (req, res) => {
    if (req.query.kind === "html") {
      res.type("html").send("<!doctype html><p>no</p>");
      return;
    }
    if (req.query.kind === "json") {
      res.type("json").send({ ok: true });
      return;
    }
    res.setHeader("Content-Encoding", "identity");
    res.type("text/plain").send("User-agent: *\nAllow: /\n");
  });

  const origin = await listen(app);

  try {
    const html = await fetch(`${origin.url}/robots.txt?kind=html`);
    assert.equal(await html.text(), "<!doctype html><p>no</p>");

    const json = await fetch(`${origin.url}/robots.txt?kind=json`);
    assert.equal(await json.text(), JSON.stringify({ ok: true }));

    const encoded = await fetch(`${origin.url}/robots.txt`);
    assert.equal(await encoded.text(), "User-agent: *\nAllow: /\n");
  } finally {
    await origin.close();
  }
});

/**
 * @param {import('express').Express} app
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = /** @type {import('net').AddressInfo} */ (server.address());
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
