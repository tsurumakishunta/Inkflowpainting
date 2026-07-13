import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the water-ink studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ja"/i);
  assert.match(html, /<title>水墨 — 水に、墨をほどく。<\/title>/i);
  assert.match(html, /水に、/);
  assert.match(html, /墨をほどく。/);
  assert.match(html, /手描き/);
  assert.match(html, /色うつろい/);
  assert.match(html, /墨流し/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the fluid experience and its controls wired", async () => {
  const [page, engine, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fluid-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /new FluidEngine\(canvas\)/);
  assert.match(page, /engine\.disperse\(/);
  assert.match(page, /engine\.stir\(/);
  assert.match(page, /onPointerDown=/);
  assert.match(page, /type="range"/);
  assert.match(page, /snapshot\(\)/);
  assert.match(engine, /class FluidEngine/);
  assert.match(engine, /stir\(/);
  assert.doesNotMatch(engine, /deposit\s*=\s*1\.0\s*\+/);
  assert.doesNotMatch(engine, /cleared\s*\+\s*carried/);
  assert.doesNotMatch(engine, /edgeDeposit/);
  assert.match(engine, /vUv\s*=\s*p\s*;/);
  assert.doesNotMatch(engine, /vUv\s*=\s*p\s*\*\s*0\.5/);
  assert.match(page, /useState<Mode>\("auto"\)/);
  assert.match(layout, /lang="ja"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
