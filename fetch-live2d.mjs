#!/usr/bin/env node
/*
 * fetch-live2d — download the Live2D runtime libs (and an optional sample model)
 * into the pet's live2d folder. These are NOT committed to the repo:
 *   - Live2D Cubism Core is proprietary (Live2D license)
 *   - PIXI / pixi-live2d-display are pulled at pinned versions
 *   - models are copyrighted; bring your own
 *
 * Usage:
 *   node fetch-live2d.mjs                 # libs + Haru sample -> userData
 *   node fetch-live2d.mjs --no-model      # libs only
 *   node fetch-live2d.mjs --dir <path>    # custom live2d dir
 *   node fetch-live2d.mjs --model <model3.json URL> --name <folder>
 *   node fetch-live2d.mjs --force         # re-download existing files
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);

const APPDATA = process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
const DIR = opt("--dir", join(APPDATA, "ai.opencode.desktop", "skins", "pet", "live2d"));
const FORCE = flag("--force");

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const ok = (s) => console.log(c(32, "✓ ") + s);
const info = (s) => console.log(c(36, "• ") + s);
const die = (s) => { console.error(c(31, "✗ ") + s); process.exit(1); };

const VENDOR = {
  "live2dcubismcore.min.js": "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
  "pixi.min.js": "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
  "cubism4.min.js": "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js",
};
const SAMPLE_BASE = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru";
const SAMPLE_MODEL = SAMPLE_BASE + "/haru_greeter_t03.model3.json";

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function save(path, buf) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); }

async function fetchVendor() {
  const dir = join(DIR, "vendor");
  info("vendor -> " + dir);
  for (const [name, url] of Object.entries(VENDOR)) {
    const dst = join(dir, name);
    if (existsSync(dst) && !FORCE) { info("  skip " + name + " (exists)"); continue; }
    const buf = await get(url);
    save(dst, buf);
    ok(`  ${name}  (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}

// Parse a model3.json and download every referenced file, preserving layout.
async function fetchModel(modelUrl, folder) {
  const base = modelUrl.slice(0, modelUrl.lastIndexOf("/"));
  const modelDir = join(DIR, "model", folder);
  info(`model "${folder}" <- ${base}`);
  const jsonBuf = await get(modelUrl);
  save(join(modelDir, modelUrl.slice(base.length + 1)), jsonBuf);
  const j = JSON.parse(jsonBuf.toString("utf8"));
  const f = j.FileReferences || {};
  const essential = new Set();
  const optional = new Set();
  if (f.Moc) essential.add(f.Moc);
  (f.Textures || []).forEach((t) => essential.add(t));
  if (f.Physics) optional.add(f.Physics);
  if (f.Pose) optional.add(f.Pose);
  if (f.DisplayInfo) optional.add(f.DisplayInfo);
  if (f.UserData) optional.add(f.UserData);
  Object.values(f.Motions || {}).forEach((arr) => (arr || []).forEach((m) => { if (m.File) optional.add(m.File); }));
  (f.Expressions || []).forEach((e) => { if (e.File) optional.add(e.File); });
  let n = 0, bytes = 0, skipped = 0;
  const grab = async (ref, required) => {
    const dst = join(modelDir, ref);
    if (existsSync(dst) && !FORCE) { n++; return; }
    try { const buf = await get(base + "/" + ref); save(dst, buf); n++; bytes += buf.length; }
    catch (e) { if (required) throw e; skipped++; info("  skip (optional, " + e.message.split(" ")[1] + ") " + ref); }
  };
  for (const ref of essential) await grab(ref, true);
  for (const ref of optional) await grab(ref, false);
  ok(`  ${folder}: ${n} files (${(bytes / 1048576).toFixed(1)} MB)${skipped ? ", " + skipped + " optional missing" : ""}`);
  return "live2d/model/" + folder + "/" + modelUrl.slice(base.length + 1);
}

(async () => {
  if (typeof fetch !== "function") die("global fetch missing — need Node 18+.");
  mkdirSync(DIR, { recursive: true });
  try {
    await fetchVendor();
    if (!flag("--no-model")) {
      const url = opt("--model", SAMPLE_MODEL);
      const name = opt("--name", url === SAMPLE_MODEL ? "haru" : "custom");
      const rel = await fetchModel(url, name);
      console.log("");
      ok("Model ready. Point the pet at it in active.json:");
      console.log(`    "pet": { "model": "${rel}" }`);
    }
    console.log("");
    ok("Done. Relaunch OpenCode (or Ctrl+Alt+R) to load the Live2D pet.");
  } catch (e) {
    die(e.message || String(e));
  }
})();
