/*
 * opencode-skins engine
 * Runtime skin layer for OpenCode Desktop (SolidJS renderer, sandboxed).
 * Loaded as a classic <script> from oc://renderer/__skins__/engine/engine.js
 * (the main process serves everything under /__skins__/ from <userData>/skins).
 *
 * Capabilities:
 *   - override the app's design tokens (CSS custom properties) -> reskins every component
 *   - inject custom CSS (inline or per-skin file)
 *   - dynamic backgrounds: video / image / canvas shaders / gradient
 *   - declarative DOM "component patches" that survive SolidJS re-renders (MutationObserver)
 *   - per-skin JS module with a stable `ocskin` API
 *   - live hot-reload of skin files, hotkeys, on-screen HUD
 *
 * No external dependencies. Pure DOM. Never throws into the host app.
 */
(function () {
  "use strict";
  if (window.__ocskin) return;

  // Resolve against the document URL exactly like the app loads its own assets
  // (robust regardless of how the custom scheme serializes location.origin).
  var ROOT = new URL("__skins__", document.baseURI).href.replace(/\/+$/, "");
  var LS_ACTIVE = "ocskin:active";
  var NONE = "__none__";

  var log = function () {
    var a = ["%c[ocskin]", "color:#7c5cff;font-weight:bold"];
    return console.log.apply(console, a.concat([].slice.call(arguments)));
  };
  var warn = function () {
    var a = ["[ocskin]"];
    return console.warn.apply(console, a.concat([].slice.call(arguments)));
  };

  // ---- tiny event emitter -------------------------------------------------
  var listeners = {};
  function on(evt, cb) {
    (listeners[evt] = listeners[evt] || []).push(cb);
    return function () { off(evt, cb); };
  }
  function off(evt, cb) {
    var l = listeners[evt]; if (!l) return;
    var i = l.indexOf(cb); if (i >= 0) l.splice(i, 1);
  }
  function emit(evt, data) {
    (listeners[evt] || []).slice().forEach(function (cb) {
      try { cb(data); } catch (e) { warn("listener error", evt, e); }
    });
  }

  // ---- fetch helpers ------------------------------------------------------
  function bust(url) { return url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(); }
  function fetchText(url) {
    return fetch(bust(url), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.text();
    });
  }
  function fetchJSON(url) { return fetchText(url).then(function (t) { return JSON.parse(t); }); }
  function skinURL(name, rel) { return ROOT + "/skins/" + name + "/" + rel; }

  // ---- config / skin discovery -------------------------------------------
  var config = { active: "aurora", hotkeys: true, hotReload: false, skins: [] };
  function loadConfig() {
    return fetchJSON(ROOT + "/active.json").then(function (c) {
      config = Object.assign(config, c || {});
      return config;
    }).catch(function () { return config; });
  }
  // Merge the explicit skins list with an optional skins/index.json.
  function listSkins() {
    return fetchJSON(ROOT + "/skins/index.json").then(function (idx) {
      return Array.isArray(idx) ? idx : (idx && idx.skins) || [];
    }).catch(function () { return []; }).then(function (fromIndex) {
      var set = [];
      (config.skins || []).concat(fromIndex).forEach(function (n) {
        if (n && set.indexOf(n) < 0) set.push(n);
      });
      return set;
    });
  }

  // ---- DOM ready helper ---------------------------------------------------
  function whenBody(cb) {
    if (document.body) return cb();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { cb(); }, { once: true });
    } else {
      // body not parsed yet but not "loading" — observe
      var mo = new MutationObserver(function () {
        if (document.body) { mo.disconnect(); cb(); }
      });
      mo.observe(document.documentElement, { childList: true });
    }
  }

  // ---- current skin state (everything the teardown must undo) ------------
  var state = null;
  function newState(name) {
    return {
      name: name,
      styles: [],       // injected <style>/<link> nodes
      nodes: [],        // injected DOM nodes (backgrounds, hud is separate)
      observers: [],    // MutationObservers
      rafs: [],         // requestAnimationFrame ids
      timers: [],       // interval/timeout ids
      cleanups: [],     // functions from skin JS / builders
      objectURLs: []    // blob URLs to revoke
    };
  }
  function track(s, kind, val) { s[kind].push(val); return val; }

  function teardown() {
    if (!state) return;
    var s = state; state = null;
    s.rafs.forEach(function (id) { cancelAnimationFrame(id); });
    s.timers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    s.observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
    s.cleanups.forEach(function (fn) { try { fn(); } catch (e) { warn("cleanup error", e); } });
    s.nodes.forEach(function (n) { try { n.remove(); } catch (e) {} });
    s.styles.forEach(function (n) { try { n.remove(); } catch (e) {} });
    s.objectURLs.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  }

  function addStyle(s, id, css) {
    var el = document.createElement("style");
    el.id = id; el.textContent = css;
    document.head.appendChild(el);
    return track(s, "styles", el);
  }

  // ---- color scheme -------------------------------------------------------
  var originalColorScheme = null;
  function applyColorScheme(scheme) {
    var root = document.documentElement;
    if (originalColorScheme === null) originalColorScheme = root.dataset.colorScheme || "";
    if (scheme === "dark" || scheme === "light") {
      root.dataset.colorScheme = scheme;
      root.style.colorScheme = scheme;
    }
  }
  function restoreColorScheme() {
    if (originalColorScheme === null) return;
    var root = document.documentElement;
    if (originalColorScheme) root.dataset.colorScheme = originalColorScheme;
    root.style.colorScheme = "";
  }

  // ---- variable overrides -------------------------------------------------
  // Mirror the two token generations so overriding either public or private wins.
  function mirrorVars(vars) {
    var out = {};
    Object.keys(vars || {}).forEach(function (k) {
      var v = vars[k];
      out[k] = v;
      if (k.indexOf("--color-v2-") === 0) out[k.replace("--color-v2-", "--v2-")] = v;
      else if (k.indexOf("--v2-") === 0) out["--color-v2-" + k.slice(5)] = v;
    });
    return out;
  }
  function applyVars(s, vars) {
    var merged = mirrorVars(vars);
    var css = "html{";
    Object.keys(merged).forEach(function (k) { css += k + ":" + merged[k] + " !important;"; });
    css += "}";
    addStyle(s, "ocskin-vars", css);
  }

  // ---- surface translucency (reveal the background layer) -----------------
  var TRANSLUCENT_TOKENS = [
    "--color-v2-background-bg-base", "--color-v2-background-bg-deep",
    "--color-v2-background-bg-contrast",
    "--color-v2-background-bg-layer-01", "--color-v2-background-bg-layer-02",
    "--color-v2-background-bg-layer-03", "--color-v2-background-bg-layer-04",
    "--background-base", "--background-weak", "--background-strong", "--background-stronger",
    "--color-surface-base", "--color-surface-raised-base", "--color-surface-inset-base"
  ];
  // Make the shell transparent so the fixed background shows, and lift #root
  // above the background layer. Always needed when there is a background.
  function revealShell(s) {
    var css = "html,body{background:transparent !important;}"
      + "#root{position:relative;z-index:1;background:transparent !important;}"
      + "#ocskin-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}";
    addStyle(s, "ocskin-shell", css);
  }

  // Opaque-tint mode: translucify the app's surface tokens with color-mix.
  function translucifyTokens(s, alpha) {
    var cs = getComputedStyle(document.documentElement);
    var pct = Math.max(0, Math.min(100, Math.round(alpha * 100)));
    var css = "html{";
    TRANSLUCENT_TOKENS.forEach(function (t) {
      var priv = t.indexOf("--color-v2-") === 0 ? t.replace("--color-v2-", "--v2-") : t;
      var val = (cs.getPropertyValue(priv) || cs.getPropertyValue(t) || "").trim();
      if (!val) return;
      var mixed = "color-mix(in srgb, " + val + " " + pct + "%, transparent)";
      css += t + ":" + mixed + " !important;";
      if (priv !== t) css += priv + ":" + mixed + " !important;";
    });
    css += "}";
    addStyle(s, "ocskin-surfaces", css);
  }

  // Frosted-glass mode: keep panels ~transparent and blur what's behind them.
  // Panels are found by matching their computed background-color against the
  // app's resolved surface-token colors, so it works despite hashed classes.
  function resolveVarColor(name) {
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;display:none;color:var(" + name + ")";
    document.body.appendChild(probe);
    var rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }
  function stripAlpha(rgb) {
    var m = /rgba?\(([^)]+)\)/.exec(rgb);
    if (!m) return rgb;
    var p = m[1].split(",");
    return "rgb(" + p[0].trim() + ", " + p[1].trim() + ", " + p[2].trim() + ")";
  }
  function buildGlass(s, opts) {
    var blur = opts.blur != null ? opts.blur : 18;
    var sat = opts.saturate != null ? opts.saturate : 1.2;
    var tint = opts.tint != null ? opts.tint : 0.06;
    var filter = "blur(" + blur + "px) saturate(" + sat + ")";
    // The top dock/titlebar uses an opaque "non-alpha" surface plus a
    // border-underlay box-shadow that colour-matching can't reach. Clear them
    // explicitly via stable data-attributes so the titlebar joins the glass.
    addStyle(s, "ocskin-glass-dock",
      '[data-dock-surface="shell"]{background-color:transparent!important;box-shadow:none!important;'
      + "backdrop-filter:" + filter + "!important;-webkit-backdrop-filter:" + filter + "!important;}"
      + '[data-dock-surface="tray"],[data-component="tabs"]{background-color:transparent!important;box-shadow:none!important;border-color:transparent!important;}'
      + '[data-dock-border-underlay]{box-shadow:none!important;}'
      + '[data-component="tabs"] [data-slot="tabs-list"]:after{background-color:transparent!important;border-bottom-color:transparent!important;}'
    );
    // capture the app's surface colors (resolved rgb, alpha stripped)
    var surfaces = new Set();
    TRANSLUCENT_TOKENS.forEach(function (t) {
      var priv = t.indexOf("--color-v2-") === 0 ? t.replace("--color-v2-", "--v2-") : t;
      [t, priv].forEach(function (n) {
        var rgb = resolveVarColor(n);
        if (rgb && rgb !== "rgba(0, 0, 0, 0)" && rgb !== "transparent") surfaces.add(stripAlpha(rgb));
      });
    });
    function frostEl(el) {
      if (el.nodeType !== 1 || el.dataset.ocGlass) return;
      if (el.id && el.id.indexOf("ocskin") === 0) return;
      for (var p = el.parentElement; p; p = p.parentElement) { if (p.dataset && p.dataset.ocGlass) return; }
      var bg = getComputedStyle(el).backgroundColor;
      if (!bg) return;
      var key = stripAlpha(bg);
      if (!surfaces.has(key)) return;
      var base = key.slice(4, -1); // "r, g, b"
      el.dataset.ocGlass = "1";
      el.style.setProperty("background-color", "rgba(" + base + ", " + tint + ")", "important");
      el.style.setProperty("backdrop-filter", filter, "important");
      el.style.setProperty("-webkit-backdrop-filter", filter, "important");
    }
    function scan(root) {
      if (root.nodeType !== 1) return;
      frostEl(root);
      var all = root.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) frostEl(all[i]);
    }
    scan(document.body);
    var queue = [], pending = false;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++)
        for (var j = 0; j < muts[i].addedNodes.length; j++)
          if (muts[i].addedNodes[j].nodeType === 1) queue.push(muts[i].addedNodes[j]);
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; var q = queue; queue = []; q.forEach(scan); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    track(s, "observers", mo);
    // single teardown pass restores every frosted element
    track(s, "cleanups", function () {
      var frosted = document.querySelectorAll('[data-oc-glass="1"]');
      for (var i = 0; i < frosted.length; i++) {
        var el = frosted[i];
        el.removeAttribute("data-oc-glass");
        el.style.removeProperty("background-color");
        el.style.removeProperty("backdrop-filter");
        el.style.removeProperty("-webkit-backdrop-filter");
      }
    });
  }

  // ---- backgrounds --------------------------------------------------------
  function bgContainer(s, bg) {
    var el = document.createElement("div");
    el.id = "ocskin-bg";
    var f = [];
    if (bg.blur) f.push("blur(" + bg.blur + "px)");
    if (bg.brightness != null) f.push("brightness(" + bg.brightness + ")");
    if (bg.saturate != null) f.push("saturate(" + bg.saturate + ")");
    if (f.length) el.style.filter = f.join(" ");
    if (bg.opacity != null) el.style.opacity = String(bg.opacity);
    if (bg.blend) el.style.mixBlendMode = bg.blend;
    document.body.insertBefore(el, document.body.firstChild);
    return track(s, "nodes", el);
  }

  function buildVideo(s, name, bg, host) {
    var v = document.createElement("video");
    v.autoplay = true; v.loop = bg.loop !== false; v.muted = true; v.defaultMuted = true;
    v.playsInline = true; v.setAttribute("playsinline", "");
    v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:" + (bg.fit || "cover") + ";";
    if (bg.playbackRate) v.playbackRate = bg.playbackRate;
    host.appendChild(v);
    var url = /^(https?:|blob:|data:)/.test(bg.src) ? bg.src : skinURL(name, bg.src);
    // Load through a blob so playback never depends on the file:// mime type,
    // and so a missing clip degrades to the declared fallback.
    fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (blob) {
      var type = blob.type || guessVideoType(bg.src);
      var typed = type ? new Blob([blob], { type: type }) : blob;
      var obj = URL.createObjectURL(typed);
      track(s, "objectURLs", obj);
      v.src = obj;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    }).catch(function (e) {
      warn("video failed (" + url + "):", e.message, "-> fallback");
      try { v.remove(); } catch (er) {}
      buildFallback(s, name, bg, host);
    });
    return v;
  }
  function guessVideoType(src) {
    if (/\.webm$/i.test(src)) return "video/webm";
    if (/\.ogg$|\.ogv$/i.test(src)) return "video/ogg";
    if (/\.mov$/i.test(src)) return "video/quicktime";
    return "video/mp4";
  }

  function buildImage(s, name, bg, host) {
    var d = document.createElement("div");
    var url = /^(https?:|data:)/.test(bg.src) ? bg.src : skinURL(name, bg.src);
    d.style.cssText = "position:absolute;inset:0;background-size:" + (bg.fit || "cover") +
      ";background-position:center;background-repeat:no-repeat;background-image:url('" + url + "');";
    host.appendChild(d);
    return d;
  }

  function buildGradient(s, bg, host) {
    var d = document.createElement("div");
    d.style.cssText = "position:absolute;inset:0;";
    if (bg.css) {
      d.style.cssText += bg.css;
    } else {
      d.style.background = bg.gradient ||
        "linear-gradient(135deg,#0b0b12,#1a1330 40%,#0a1a22 100%)";
    }
    if (bg.animate !== false && !bg.css) {
      d.style.backgroundSize = "300% 300%";
      addKeyframesOnce();
      d.style.animation = "ocskin-drift " + (bg.duration || 24) + "s ease-in-out infinite";
    }
    host.appendChild(d);
    return d;
  }
  var keyframesAdded = false;
  function addKeyframesOnce() {
    if (keyframesAdded) return; keyframesAdded = true;
    var st = document.createElement("style");
    st.id = "ocskin-keyframes";
    st.textContent = "@keyframes ocskin-drift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}";
    document.head.appendChild(st);
  }

  function buildFallback(s, name, bg, host) {
    var fb = bg.fallback;
    if (fb === "gradient" || !fb) return buildGradient(s, bg, host);
    if (typeof fb === "string") return buildShader(s, fb, bg, host);
    return buildGradient(s, bg, host);
  }

  // canvas shaders (2D, cheap, framework-free) -----------------------------
  function buildShader(s, kind, bg, host) {
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    host.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    }
    resize();
    var ro = new ResizeObserver(resize); ro.observe(canvas);
    track(s, "cleanups", function () { ro.disconnect(); });

    var painter = SHADERS[kind] || SHADERS.aurora;
    var start = performance.now();
    var running = true;
    function frame(now) {
      if (!running) return;
      var t = (now - start) / 1000;
      try { painter(ctx, canvas.width, canvas.height, t, bg); } catch (e) { running = false; warn("shader error", e); }
      if (!reduce) track(s, "rafs", requestAnimationFrame(frame));
    }
    track(s, "rafs", requestAnimationFrame(frame));
    // pause when hidden to save CPU
    var onVis = function () {
      if (document.hidden) { running = false; }
      else if (!reduce) { running = true; track(s, "rafs", requestAnimationFrame(frame)); }
    };
    document.addEventListener("visibilitychange", onVis);
    track(s, "cleanups", function () { running = false; document.removeEventListener("visibilitychange", onVis); });
    return canvas;
  }

  function hsl(h, sat, l, a) { return "hsla(" + h + "," + sat + "%," + l + "%," + (a == null ? 1 : a) + ")"; }

  var SHADERS = {
    // flowing aurora blobs
    aurora: function (ctx, w, h, t, bg) {
      var pal = (bg && bg.colors) || [265, 190, 330]; // hues
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      var n = pal.length;
      for (var i = 0; i < n; i++) {
        var ph = t * 0.15 + i * 2.1;
        var cx = w * (0.5 + 0.35 * Math.sin(ph * 0.7 + i));
        var cy = h * (0.5 + 0.35 * Math.cos(ph * 0.9 + i * 1.3));
        var r = Math.min(w, h) * (0.55 + 0.12 * Math.sin(ph + i));
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, hsl(pal[i], 85, 60, 0.55));
        g.addColorStop(1, hsl(pal[i], 85, 60, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
    // soft moving mesh gradient
    mesh: function (ctx, w, h, t, bg) {
      var pal = (bg && bg.colors) || [220, 280, 160, 320];
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < pal.length; i++) {
        var ph = t * 0.1 + i * 1.7;
        var cx = w * (0.5 + 0.4 * Math.sin(ph));
        var cy = h * (0.5 + 0.4 * Math.cos(ph * 1.2));
        var r = Math.max(w, h) * 0.6;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, hsl(pal[i], 70, 45, 0.5));
        g.addColorStop(1, hsl(pal[i], 70, 20, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    },
    // slow sine waves
    waves: function (ctx, w, h, t, bg) {
      var base = (bg && bg.colors && bg.colors[0]) || 200;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = hsl(base, 40, 6, 1); ctx.fillRect(0, 0, w, h);
      for (var k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x <= w; x += 12) {
          var y = h * (0.55 + 0.08 * k) + Math.sin(x * 0.006 + t * (0.6 + k * 0.2) + k) * (18 + k * 10);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.closePath();
        ctx.fillStyle = hsl(base + k * 18, 60, 30 - k * 4, 0.35);
        ctx.fill();
      }
    },
    // drifting starfield
    stars: (function () {
      var pts = null;
      return function (ctx, w, h, t, bg) {
        if (!pts || pts.length === 0) {
          pts = []; for (var i = 0; i < 160; i++) pts.push([Math.random(), Math.random(), 0.3 + Math.random()]);
        }
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, w, h);
        for (var j = 0; j < pts.length; j++) {
          var p = pts[j];
          var x = ((p[0] + t * 0.01 * p[2]) % 1) * w;
          var y = p[1] * h;
          var a = 0.4 + 0.6 * Math.abs(Math.sin(t * p[2] + j));
          ctx.fillStyle = "rgba(200,210,255," + a + ")";
          ctx.fillRect(x, y, p[2] * 1.6, p[2] * 1.6);
        }
      };
    })()
  };

  function buildBackground(s, name, bg) {
    if (!bg || bg.type === "none") return;
    var host = bgContainer(s, bg);
    switch (bg.type) {
      case "video": buildVideo(s, name, bg, host); break;
      case "image": buildImage(s, name, bg, host); break;
      case "shader": buildShader(s, bg.shader || "aurora", bg, host); break;
      case "gradient": buildGradient(s, bg, host); break;
      default: warn("unknown background type:", bg.type);
    }
  }

  // ---- declarative DOM component patches ---------------------------------
  // rule: { selector, hide, style:{}, addClass, removeClass, attr:{}, text, html, before, after, remove }
  function applyPatchRule(rule) {
    var els = document.querySelectorAll(rule.selector);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (rule.remove) { el.remove(); continue; }
      if (rule.hide) el.style.setProperty("display", "none", "important");
      if (rule.style) Object.keys(rule.style).forEach(function (k) {
        el.style.setProperty(k, rule.style[k], "important");
      });
      if (rule.addClass) String(rule.addClass).split(/\s+/).forEach(function (c) { if (c) el.classList.add(c); });
      if (rule.removeClass) String(rule.removeClass).split(/\s+/).forEach(function (c) { if (c) el.classList.remove(c); });
      if (rule.attr) Object.keys(rule.attr).forEach(function (k) { el.setAttribute(k, rule.attr[k]); });
      if (rule.text != null) el.textContent = rule.text;
      if (rule.html != null) el.innerHTML = rule.html;
      if (rule.before != null && !el.__ocPre) { el.insertAdjacentHTML("beforebegin", rule.before); el.__ocPre = true; }
      if (rule.after != null && !el.__ocPost) { el.insertAdjacentHTML("afterend", rule.after); el.__ocPost = true; }
    }
  }
  function applyPatches(s, patches) {
    if (!patches || !patches.length) return;
    var run = function () { patches.forEach(function (r) { try { applyPatchRule(r); } catch (e) {} }); };
    run();
    // re-apply after SolidJS re-renders (debounced)
    var pending = false;
    var mo = new MutationObserver(function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; run(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    track(s, "observers", mo);
  }

  // ---- HUD / toast --------------------------------------------------------
  var hud = null, hudTimer = null;
  function toast(msg) {
    if (!document.body) return;
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "ocskin-hud";
      hud.style.cssText = [
        "position:fixed", "left:50%", "bottom:28px", "transform:translateX(-50%) translateY(8px)",
        "z-index:2147483647", "pointer-events:none", "padding:8px 14px", "border-radius:10px",
        "font:12px/1.4 'Inter',system-ui,sans-serif", "color:#fff",
        "background:rgba(20,20,28,.82)", "backdrop-filter:blur(10px)",
        "border:1px solid rgba(255,255,255,.14)", "box-shadow:0 8px 30px rgba(0,0,0,.45)",
        "opacity:0", "transition:opacity .18s ease, transform .18s ease"
      ].join(";");
      document.body.appendChild(hud);
    }
    hud.textContent = msg;
    requestAnimationFrame(function () {
      hud.style.opacity = "1"; hud.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () {
      hud.style.opacity = "0"; hud.style.transform = "translateX(-50%) translateY(8px)";
    }, 1400);
  }

  // ---- apply a skin -------------------------------------------------------
  var current = null;      // { name, manifest }
  var applying = false;
  function applyByName(name) {
    if (name === NONE) { disable(); return Promise.resolve(); }
    if (applying) return Promise.resolve();
    applying = true;
    return fetchJSON(skinURL(name, "skin.json")).then(function (manifest) {
      return new Promise(function (resolve) {
        whenBody(function () {
          teardown();
          var s = newState(name);
          try {
            applyColorScheme(manifest.base || manifest.colorScheme);
            // capture originals AFTER color scheme is set, BEFORE overriding vars
            var bg = manifest.background;
            if (manifest.vars) applyVars(s, manifest.vars);
            if (bg && bg.type && bg.type !== "none" && bg.revealSurfaces !== false) {
              revealShell(s);
              if (bg.glass) buildGlass(s, { blur: bg.glassBlur, saturate: bg.glassSaturate, tint: bg.glassTint });
              else translucifyTokens(s, bg.surfaceAlpha != null ? bg.surfaceAlpha : 0.7);
            }
            // custom CSS
            if (manifest.cssText) addStyle(s, "ocskin-css", manifest.cssText);
            var chain = manifest.css
              ? fetchText(skinURL(name, manifest.css)).then(function (css) { addStyle(s, "ocskin-css-file", css); }).catch(function (e) { warn("css load failed", e.message); })
              : Promise.resolve();
            chain.then(function () {
              buildBackground(s, name, bg);
              applyPatches(s, manifest.patches);
              state = s; current = { name: name, manifest: manifest };
              return manifest.js
                ? fetchText(skinURL(name, manifest.js)).then(function (code) { runSkinJS(s, code, current); }).catch(function (e) { warn("js load failed", e.message); })
                : null;
            }).then(function () {
              log("applied", name);
              emit("applied", current);
              toast("Skin: " + (manifest.title || name));
              resolve();
            });
          } catch (e) {
            warn("apply error", e); state = s; resolve();
          }
        });
      });
    }).catch(function (e) {
      warn("could not load skin '" + name + "':", e.message);
    }).then(function () { applying = false; });
  }

  function runSkinJS(s, code, ctx) {
    try {
      var fn = new Function("ocskin", "skin", "state", code);
      var ret = fn(api, ctx, {
        add: function (node) { return track(s, "nodes", node); },
        style: function (id, css) { return addStyle(s, id, css); },
        onTeardown: function (cb) { s.cleanups.push(cb); },
        interval: function (cb, ms) { return track(s, "timers", setInterval(cb, ms)); }
      });
      if (typeof ret === "function") s.cleanups.push(ret);
    } catch (e) { warn("skin js threw", e); }
  }

  function disable() {
    teardown();
    restoreColorScheme();
    current = null;
    log("disabled");
    emit("disabled");
    toast("Skins off");
  }

  // ---- public API ---------------------------------------------------------
  var _list = [];
  var api = {
    version: "1.0.0",
    root: ROOT,
    get config() { return config; },
    list: function () { return listSkins().then(function (l) { _list = l; return l.slice(); }); },
    current: function () { return current ? current.name : null; },
    manifest: function () { return current ? current.manifest : null; },
    apply: function (name, persist) {
      if (persist !== false) { try { localStorage.setItem(LS_ACTIVE, name); } catch (e) {} }
      return applyByName(name);
    },
    reload: function () { return current ? applyByName(current.name) : boot(); },
    disable: function () { try { localStorage.setItem(LS_ACTIVE, NONE); } catch (e) {} disable(); },
    enable: function () { try { localStorage.removeItem(LS_ACTIVE); } catch (e) {} return boot(); },
    next: function () { return cycle(1); },
    prev: function () { return cycle(-1); },
    setVar: function (k, v) {
      var el = document.getElementById("ocskin-live") || (function () {
        var e = document.createElement("style"); e.id = "ocskin-live"; document.head.appendChild(e); return e;
      })();
      el.textContent = (el.textContent || "").replace(new RegExp("\\n?" + k.replace(/[-]/g, "\\-") + ":[^;]*;"), "");
      el.textContent += "\nhtml{" + k + ":" + v + " !important;}";
    },
    getVar: function (k) { return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); },
    patch: function (selector, ops) { applyPatchRule(Object.assign({ selector: selector }, ops || {})); },
    toast: toast,
    on: on, off: off
  };
  function cycle(dir) {
    return api.list().then(function (l) {
      if (!l.length) return;
      var i = l.indexOf(api.current());
      var n = l[((i + dir) % l.length + l.length) % l.length];
      return api.apply(n);
    });
  }

  // ---- hotkeys ------------------------------------------------------------
  function wireHotkeys() {
    window.addEventListener("keydown", function (e) {
      if (!config.hotkeys) return;
      if (!(e.ctrlKey && e.altKey)) return;
      var k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); e.shiftKey ? api.prev() : api.next(); }
      else if (k === "r") { e.preventDefault(); api.reload(); }
      else if (k === "0") { e.preventDefault(); api.disable(); }
      else if (k === "l") { e.preventDefault(); api.list().then(function (l) { log("skins:", l, "current:", api.current()); toast("Skins: " + l.join(", ")); }); }
    }, true);
  }

  // ---- hot reload ---------------------------------------------------------
  var lastManifestText = null;
  function wireHotReload() {
    if (!config.hotReload) return;
    var timer = setInterval(function () {
      if (document.hidden || !current) return;
      fetchText(skinURL(current.name, "skin.json")).then(function (txt) {
        if (lastManifestText == null) { lastManifestText = txt; return; }
        if (txt !== lastManifestText) { lastManifestText = txt; log("hot-reload"); applyByName(current.name); }
      }).catch(function () {});
    }, 1500);
    // not tracked by skin state — lives for the session
    window.__ocskinHotTimer = timer;
  }

  // ---- boot ---------------------------------------------------------------
  function resolveActive() {
    var override = null;
    try { override = localStorage.getItem(LS_ACTIVE); } catch (e) {}
    if (override) return override;
    return config.active || "aurora";
  }
  // Load optional overlay modules that live alongside skins (e.g. the code pet).
  // Independent of the active skin; opt out with "pet": false in active.json.
  function loadPet() {
    if (config.pet === false) return;
    fetchText(ROOT + "/pet/pet.js").then(function (code) {
      try { new Function("ocskin", code)(api); }
      catch (e) { warn("pet error", e); }
    }).catch(function () { /* pet not installed */ });
  }

  function boot() {
    return loadConfig().then(function () {
      wireHotkeys();
      wireHotReload();
      loadPet();
      var name = resolveActive();
      if (name === NONE) { log("skins disabled by preference"); return; }
      return applyByName(name);
    });
  }

  window.__ocskin = api;
  window.ocskin = api;
  log("engine loaded", ROOT);
  boot();
})();
