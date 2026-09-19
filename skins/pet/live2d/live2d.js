/*
 * opencode-skins :: Live2D renderer for the code pet
 * Loaded by pet.js when active.json has  "pet": { "model": ... }.
 *
 * Features:
 *   - renders Cubism (3/4/5) models via pixi-live2d-display; cursor tracking
 *   - mood -> expression / motion / standard Cubism params (tuned for Haru,
 *     generic-safe for other models)
 *   - multiple models + hot switch (Ctrl+Alt+P, ocpet.nextModel/setModel);
 *     per-skin character (a skin's skin.json "pet.model" swaps the model)
 *   - click hit-areas (Head / Body -> different reactions)
 *   - lip-sync interface reserved: ocpet.lipSync(0..1) / cfg.lipSync placeholder
 *
 * Runtime libs load from pet/live2d/vendor (CDN fallback). Any failure keeps
 * pet.js's procedural blob.
 */
(function () {
  "use strict";
  var pet = window.ocpet;
  if (!pet || window.__oclive2d) return;
  var API = window.ocskin;
  var cfg = (API && API.config && API.config.pet) || {};
  if (cfg === true) cfg = {};

  var log = function () { try { console.log.apply(console, ["%c[ocpet:live2d]", "color:#57d977"].concat([].slice.call(arguments))); } catch (e) {} };
  var SKINROOT = new URL("__skins__", document.baseURI).href.replace(/\/+$/, "");
  var PETBASE = SKINROOT + "/pet";
  function resolveUrl(p) { return /^(https?:|blob:|data:)/.test(p) ? p : PETBASE + "/" + String(p).replace(/^\/+/, ""); }

  // ---- model list ---------------------------------------------------------
  function entryOf(v, i, id) {
    if (typeof v === "string") return { id: id || ("m" + i), url: resolveUrl(v), name: cfg.name };
    return { id: id || v.id || ("m" + i), url: resolveUrl(v.model), name: v.name || cfg.name, width: v.width, height: v.height, fit: v.fit };
  }
  var entries = [];
  if (cfg.model) entries.push(entryOf(cfg.model, 0, "default"));
  if (Array.isArray(cfg.models)) cfg.models.forEach(function (v, i) { entries.push(entryOf(v, i)); });
  else if (cfg.models && typeof cfg.models === "object") Object.keys(cfg.models).forEach(function (k, i) { entries.push(entryOf(cfg.models[k], i, k)); });
  if (!entries.length) return;
  window.__oclive2d = true;

  // ---- vendor libs --------------------------------------------------------
  var VLOCAL = PETBASE + "/live2d/vendor";
  var VCDN = {
    core: "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
    pixi: "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
    disp: "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js"
  };
  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = url; s.async = false;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error("failed " + url)); };
      document.head.appendChild(s);
    });
  }
  function loadFallback(local, cdn) { return loadScript(local).catch(function () { log("local miss -> CDN"); return loadScript(cdn); }); }
  async function loadLibs() {
    if (!window.Live2DCubismCore) await loadFallback(VLOCAL + "/live2dcubismcore.min.js", VCDN.core);
    if (!window.PIXI) await loadFallback(VLOCAL + "/pixi.min.js", VCDN.pixi);
    if (!(window.PIXI && PIXI.live2d)) await loadFallback(VLOCAL + "/cubism4.min.js", VCDN.disp);
  }

  // ---- mood -> expression / motion (tuned for Haru; generic fallbacks) -----
  // Haru: f00 neutral · f01 laugh(open) · f02 angry · f03 troubled · f04 smile-eyes
  //       f05 surprised(wide) · f06 worried · f07 pouty/sad
  var EXPR = {
    happy: ["f04", "f01", "smile", "happy", "exp_01"],
    error: ["f05", "f03", "surprised", "sad", "exp_05"],
    thinking: ["f00", "exp_00"],
    working: ["f00", "exp_00"],
    sleeping: ["f00"],
    idle: ["f00"]
  };
  var pick = function (a) { return a[(Math.random() * a.length) | 0]; };

  var app = null, view = null, model = null, loading = false, currentId = null;
  var shakeUntil = 0, lastMood = "", lipVal = null;

  function expr(list) { if (!model || !list) return; for (var i = 0; i < list.length; i++) { try { model.expression(list[i]); return; } catch (e) {} } }
  function motion(group) { if (!model) return; try { model.motion(group); } catch (e) {} }
  function setP(id, v) { try { model.internalModel.coreModel.setParameterValueById(id, v); } catch (e) {} }
  function addP(id, v) { try { var cm = model.internalModel.coreModel; cm.setParameterValueById(id, cm.getParameterValueById(id) + v); } catch (e) {} }

  function onMoodChange(m) {
    expr(EXPR[m]);
    if (m === "happy") motion("Tap");
    else if (m === "error") shakeUntil = performance.now() + 750;
  }
  function applyParams(m) {
    var now = performance.now();
    if (m === "sleeping") { setP("ParamEyeLOpen", 0); setP("ParamEyeROpen", 0); setP("ParamMouthOpenY", 0); addP("ParamAngleZ", -6); }
    else if (m === "thinking") { setP("ParamEyeBallY", 0.7); addP("ParamAngleY", 8); }
    if (now < shakeUntil) setP("ParamAngleZ", Math.sin(now / 26) * 18);
    // lip-sync (reserved interface): external value wins; else a gentle placeholder flap while talking
    if (cfg.lipSync && m !== "sleeping") {
      if (lipVal != null) setP("ParamMouthOpenY", lipVal);
      else if (m === "thinking" || m === "working") setP("ParamMouthOpenY", (Math.sin(now / 90) * 0.5 + 0.5) * 0.55);
    }
  }
  function tick() {
    if (!model || document.hidden) return;
    var m = pet.mood ? pet.mood() : "idle";
    if (m !== lastMood) { onMoodChange(m); lastMood = m; }
    applyParams(m);
  }

  function onMove(e) { if (!model || !app) return; var r = view.getBoundingClientRect(); try { model.focus(e.clientX - r.left, e.clientY - r.top); } catch (er) {} }

  // ---- click hit-areas ----------------------------------------------------
  function onTap(e) {
    var areas = [];
    try { if (e) { var r = view.getBoundingClientRect(); areas = (model.hitTest(e.clientX - r.left, e.clientY - r.top) || []).map(function (s) { return String(s).toLowerCase(); }); } } catch (er) {}
    var a = areas.join(",");
    if (/head/.test(a)) { expr(EXPR.happy); motion("Tap"); pet.say(pick(["嗯~", "摸头好舒服", "(*/ω＼*)", "再摸一下嘛"])); }
    else if (/body/.test(a)) { motion("Tap"); pet.say(pick(["痒痒的!", "别闹啦~", "喂喂喂"])); }
    else { motion("Tap"); expr(EXPR.happy); pet.say(pick(["嘿嘿~", "干嘛戳我", "在呢在呢"])); }
  }

  // ---- mount / switch models ---------------------------------------------
  function fit(entry) {
    var LW = entry.width || cfg.width || 220, LH = entry.height || cfg.height || 300;
    pet.host.style.width = LW + "px"; pet.host.style.height = LH + "px";
    if (app) app.renderer.resize(LW, LH);
    if (model) { var s = Math.min(LW / model.width, LH / model.height) * (entry.fit || cfg.fit || 0.95); model.scale.set(s); model.anchor.set(0.5, 0.5); model.position.set(LW / 2, LH / 2); }
  }
  function mount(m, entry) {
    if (model) { try { app.stage.removeChild(model); model.destroy({ children: true, texture: true, baseTexture: true }); } catch (e) {} }
    model = m; app.stage.addChild(model); fit(entry);
    lastMood = ""; currentId = entry.id;
    pet.say((entry.name || "Live2D") + " 来啦~");
  }
  function resolveTarget(t) {
    if (typeof t === "number") return entries[((t % entries.length) + entries.length) % entries.length];
    if (t && typeof t === "object") return entryOf(t, 0);
    if (typeof t === "string") { var f = entries.filter(function (e) { return e.id === t; })[0]; return f || { id: t, url: resolveUrl(t), name: cfg.name }; }
    return entries[0];
  }
  async function setModel(target) {
    if (loading) return; var entry = resolveTarget(target); if (!entry || entry.id === currentId) return;
    loading = true;
    try { var m = await PIXI.live2d.Live2DModel.from(entry.url, { autoInteract: false }); mount(m, entry); log("switched ->", entry.id); }
    catch (e) { log("switch failed:", e && e.message); }
    finally { loading = false; }
  }
  var idx = 0;
  function nextModel() { if (entries.length < 2) return; idx = (idx + 1) % entries.length; setModel(idx); }

  // ---- boot ---------------------------------------------------------------
  async function boot() {
    try { await loadLibs(); } catch (e) { throw new Error("[libs] " + (e && e.message)); }
    var miss = [];
    if (!window.Live2DCubismCore) miss.push("Live2DCubismCore");
    if (!window.PIXI) miss.push("PIXI");
    if (window.PIXI && !(PIXI.live2d && PIXI.live2d.Live2DModel)) miss.push("PIXI.live2d");
    if (miss.length) throw new Error("[runtime] missing " + miss.join(", "));
    var e0 = entries[0];
    var first;
    try { first = await PIXI.live2d.Live2DModel.from(e0.url, { autoInteract: false }); }
    catch (e) { throw new Error("[model] " + e0.url + "  ->  " + (e && (e.message || e))); }
    var LW = e0.width || cfg.width || 220, LH = e0.height || cfg.height || 300;
    pet.host.style.width = LW + "px"; pet.host.style.height = LH + "px";
    view = document.createElement("canvas");
    view.style.cssText = "width:100%;height:100%;display:block;pointer-events:auto;cursor:grab;filter:drop-shadow(0 8px 14px rgba(0,0,0,.4));";
    pet.host.appendChild(view);
    app = new PIXI.Application({ view: view, width: LW, height: LH, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
    app.stage.addChild(first); model = first; fit(e0); currentId = e0.id;

    pet.suppressBlob();
    pet.wireInput(view);
    pet.onTap = onTap;
    window.addEventListener("pointermove", onMove, { passive: true });
    app.ticker.add(tick, null, (PIXI.UPDATE_PRIORITY && PIXI.UPDATE_PRIORITY.LOW) || 0);
    document.addEventListener("visibilitychange", function () { document.hidden ? app.ticker.stop() : app.ticker.start(); });

    // Multi-model extras — mounted ONLY when >1 model is configured, so a
    // single-model setup can never rapid-switch (which briefly hides the pet)
    // or auto-swap on skin changes.
    if (entries.length > 1) {
      window.addEventListener("keydown", function (e) {
        if (e.repeat) return;                        // ignore held-key repeat storms
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); nextModel(); }
      }, true);
      // per-skin character: a skin's manifest.pet.model swaps the character
      if (API && API.on) API.on("applied", function (cur) {
        try {
          var pm = cur && cur.manifest && cur.manifest.pet && cur.manifest.pet.model;
          if (pm) setModel({ model: pm, name: (cur.manifest.pet.name) || cur.name });
          else if (currentId !== e0.id) setModel(0);
        } catch (er) {}
      });
    }

    // public + reserved interfaces
    pet.setModel = setModel;
    pet.nextModel = nextModel;
    pet.lipSync = function (v) { lipVal = (v == null ? null : Math.max(0, Math.min(1, +v))); };  // reserved: feed audio amplitude here
    window.__oclive2dApi = { app: app, get model() { return model; }, motion: motion, expr: expr, setModel: setModel, setMouth: pet.lipSync };
    pet.say((e0.name || "Live2D") + " 来啦~");
    log("ready:", e0.url, "models:", entries.length);
  }

  boot().catch(function (e) {
    window.__oclive2d = false;
    window.__oclive2dError = e;
    var msg = (e && (e.message || e.toString())) || "unknown";
    try { console.error("[ocpet:live2d] FAILED — keeping blob:\n", e && (e.stack || msg)); } catch (_) {}
    try { if (window.ocskin && ocskin.toast) ocskin.toast("Live2D 失败: " + msg); } catch (_) {}
    try { pet.say("Live2D 失败(已回退):\n" + msg, 9000); } catch (_) {}
  });
})();
