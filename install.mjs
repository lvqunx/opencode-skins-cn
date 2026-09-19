#!/usr/bin/env node
/*
 * opencode-skins installer
 *
 * Patches OpenCode Desktop's app.asar (2 files) and seeds the skins folder in
 * userData. The patch is a surgical rewrite: only index.html and out/main/index.js
 * change; every unpacked native module stays byte-identical and app.asar.unpacked
 * is never touched. Integrity hashes are recomputed for the 2 patched files.
 *
 * Usage:
 *   node install.mjs [install]        patch asar + seed skins   (default)
 *   node install.mjs uninstall        remove asar patch (keeps skins folder)
 *   node install.mjs uninstall --purge   also delete the skins folder
 *   node install.mjs status           report current state
 *   node install.mjs seed             (re)copy engine + built-in skins only
 *
 * Options:
 *   --app <dir>        app install dir (default: %LOCALAPPDATA%\Programs\@opencode-aidesktop)
 *   --userdata <dir>   Electron userData dir (default: %APPDATA%\ai.opencode.desktop)
 *   --force            proceed even if OpenCode appears to be running
 *
 * Note: fully quit OpenCode before running. Re-run after an app update
 * (an update replaces app.asar and removes the patch; your skins survive).
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  statSync, copyFileSync, rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, "skins");

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = (argv[0] && !argv[0].startsWith("-")) ? argv[0] : "install";
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const flag = (name) => argv.includes(name);

const LOCALAPPDATA = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
const APPDATA = process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
const APP_DIR = opt("--app") || join(LOCALAPPDATA, "Programs", "@opencode-aidesktop");
const USERDATA = opt("--userdata") || join(APPDATA, "ai.opencode.desktop");
const ASAR = join(APP_DIR, "resources", "app.asar");
const BAK = join(APP_DIR, "resources", "app.asar.ocskin-bak");
const SKINS_DIR = join(USERDATA, "skins");

// ---------- pretty ----------
const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const ok = (s) => console.log(c(32, "✓ ") + s);
const info = (s) => console.log(c(36, "• ") + s);
const warnMsg = (s) => console.log(c(33, "! ") + s);
const die = (s) => { console.error(c(31, "✗ ") + s); process.exit(1); };

// ---------- asar format ----------
const BLOCK = 4194304;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const align4 = (n) => (n + 3) & ~3;

function parseAsar(buf) {
  if (buf.readUInt32LE(0) !== 4) throw new Error("not an asar (bad magic)");
  const headerPickleLen = buf.readUInt32LE(4);
  const strLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString("utf8", 16, 16 + strLen));
  const contentsBase = 8 + headerPickleLen;
  return { header, contentsBase };
}
function getEntry(header, path) {
  return path.split("/").reduce((n, seg) => (n && n.files && n.files[seg]) || null, header);
}
function entryBytes(buf, base, e) {
  const off = base + Number(e.offset);
  return buf.subarray(off, off + e.size);
}
function integrityOf(buf) {
  const blocks = [];
  if (buf.length === 0) blocks.push(sha256(Buffer.alloc(0)));
  else for (let i = 0; i < buf.length; i += BLOCK) blocks.push(sha256(buf.subarray(i, i + BLOCK)));
  return { algorithm: "SHA256", hash: sha256(buf), blockSize: BLOCK, blocks };
}
function collectPacked(node, out) {
  if (node.files) { for (const k of Object.keys(node.files)) collectPacked(node.files[k], out); return out; }
  if (node.unpacked) return out;
  if (typeof node.offset === "undefined") return out;
  out.push(node);
  return out;
}
function countUnpacked(node, acc = { n: 0 }) {
  if (node.files) { for (const k of Object.keys(node.files)) countUnpacked(node.files[k], acc); }
  else if (node.unpacked) acc.n++;
  return acc.n;
}
function buildHeaderRegion(header) {
  const jsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const payloadLen = align4(4 + jsonBuf.length);
  const payload = Buffer.alloc(payloadLen);
  payload.writeUInt32LE(jsonBuf.length, 0);
  jsonBuf.copy(payload, 4);
  const headerPickle = Buffer.alloc(4 + payloadLen);
  headerPickle.writeUInt32LE(payloadLen, 0);
  payload.copy(headerPickle, 4);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle]);
}

// transforms: { "path": (utf8string) => utf8string }
function rebuild(origBuf, transforms) {
  const { header, contentsBase } = parseAsar(origBuf);
  const patched = new Map();
  for (const path of Object.keys(transforms)) {
    const e = getEntry(header, path);
    if (!e) throw new Error(`entry not found in asar: ${path}`);
    const before = Buffer.from(entryBytes(origBuf, contentsBase, e)).toString("utf8");
    const after = transforms[path](before);
    patched.set(e, Buffer.from(after, "utf8"));
  }
  const packed = collectPacked(header, []).sort((a, b) => Number(a.offset) - Number(b.offset));
  const chunks = [];
  let running = 0;
  for (const e of packed) {
    const bytes = patched.has(e) ? patched.get(e) : Buffer.from(entryBytes(origBuf, contentsBase, e));
    e.offset = String(running);
    e.size = bytes.length;
    if (patched.has(e)) e.integrity = integrityOf(bytes);
    chunks.push(bytes);
    running += bytes.length;
  }
  return Buffer.concat([buildHeaderRegion(header), ...chunks]);
}

// ---------- patches ----------
const HTML_A = "<!--OCSKIN:START-->", HTML_B = "<!--OCSKIN:END-->";
const JS_A = "/*OCSKIN:START*/", JS_B = "/*OCSKIN:END*/";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HTML_ANCHOR = '<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>';
const MAIN_ANCHOR =
`    if (url.host !== rendererHost) {
      write("protocol", "rejected host", { url: request.url }, "warn");
      return new Response("Not found", { status: 404 });
    }`;

const stripHtml = (s) => s.replace(new RegExp("\\n?\\s*" + escapeRe(HTML_A) + "[\\s\\S]*?" + escapeRe(HTML_B), "g"), "");
const stripMain = (s) => s.replace(new RegExp("\\n?\\s*" + escapeRe(JS_A) + "[\\s\\S]*?" + escapeRe(JS_B), "g"), "");

function patchHtml(s) {
  s = stripHtml(s);
  if (!s.includes(HTML_ANCHOR)) throw new Error("index.html anchor not found — app layout changed");
  const inject = `\n    ${HTML_A}<script src="./__skins__/engine/engine.js" data-ocskin="1"></script>\n    <script src="./__skins__/engine/bg-button.js" data-ocskin="1"></script>${HTML_B}`;
  return s.replace(HTML_ANCHOR, HTML_ANCHOR + inject);
}
function patchMain(s) {
  s = stripMain(s);
  if (!s.includes(MAIN_ANCHOR)) throw new Error("out/main/index.js anchor not found — app version changed");
  const inject = `
${JS_A}
    if (url.pathname.startsWith("/__skins__/")) {
      try {
        const skinsRoot = join(app.getPath("userData"), "skins");
        const sub = decodeURIComponent(url.pathname.slice("/__skins__/".length));
        const skinFile = resolve(skinsRoot, sub);
        const skinRel = relative(skinsRoot, skinFile);
        if (skinRel.startsWith("..") || isAbsolute(skinRel)) return new Response("Not found", { status: 404 });
        const range = request.headers.get("range");
        return await net.fetch(pathToFileURL(skinFile).toString(), { headers: range ? { range } : void 0 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (url.pathname.startsWith("/__skins_upload__/") && request.method === "POST") {
      try {
        const skinsRoot = join(app.getPath("userData"), "skins");
        const sub = decodeURIComponent(url.pathname.slice("/__skins_upload__/".length));
        const skinFile = resolve(skinsRoot, sub);
        const skinRel = relative(skinsRoot, skinFile);
        if (skinRel.startsWith("..") || isAbsolute(skinRel)) return new Response("Not found", { status: 404 });
        const body = Buffer.from(await request.arrayBuffer());
        if (body.length === 0) return new Response("empty body", { status: 400 });
        if (body.length > 26214400) return new Response("too large", { status: 413 });
        mkdirSync(dirname(skinFile), { recursive: true });
        writeFileSync(skinFile, body);
        return new Response("ok", { status: 200 });
      } catch {
        return new Response("error", { status: 500 });
      }
    }
${JS_B}`;
  return s.replace(MAIN_ANCHOR, MAIN_ANCHOR + inject);
}

// ---------- verification ----------
function nodeCheck(mainSource) {
  const tmp = join(tmpdir(), `ocskin-check-${Date.now()}.mjs`);
  writeFileSync(tmp, mainSource);
  try { execSync(`node --check "${tmp}"`, { stdio: "pipe" }); }
  catch (e) { throw new Error("patched main/index.js failed syntax check:\n" + (e.stderr || e.stdout || e).toString()); }
  finally { try { rmSync(tmp); } catch {} }
}
function verify(newBuf, origBuf, { patched }) {
  const nn = parseAsar(newBuf), oo = parseAsar(origBuf);
  const np = collectPacked(nn.header, []).length, op = collectPacked(oo.header, []).length;
  if (np !== op) throw new Error(`packed file count changed ${op} -> ${np}`);
  const nu = countUnpacked(nn.header), ou = countUnpacked(oo.header);
  if (nu !== ou) throw new Error(`unpacked file count changed ${ou} -> ${nu}`);

  for (const path of ["out/renderer/index.html", "out/main/index.js"]) {
    const e = getEntry(nn.header, path);
    const b = entryBytes(newBuf, nn.contentsBase, e);
    if (sha256(b) !== e.integrity.hash) throw new Error(`integrity self-check failed: ${path}`);
    const hasMarker = b.toString("utf8").includes("OCSKIN");
    if (patched && !hasMarker) throw new Error(`marker missing after install: ${path}`);
    if (!patched && hasMarker) throw new Error(`marker still present after uninstall: ${path}`);
  }
  // spot-check unchanged files: new bytes must match original integrity hash
  for (const path of ["out/main/sidecar.js", "out/preload/index.js", "package.json"]) {
    const oe = getEntry(oo.header, path); if (!oe) continue;
    const ne = getEntry(nn.header, path);
    const nb = entryBytes(newBuf, nn.contentsBase, ne);
    if (sha256(nb) !== oe.integrity.hash) throw new Error(`unchanged file corrupted: ${path}`);
  }
}

// ---------- seeding ----------
function copyDir(src, dst, { overwrite = true } = {}) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const sp = join(src, name), dp = join(dst, name);
    if (statSync(sp).isDirectory()) copyDir(sp, dp, { overwrite });
    else { if (!overwrite && existsSync(dp)) continue; copyFileSync(sp, dp); }
  }
}
function seed() {
  if (!existsSync(BUNDLE)) die(`bundle folder missing: ${BUNDLE}`);
  mkdirSync(SKINS_DIR, { recursive: true });
  copyDir(join(BUNDLE, "engine"), join(SKINS_DIR, "engine"), { overwrite: true });
  copyDir(join(BUNDLE, "skins"), join(SKINS_DIR, "skins"), { overwrite: true });
  // pet code (blob + live2d driver); leaves runtime vendor/ + model/ (not in bundle) untouched
  if (existsSync(join(BUNDLE, "pet"))) copyDir(join(BUNDLE, "pet"), join(SKINS_DIR, "pet"), { overwrite: true });
  const activeDst = join(SKINS_DIR, "active.json");
  if (!existsSync(activeDst)) { copyFileSync(join(BUNDLE, "active.json"), activeDst); info("wrote active.json (default)"); }
  else info("kept existing active.json");
  ok(`seeded skins -> ${SKINS_DIR}`);
}

// ---------- guards ----------
function ensureNotRunning() {
  if (flag("--force")) return;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq OpenCode.exe" /NH', { encoding: "utf8" });
    if (/OpenCode\.exe/i.test(out)) die("OpenCode is running. Quit it fully (tray included), then re-run. Or pass --force.");
  } catch { /* tasklist unavailable (non-Windows) — skip */ }
}
function isPatched() {
  if (!existsSync(ASAR)) return false;
  const { header, contentsBase } = parseAsar(readFileSync(ASAR));
  const e = getEntry(header, "out/renderer/index.html");
  return e ? entryBytes(readFileSync(ASAR), contentsBase, e).toString("utf8").includes("OCSKIN") : false;
}

// ---------- commands ----------
function doInstall() {
  if (!existsSync(ASAR)) die(`app.asar not found: ${ASAR}\nPass --app <install dir>.`);
  ensureNotRunning();
  info(`app.asar : ${ASAR}`);
  info(`skins    : ${SKINS_DIR}`);
  const orig = readFileSync(ASAR);
  info(`read ${(orig.length / 1048576).toFixed(1)} MB, rebuilding…`);
  const transforms = { "out/renderer/index.html": patchHtml, "out/main/index.js": patchMain };
  // pre-flight: syntax-check the patched main before committing anything
  const { header, contentsBase } = parseAsar(orig);
  nodeCheck(patchMain(Buffer.from(entryBytes(orig, contentsBase, getEntry(header, "out/main/index.js"))).toString("utf8")));
  ok("patched main/index.js passes node --check");
  const next = rebuild(orig, transforms);
  verify(next, orig, { patched: true });
  ok("verification passed (integrity + unpacked intact)");
  copyFileSync(ASAR, BAK); info(`backup -> ${BAK}`);
  writeFileSync(ASAR, next);
  ok(`app.asar patched (${(next.length / 1048576).toFixed(1)} MB)`);
  seed();
  console.log("");
  ok("Done. Launch OpenCode. Hotkeys: Ctrl+Alt+S next · Shift = prev · Ctrl+Alt+R reload · Ctrl+Alt+0 off");
}
function doUninstall() {
  if (!existsSync(ASAR)) die(`app.asar not found: ${ASAR}`);
  ensureNotRunning();
  if (!isPatched()) { warnMsg("app.asar is not patched — nothing to remove."); }
  else {
    const orig = readFileSync(ASAR);
    const next = rebuild(orig, { "out/renderer/index.html": stripHtml, "out/main/index.js": stripMain });
    verify(next, orig, { patched: false });
    copyFileSync(ASAR, BAK);
    writeFileSync(ASAR, next);
    ok("asar patch removed");
  }
  if (flag("--purge")) {
    if (existsSync(SKINS_DIR)) { rmSync(SKINS_DIR, { recursive: true, force: true }); ok(`purged ${SKINS_DIR}`); }
  } else info(`skins folder kept: ${SKINS_DIR} (use --purge to delete)`);
}
function doStatus() {
  info(`app dir   : ${APP_DIR}`);
  info(`app.asar  : ${existsSync(ASAR) ? "found" : c(31, "MISSING")}`);
  info(`patched   : ${existsSync(ASAR) ? (isPatched() ? c(32, "yes") : c(33, "no")) : "-"}`);
  info(`backup    : ${existsSync(BAK) ? "present" : "none"}`);
  info(`skins dir : ${existsSync(SKINS_DIR) ? SKINS_DIR : c(33, "not seeded")}`);
  const active = join(SKINS_DIR, "active.json");
  if (existsSync(active)) { try { info(`active    : ${JSON.parse(readFileSync(active, "utf8")).active}`); } catch {} }
  const engine = join(SKINS_DIR, "engine", "engine.js");
  info(`engine    : ${existsSync(engine) ? "installed" : c(33, "missing")}`);
}

try {
  if (cmd === "install") doInstall();
  else if (cmd === "uninstall") doUninstall();
  else if (cmd === "status") doStatus();
  else if (cmd === "seed") seed();
  else die(`unknown command: ${cmd}`);
} catch (e) {
  die(e.message || String(e));
}
