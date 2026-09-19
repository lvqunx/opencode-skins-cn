#!/usr/bin/env node
/*
 * opencode-skins manager — a local web GUI to manage skins, the pet, and Live2D
 * models (upload your own, one-click import, live preview). Reads/writes the
 * skins folder directly; with hotReload on, OpenCode updates live.
 *
 *   node manager.mjs            # start + open the browser
 *   node manager.mjs --port 7788 --no-open --dir <skins dir>
 *
 * No external dependencies. Reuses install.mjs / fetch-live2d.mjs for patching
 * and model downloads.
 */
import { createServer } from "node:http";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  statSync, rmSync, createReadStream,
} from "node:fs";
import { join, dirname, resolve, extname, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);

const APPDATA = process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
const SKINS_DIR = resolve(opt("--dir", join(APPDATA, "ai.opencode.desktop", "skins")));
const APP_DIR = resolve(opt("--app", join(LOCALAPPDATA, "Programs", "@opencode-aidesktop")));
const PORT = parseInt(opt("--port", "7788"), 10);
const L2D_DIR = join(SKINS_DIR, "pet", "live2d");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".moc3": "application/octet-stream", ".exp3": "application/json", ".motion3": "application/json",
  ".wasm": "application/wasm",
};
const mimeOf = (p) => MIME[extname(p).toLowerCase()] || (/\.(exp3|motion3|physics3|cdi3|pose3)\.json$/i.test(p) ? "application/json" : "application/octet-stream");

// ---------- helpers ----------
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { "Content-Type": "application/json" });
const readJSON = (p, d = null) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };
const writeJSON = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); };
const safeName = (s) => String(s || "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "unnamed";
function within(root, p) { const f = resolve(root, "." + "/" + p.replace(/^[/\\]+/, "")); const r = relative(root, f); return (!r.startsWith("..") && !isAbsolute(r)) ? f : null; }
function body(req) { return new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); }); }
function run(script, args) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(HERE, script), ...args], { cwd: HERE });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => res({ code, out: out.replace(/\x1b\[[0-9;]*m/g, ""), err: err.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

// ---------- domain ----------
function listSkins() {
  const dir = join(SKINS_DIR, "skins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n[0] !== "_" && statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, "skin.json")))
    .map((n) => ({ name: n, manifest: readJSON(join(dir, n, "skin.json"), {}) }));
}
function listModels() {
  const dir = join(L2D_DIR, "model");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).map((n) => {
    const files = walk(join(dir, n));
    const m3 = files.find((f) => /\.model3\.json$/i.test(f));
    return { name: n, model3: m3 ? "pet/live2d/model/" + n + "/" + relative(join(dir, n), m3).replace(/\\/g, "/") : null, files: files.length };
  });
}
function walk(d, acc = []) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, acc) : acc.push(p); } return acc; }
function isPatched() {
  const asar = join(APP_DIR, "resources", "app.asar");
  if (!existsSync(asar)) return { asar: false, patched: false };
  try {
    const b = readFileSync(asar); const sl = b.readUInt32LE(12);
    const h = JSON.parse(b.toString("utf8", 16, 16 + sl)); const cb = 8 + b.readUInt32LE(4);
    const e = "out/renderer/index.html".split("/").reduce((n, s) => n && n.files && n.files[s], h);
    const html = b.subarray(cb + +e.offset, cb + +e.offset + e.size).toString("utf8");
    return { asar: true, patched: html.includes("OCSKIN") };
  } catch { return { asar: true, patched: false }; }
}
const CURATED = [
  { name: "hiyori", label: "Hiyori", url: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples/Samples/Resources/Hiyori/Hiyori.model3.json" },
  { name: "mao", label: "Mao", url: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples/Samples/Resources/Mao/Mao.model3.json" },
  { name: "mark", label: "Mark", url: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples/Samples/Resources/Mark/Mark.model3.json" },
  { name: "natori", label: "Natori", url: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples/Samples/Resources/Natori/Natori.model3.json" },
  { name: "rice", label: "Rice", url: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples/Samples/Resources/Rice/Rice.model3.json" },
  { name: "haru", label: "Haru", url: "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json" },
];

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, "");
  const method = req.method;

  if (p === "/state" && method === "GET") {
    return json(res, 200, {
      skinsDir: SKINS_DIR, appDir: APP_DIR,
      status: isPatched(),
      active: readJSON(join(SKINS_DIR, "active.json"), { active: null }),
      skins: listSkins(),
      models: listModels(),
      curated: CURATED,
      hasVendor: existsSync(join(L2D_DIR, "vendor", "cubism4.min.js")),
    });
  }
  if (p === "/active" && method === "PUT") {
    const patch = JSON.parse((await body(req)).toString() || "{}");
    const cur = readJSON(join(SKINS_DIR, "active.json"), {});
    writeJSON(join(SKINS_DIR, "active.json"), { ...cur, ...patch });
    return json(res, 200, { ok: true });
  }
  let m;
  if ((m = p.match(/^\/skins\/([^/]+)$/))) {
    const name = safeName(decodeURIComponent(m[1]));
    const file = join(SKINS_DIR, "skins", name, "skin.json");
    if (method === "GET") return json(res, 200, readJSON(file, {}));
    if (method === "PUT") { writeJSON(file, JSON.parse((await body(req)).toString() || "{}")); return json(res, 200, { ok: true }); }
    if (method === "DELETE") { rmSync(join(SKINS_DIR, "skins", name), { recursive: true, force: true }); return json(res, 200, { ok: true }); }
  }
  if (p === "/skins" && method === "POST") {
    const { name, manifest } = JSON.parse((await body(req)).toString() || "{}");
    const sn = safeName(name);
    writeJSON(join(SKINS_DIR, "skins", sn, "skin.json"), manifest || { name: sn, base: "dark", background: { type: "none" } });
    return json(res, 200, { ok: true, name: sn });
  }
  if (p === "/models" && method === "GET") return json(res, 200, listModels());
  if ((m = p.match(/^\/models\/([^/]+)$/)) && method === "DELETE") {
    rmSync(join(L2D_DIR, "model", safeName(decodeURIComponent(m[1]))), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/models\/([^/]+)\/file$/)) && method === "POST") {
    const name = safeName(decodeURIComponent(m[1]));
    const rel = req.headers["x-rel-path"];
    if (!rel) return json(res, 400, { error: "missing x-rel-path" });
    const dst = within(join(L2D_DIR, "model", name), String(rel));
    if (!dst) return json(res, 400, { error: "bad path" });
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, await body(req));
    return json(res, 200, { ok: true });
  }
  if (p === "/models/import" && method === "POST") {
    const { url: murl, name } = JSON.parse((await body(req)).toString() || "{}");
    if (!murl) return json(res, 400, { error: "missing url" });
    const r = await run("fetch-live2d.mjs", ["--dir", L2D_DIR, "--model", murl, "--name", safeName(name || "custom")]);
    return json(res, r.code === 0 ? 200 : 500, { ok: r.code === 0, log: r.out + r.err });
  }
  if (p === "/live2d/setup" && method === "POST") {
    const r = await run("fetch-live2d.mjs", ["--dir", L2D_DIR, "--no-model"]);
    return json(res, r.code === 0 ? 200 : 500, { ok: r.code === 0, log: r.out + r.err });
  }
  if (p === "/install" && method === "POST") {
    const { cmd } = JSON.parse((await body(req)).toString() || "{}");
    const r = await run("install.mjs", [cmd === "uninstall" ? "uninstall" : "install", "--app", APP_DIR, "--userdata", dirname(SKINS_DIR)]);
    return json(res, 200, { ok: r.code === 0, log: r.out + r.err });
  }
  if (p === "/open" && method === "POST") {
    const { target } = JSON.parse((await body(req)).toString() || "{}");
    const t = target === "skins" ? SKINS_DIR : target === "models" ? join(L2D_DIR, "model") : SKINS_DIR;
    spawn("explorer.exe", [t]);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "no route " + method + " " + p });
}

// ---------- OpenAI-compatible gateway: reverse-proxy opencode zen FREE models ----------
const ZEN = "https://opencode.ai/zen/v1";
let _mc = { at: 0, data: null };
async function freeModels() {
  if (_mc.data && Date.now() - _mc.at < 60000) return _mc.data;
  const r = await fetch(ZEN + "/models");
  const j = await r.json();
  const data = (j.data || []).filter((m) => /-free$/i.test(m.id));
  _mc = { at: Date.now(), data };
  return data;
}
function gwKey() { const a = readJSON(join(SKINS_DIR, "active.json"), {}); return (a.gateway && a.gateway.key) || ""; }
async function gateway(req, res, url) {
  const sub = url.pathname.replace(/^\/gw\/v1/, "") || "/";
  if (req.method === "OPTIONS") return send(res, 204, "", { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "*" });
  const key = gwKey();
  if (key) {
    const provided = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") || req.headers["x-api-key"] || "";
    if (provided !== key) return json(res, 401, { error: { message: "invalid api key", type: "invalid_request_error" } });
  }
  try {
    if (sub === "/models" && req.method === "GET") return json(res, 200, { object: "list", data: await freeModels() });
    if ((sub === "/chat/completions" || sub === "/completions") && req.method === "POST") {
      const raw = await body(req);
      let payload = {}; try { payload = JSON.parse(raw.toString() || "{}"); } catch { return json(res, 400, { error: { message: "invalid JSON body" } }); }
      const free = await freeModels();
      if (payload.model && !free.some((m) => m.id === payload.model))
        return json(res, 403, { error: { message: `'${payload.model}' is not a free model. Allowed: ${free.map((m) => m.id).join(", ")}`, type: "invalid_request_error" } });
      const up = await fetch(ZEN + sub, { method: "POST", headers: { "Content-Type": "application/json", "HTTP-Referer": "https://opencode.ai/", "User-Agent": "opencode-skins-gateway" }, body: raw });
      res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") || "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      if (up.body) { const rd = up.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(Buffer.from(value)); } }
      return res.end();
    }
    return json(res, 404, { error: { message: "gateway: no route " + req.method + " " + sub } });
  } catch (e) { return json(res, 502, { error: { message: "upstream error: " + (e && e.message || e) } }); }
}

// ---------- static ----------
function serveStatic(res, absPath) {
  if (!existsSync(absPath) || statSync(absPath).isDirectory()) return send(res, 404, "not found");
  res.writeHead(200, { "Content-Type": mimeOf(absPath), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  createReadStream(absPath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/gw/")) return await gateway(req, res, url);
    if (url.pathname === "/" ) return serveStatic(res, join(HERE, "manager", "app.html"));
    if (url.pathname === "/viewer") return serveStatic(res, join(HERE, "manager", "viewer.html"));
    if (url.pathname.startsWith("/manager/")) { const f = within(join(HERE, "manager"), url.pathname.replace(/^\/manager\//, "")); return f ? serveStatic(res, f) : send(res, 404, "nf"); }
    if (url.pathname.startsWith("/skins/")) { const f = within(SKINS_DIR, url.pathname.replace(/^\/skins\//, "")); return f ? serveStatic(res, f) : send(res, 404, "nf"); }
    return send(res, 404, "not found");
  } catch (e) { json(res, 500, { error: String(e && e.message || e) }); }
});

server.listen(PORT, "127.0.0.1", () => {
  const uri = `http://127.0.0.1:${PORT}/`;
  console.log("\x1b[32m✓\x1b[0m opencode-skins manager  →  " + uri);
  console.log("  skins: " + SKINS_DIR);
  if (!flag("--no-open")) spawn("cmd", ["/c", "start", "", uri], { detached: true, stdio: "ignore" }).unref();
});
