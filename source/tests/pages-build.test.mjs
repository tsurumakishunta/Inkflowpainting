import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const outputUrl = new URL("../pages-dist/", import.meta.url);

test("builds a self-contained GitHub Pages application", async () => {
  const html = await readFile(new URL("index.html", outputUrl), "utf8");
  const assetNames = await readdir(new URL("assets/", outputUrl));
  const scriptName = assetNames.find((name) => name.endsWith(".js"));
  const styleName = assetNames.find((name) => name.endsWith(".css"));

  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/Inkflowpainting\/assets\/[^"']+\.js/);
  assert.match(html, /\/Inkflowpainting\/assets\/[^"']+\.css/);
  assert.ok(scriptName, "JavaScript bundle was not generated");
  assert.ok(styleName, "CSS bundle was not generated");

  const [script, styles] = await Promise.all([
    readFile(new URL(`assets/${scriptName}`, outputUrl), "utf8"),
    readFile(new URL(`assets/${styleName}`, outputUrl), "utf8"),
  ]);

  assert.match(script, /webgl2/);
  assert.match(styles, /\.ink-app/);
  assert.match(styles, /\.control-deck\.is-ready\.is-mobile-open/);
});
