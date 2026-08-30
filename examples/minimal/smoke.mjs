/**
 * Minimal örneğin ayakta olduğunu doğrular.
 *
 *   node smoke.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3211";

/** @type {Array<[string, number, RegExp?]>} */
const CASES = [
  ["/", 200, /data-island="counter"/],
  ["/hakkinda", 200, /Hakkında/],
  ["/yok", 404],
];

let failed = 0;

for (const [pathname, expectedStatus, expectedBody] of CASES) {
  const response = await fetch(`${BASE}${pathname}`);
  const body = await response.text();

  const ok =
    response.status === expectedStatus && (!expectedBody || expectedBody.test(body));
  if (!ok) failed += 1;

  console.log(
    `${ok ? "✓" : "✗"} ${pathname.padEnd(14)} ${response.status} cache=${response.headers.get("x-jskelet-cache") ?? "-"}`,
  );
}

console.log(failed ? `\n${failed} test(s) failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
