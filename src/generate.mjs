/**
 * `jskelet generate` — feature / page / island iskeleti.
 *
 * Var olan dosyaların üzerine yazmaz. Route kaydı hâlâ açık `register`
 * sözleşmesine bağlıdır; filesystem URL türetme yoktur.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as log from "./log.mjs";

/**
 * @param {string} name
 * @returns {string}
 */
function toPascal(name) {
  return name
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/**
 * @param {string} file
 * @param {string} contents
 * @returns {boolean} yazıldı mı
 */
function writeIfMissing(file, contents) {
  if (fs.existsSync(file)) {
    log.line(`skip ${path.relative(process.cwd(), file)} (exists)`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
  log.line(`create ${path.relative(process.cwd(), file)}`);
  return true;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export async function generate(root, args) {
  const [kind, target] = args;
  if (!kind || !target) {
    throw new Error(
      "usage: jskelet generate <feature|page|island> <name>\n" +
        "  feature  features/<name>/{index.js,server,views,client}\n" +
        "  page     features/<feature>/views/pages/<name>.jsk  (name: feature/page)\n" +
        "  island   features/<feature>/client/<name>.js       (name: feature/island)",
    );
  }

  if (kind === "feature") {
    await generateFeature(root, target);
    return;
  }
  if (kind === "page") {
    const [feature, page] = splitTarget(target);
    await generatePage(root, feature, page);
    return;
  }
  if (kind === "island") {
    const [feature, island] = splitTarget(target);
    await generateIsland(root, feature, island);
    return;
  }

  throw new Error(`unknown generate kind: ${kind}`);
}

/**
 * @param {string} target
 * @returns {[string, string]}
 */
function splitTarget(target) {
  const parts = target.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`expected <feature>/<name>, got "${target}"`);
  }
  return [parts[0], parts.slice(1).join("/")];
}

/**
 * @param {string} root
 * @param {string} name
 */
async function generateFeature(root, name) {
  const base = path.join(root, "features", name);
  writeIfMissing(
    path.join(base, "index.js"),
    `/**
 * Feature route registration. Explicit paths only — no filesystem URL routing.
 * @param {import('express').Express} app
 * @param {{ route: Function }} api
 */
export default function register(app, { route }) {
  app.get(
    "/${name}",
    route(async () => ({
      view: "pages/${name}",
      metadata: { title: "${toPascal(name)}" },
      data: {},
    })),
  );
}
`,
  );
  writeIfMissing(path.join(base, "server", ".gitkeep"), "");
  writeIfMissing(
    path.join(base, "views", "pages", `${name}.jsk`),
    `<section class="wrapper">
  <h1>{{ metadata.title }}</h1>
</section>
`,
  );
  writeIfMissing(path.join(base, "client", ".gitkeep"), "");
  log.ready({ label: `Feature ${name}` });
}

/**
 * @param {string} root
 * @param {string} feature
 * @param {string} page
 */
async function generatePage(root, feature, page) {
  const file = path.join(root, "features", feature, "views", "pages", `${page}.jsk`);
  writeIfMissing(
    file,
    `<section class="wrapper">
  <h1>{{ metadata.title }}</h1>
</section>
`,
  );
  log.ready({ label: `Page ${feature}/${page}` });
}

/**
 * @param {string} root
 * @param {string} feature
 * @param {string} island
 */
async function generateIsland(root, feature, island) {
  const file = path.join(root, "features", feature, "client", `${island}.js`);
  writeIfMissing(
    file,
    `/**
 * @param {HTMLElement} element
 * @param {Record<string, unknown>} props
 * @returns {void | (() => void)}
 */
export function mount(element, props) {
  element.textContent = String(props.label ?? "${island}");
}
`,
  );
  log.line(
    `Register in client/entries/main.js: "${island}": () => import("../../features/${feature}/client/${island}.js")`,
  );
  log.ready({ label: `Island ${feature}/${island}` });
}
