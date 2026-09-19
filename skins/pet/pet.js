/*
 * opencode-skins :: code pet
 * A procedural canvas companion that reacts to REAL opencode events.
 * Loaded by the skin engine (independent of the active skin).
 *
 * Event source: the local opencode server's /event SSE stream, reached with the
 * credentials window.api.awaitInitialization() exposes. DOM spinners are a
 * fallback so the pet still reacts if the stream is unavailable.
 *
 * Public: window.ocpet { show, hide, toggle, setMood, say, destroy }
 */
(function () {
  "use strict";
  if (window.__ocpet) return;
  var API = window.ocskin || null;
  var rawPet = (API && API.config) ? API.config.pet : undefined;
  if (rawPet === false) return;                       // opted out
  var cfg = (rawPet && typeof rawPet === "object") ? rawPet : {};
  var NAME = cfg.name || "Codi";
  var SCALE = cfg.scale || 1;
  var QUIPS = cfg.quips !== false;
  var SLEEP_MS = (cfg.sleepAfter || 60) * 1000;

  var log = function () { try { console.log.apply(console, ["%c[ocpet]", "color:#8b7cff"].concat([].slice.call(arguments))); } catch (e) {} };

  // ---- state -------------------------------------------------------------
  var busy = false;            // assistant/tool running
  var sleeping = false;
  var transient = null;        // "happy" | "error" (temporary override)
  var tTimer = null, sleepTimer = null;
  var shakeUntil = 0;

  function busyKind() {
    return document.querySelector('[data-component="spinner"],[data-component="task-tool-spinner"],[data-component="session-progress-indicator-v2"]')
      ? "working" : "thinking";
  }
  function effectiveMood() {
    if (transient) return transient;
    if (busy) return busyKind();
    if (sleeping) return "sleeping";
    return "idle";
  }
  function activity() {
    sleeping = false;
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(function () { if (!busy && !transient) sleeping = true; }, SLEEP_MS);
  }
  function setTransient(mood, ms) {
    transient = mood;
    clearTimeout(tTimer);
    tTimer = setTimeout(function () { transient = null; activity(); }, ms);
  }

  var SAY = {
    happy: ["完成啦!", "漂亮✨", "搞定~", "干得漂亮", "又推进一步!"],
    error: ["哎呀…", "出错了?", "别慌,一起 debug", "看看日志?", "稳住,能修"],
    click: ["嘿嘿~", "有事找我?", "(蹭蹭)", "再摸一下嘛", "我在呢"],
    idle:  ["在听着呢~", "要不要喝杯咖啡?", "写得不错嘛", "我盯着代码呢✨", "累了就歇会儿"]
  };
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  function onEvent(evt) {
    var t = (evt && evt.type) || "";
    if (t.indexOf("message.part") === 0 || t === "message.created" || t === "message.updated" || t === "session.status") {
      busy = true; activity();
    } else if (t === "message.completed") {
      busy = false; say(pick(SAY.happy)); setTransient("happy", 2600);
    } else if (t === "message.error" || t === "session.error") {
      busy = false; say(pick(SAY.error)); setTransient("error", 3600); shakeUntil = performance.now() + 700;
    } else if (t === "session.idle") {
      busy = false; activity();
    }
  }

  // ---- event stream (primary) + DOM fallback -----------------------------
  var stop = false, reader = null;
  async function connect() {
    while (!stop) {
      try {
        var init = await window.api.awaitInitialization(); // {url, username, password}
        var auth = "Basic " + btoa((init.username || "opencode") + ":" + (init.password || ""));
        var res = await fetch(init.url.replace(/\/$/, "") + "/event", { headers: { authorization: auth } });
        if (!res.ok || !res.body) throw new Error("event stream " + res.status);
        log("event stream connected");
        reader = res.body.getReader();
        var dec = new TextDecoder(), buf = "";
        while (!stop) {
          var r = await reader.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            var chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            var line = chunk.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
            if (!line) continue;
            try { onEvent(JSON.parse(line.slice(5).trim())); } catch (e) {}
          }
        }
      } catch (e) {
        // fall through to reconnect; DOM observer keeps the pet alive meanwhile
      }
      if (stop) break;
      await new Promise(function (r) { setTimeout(r, 3000); });
    }
  }
  function domFallback() {
    var pending = false;
    var mo = new MutationObserver(function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () {
        pending = false;
        var b = !!document.querySelector('[data-component="spinner"],[data-component="task-tool-spinner"],[data-component="session-progress-indicator-v2"]');
        if (b && !busy) { busy = true; activity(); }
        else if (!b && busy) { busy = false; activity(); }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return mo;
  }

  // ---- DOM: container / canvas / bubble ----------------------------------
  var host, canvas, ctx, bubble, W = 130, H = 140, dpr = Math.min(window.devicePixelRatio || 1, 2);
  function build() {
    host = document.createElement("div");
    host.id = "ocpet";
    host.style.cssText = [
      "position:fixed", "z-index:2147483000", "width:" + W * SCALE + "px", "height:" + H * SCALE + "px",
      "pointer-events:none", "user-select:none", "-webkit-user-select:none"
    ].join(";");
    canvas = document.createElement("canvas");
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.cssText = "width:100%;height:100%;pointer-events:auto;cursor:grab;display:block;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));";
    ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    bubble = document.createElement("div");
    bubble.id = "ocpet-bubble";
    bubble.style.cssText = [
      "position:absolute", "left:50%", "bottom:100%", "transform:translateX(-50%) translateY(6px)",
      "max-width:180px", "padding:6px 10px", "border-radius:12px", "font:12px/1.35 'Inter',system-ui,sans-serif",
      "color:#fff", "background:rgba(24,22,36,.9)", "backdrop-filter:blur(8px)",
      "border:1px solid rgba(255,255,255,.14)", "box-shadow:0 8px 24px rgba(0,0,0,.4)",
      "white-space:normal", "text-align:center", "opacity:0", "transition:opacity .2s,transform .2s", "pointer-events:none"
    ].join(";");
    host.appendChild(bubble);
    host.appendChild(canvas);
    document.body.appendChild(host);
    restorePos();
    wireInput(canvas);
  }

  var bubbleTimer = null;
  function say(text, ms) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.style.opacity = "1"; bubble.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      bubble.style.opacity = "0"; bubble.style.transform = "translateX(-50%) translateY(6px)";
    }, ms || 2600);
  }

  // ---- position / drag ----------------------------------------------------
  function restorePos() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("ocpet:pos2")); } catch (e) {}
    if (saved && typeof saved.left === "number") { host.style.left = saved.left + "px"; host.style.top = saved.top + "px"; }
    else { host.style.right = "26px"; host.style.bottom = "104px"; }
  }
  function handleTap(e) {
    if (typeof api.onTap === "function") { try { api.onTap(e); } catch (er) {} }
    else { pats++; hearts(); say(pick(SAY.click)); }
    if (sleeping) activity();
  }
  function wireInput(el) {
    var down = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    el.addEventListener("pointerdown", function (e) {
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
      var r = host.getBoundingClientRect(); ox = r.left; oy = r.top;
      host.style.right = "auto"; host.style.bottom = "auto"; host.style.left = ox + "px"; host.style.top = oy + "px";
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      var nx = Math.max(0, Math.min(window.innerWidth - host.offsetWidth, ox + dx));
      var ny = Math.max(0, Math.min(window.innerHeight - host.offsetHeight, oy + dy));
      host.style.left = nx + "px"; host.style.top = ny + "px";
    });
    el.addEventListener("pointerup", function (e) {
      down = false; el.style.cursor = "grab";
      if (moved) { try { localStorage.setItem("ocpet:pos2", JSON.stringify({ left: host.offsetLeft, top: host.offsetTop })); } catch (er) {} }
      else { handleTap(e); }
    });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); api.hide(); });
  }

  // ---- little heart burst on pet -----------------------------------------
  var fxHearts = [];
  var pats = 0;
  function hearts() {
    for (var i = 0; i < 5; i++) fxHearts.push({ x: 65 + (Math.random() * 30 - 15), y: 70, vy: -0.6 - Math.random() * 0.5, life: 1, hue: 330 + Math.random() * 20 });
  }

  // ---- moods --------------------------------------------------------------
  var MOODS = {
    idle:     { color: "#8b7cff", bounce: 0,    eyes: "normal", mouth: "smile", fx: null },
    thinking: { color: "#6aa0ff", bounce: 0.35, eyes: "up",     mouth: "o",     fx: "think" },
    working:  { color: "#ffb454", bounce: 0.9,  eyes: "normal", mouth: "smile", fx: "work" },
    happy:    { color: "#57d977", bounce: 1.5,  eyes: "happy",  mouth: "grin",  fx: "sparkle" },
    error:    { color: "#ff5c6a", bounce: 0,    eyes: "wide",   mouth: "flat",  fx: "sweat", shake: true },
    sleeping: { color: "#5b6480", bounce: 0,    eyes: "closed", mouth: "smile", fx: "zzz" }
  };
  var cur = hexRgb("#8b7cff");
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 }; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgbStr(c, a) { return "rgba(" + (c.r | 0) + "," + (c.g | 0) + "," + (c.b | 0) + "," + (a == null ? 1 : a) + ")"; }

  // ---- render loop --------------------------------------------------------
  var last = performance.now(), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var blinkT = 0, blinkNext = 1.5;
  var blobSuppressed = false;
  function suppressBlob() {
    blobSuppressed = true;
    if (raf) cancelAnimationFrame(raf);
    if (canvas) canvas.style.display = "none";
  }
  function frame(now) {
    if (stop || blobSuppressed) return;
    if (document.hidden) { raf = requestAnimationFrame(frame); return; }
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var t = now / 1000;
    var mood = MOODS[effectiveMood()] || MOODS.idle;
    // color lerp
    var tgt = hexRgb(mood.color);
    cur.r = lerp(cur.r, tgt.r, 0.08); cur.g = lerp(cur.g, tgt.g, 0.08); cur.b = lerp(cur.b, tgt.b, 0.08);
    // blink timer
    blinkT += dt;
    var eyeOpen = 1;
    if (mood.eyes === "normal" || mood.eyes === "up" || mood.eyes === "wide") {
      if (blinkT > blinkNext) { var p = (blinkT - blinkNext) / 0.14; eyeOpen = p < 1 ? Math.abs(1 - 2 * p) : 1; if (p >= 1) { blinkT = 0; blinkNext = 1.4 + Math.random() * 2.6; } }
    }
    draw(now, t, mood, eyeOpen, dt);
    raf = requestAnimationFrame(frame);
  }

  function draw(now, t, mood, eyeOpen, dt) {
    ctx.clearRect(0, 0, W, H);
    var cx = 65, cy = 96, R = 30;
    var ox = 0, oy = 0;
    if (mood.shake && now < shakeUntil) ox = Math.sin(now / 32) * 3;
    var b = reduce ? 0 : mood.bounce;
    var hop = b ? Math.abs(Math.sin(t * 3.4)) * 9 * Math.min(1, b) : 0;
    oy -= hop;
    var breathe = 1 + Math.sin(t * 2) * 0.03;
    var squashY = b ? 1 - Math.cos(t * 3.4) * 0.05 * Math.min(1, b) : 1;
    var squashX = 2 - squashY;

    // ground shadow (shrinks with hop)
    ctx.save();
    ctx.globalAlpha = 0.28 - hop * 0.012;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.95, R * 0.8 * (1 - hop * 0.02), R * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // body
    ctx.save();
    ctx.translate(cx + ox, cy + oy);
    ctx.scale(squashX, squashY * breathe);
    var grad = ctx.createLinearGradient(0, -R, 0, R);
    grad.addColorStop(0, rgbStr({ r: Math.min(255, cur.r + 34), g: Math.min(255, cur.g + 34), b: Math.min(255, cur.b + 34) }));
    grad.addColorStop(1, rgbStr(cur));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    // cheek shine
    ctx.fillStyle = "rgba(255,255,255,.25)";
    ctx.beginPath(); ctx.ellipse(-R * 0.4, -R * 0.35, R * 0.22, R * 0.15, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // face (in unscaled space, follow hop)
    drawFace(cx + ox, cy + oy, mood, eyeOpen, t, R);
    drawFx(cx + ox, cy + oy, mood.fx, t, now, R);
    drawHearts(dt);
  }

  function drawFace(x, y, mood, eyeOpen, t, R) {
    var eyeY = y - R * 0.12, dx = R * 0.42, er = R * 0.17;
    var look = mood.eyes === "up" ? -er * 0.5 : Math.sin(t * 0.8) * er * 0.18;
    ctx.fillStyle = "#241f2e";
    ctx.strokeStyle = "#241f2e"; ctx.lineWidth = R * 0.11; ctx.lineCap = "round";
    if (mood.eyes === "happy") {
      arcEye(x - dx, eyeY, er); arcEye(x + dx, eyeY, er);
    } else if (mood.eyes === "closed") {
      closedEye(x - dx, eyeY, er); closedEye(x + dx, eyeY, er);
    } else {
      var h = mood.eyes === "wide" ? er * 1.35 : er;
      eye(x - dx, eyeY, er * 0.8, h * eyeOpen, look, mood.eyes === "up" ? -h * 0.4 : 0);
      eye(x + dx, eyeY, er * 0.8, h * eyeOpen, look, mood.eyes === "up" ? -h * 0.4 : 0);
    }
    // mouth
    ctx.strokeStyle = "#241f2e"; ctx.lineWidth = R * 0.09;
    var my = y + R * 0.34;
    ctx.beginPath();
    if (mood.mouth === "smile") { ctx.arc(x, my - R * 0.12, R * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); }
    else if (mood.mouth === "grin") { ctx.arc(x, my - R * 0.18, R * 0.26, 0.1 * Math.PI, 0.9 * Math.PI); }
    else if (mood.mouth === "o") { ctx.arc(x, my, R * 0.1, 0, Math.PI * 2); }
    else if (mood.mouth === "flat") { ctx.moveTo(x - R * 0.14, my); ctx.lineTo(x + R * 0.14, my); }
    ctx.stroke();
    // rosy cheeks when happy
    if (mood.eyes === "happy") {
      ctx.fillStyle = "rgba(255,120,150,.5)";
      ctx.beginPath(); ctx.ellipse(x - dx - er * 0.4, eyeY + er * 1.2, er * 0.5, er * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + dx + er * 0.4, eyeY + er * 1.2, er * 0.5, er * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function eye(x, y, w, h, lookX, lookY) {
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(x, y, w, Math.max(0.5, h), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#241f2e";
    ctx.beginPath(); ctx.ellipse(x + lookX, y + (lookY || 0), w * 0.55, Math.max(0.5, h) * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x + lookX + w * 0.18, y - h * 0.3, w * 0.16, 0, Math.PI * 2); ctx.fill();
  }
  function arcEye(x, y, r) { ctx.beginPath(); ctx.arc(x, y + r * 0.3, r, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
  function closedEye(x, y, r) { ctx.beginPath(); ctx.arc(x, y - r * 0.2, r, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }

  function drawFx(x, y, fx, t, now, R) {
    if (fx === "zzz") {
      for (var i = 0; i < 3; i++) {
        var p = ((now / 1000 * 0.5) + i * 0.33) % 1;
        ctx.save(); ctx.globalAlpha = 1 - p; ctx.fillStyle = "#cdd3ea";
        ctx.font = (10 + i * 4 + p * 6) + "px 'Inter',sans-serif";
        ctx.fillText("z", x + R * 0.6 + p * 14, y - R * 0.7 - p * 20); ctx.restore();
      }
    } else if (fx === "sparkle") {
      for (var s = 0; s < 4; s++) {
        var ph = (now / 1000 * 1.5 + s * 0.25) % 1;
        var a = Math.sin(ph * Math.PI);
        star(x + [-1, 1, -0.7, 0.8][s] * R * 1.1, y - R * (0.4 + [0.5, 0.7, 1, 0.9][s]) - ph * 6, 3 + a * 3, "rgba(255,240,150," + a + ")");
      }
    } else if (fx === "sweat") {
      var dp = (now / 700) % 1;
      ctx.fillStyle = "rgba(120,190,255,.9)";
      ctx.beginPath(); ctx.ellipse(x + R * 0.75, y - R * 0.3 + dp * R * 1.1, 3.2, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    } else if (fx === "think" || fx === "work") {
      for (var d = 0; d < 3; d++) {
        var pp = (now / 1000 * 2 - d * 0.25) % 1.2;
        var aa = pp < 1 ? Math.sin(pp * Math.PI) : 0;
        ctx.fillStyle = "rgba(255,255,255," + aa * 0.9 + ")";
        ctx.beginPath(); ctx.arc(x + (d - 1) * 9, y - R * 1.15, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function star(x, y, r, color) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.beginPath();
    for (var i = 0; i < 4; i++) { var a = i / 4 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a + 0.39) * r * 0.4, Math.sin(a + 0.39) * r * 0.4); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawHearts(dt) {
    for (var i = fxHearts.length - 1; i >= 0; i--) {
      var h = fxHearts[i]; h.y += h.vy; h.life -= dt * 0.9;
      if (h.life <= 0) { fxHearts.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = Math.max(0, h.life); ctx.fillStyle = "hsl(" + h.hue + ",90%,65%)";
      ctx.font = "14px serif"; ctx.fillText("♥", h.x, h.y); ctx.restore();
    }
  }

  // occasional idle quip
  function idleQuips() {
    setInterval(function () {
      if (!QUIPS || document.hidden) return;
      if (effectiveMood() === "idle" && Math.random() < 0.5) say(pick(SAY.idle), 3200);
    }, 90000);
  }

  // ---- public API ---------------------------------------------------------
  var raf = null, domMo = null;
  var api = {
    show: function () { if (host) host.style.display = ""; try { localStorage.setItem("ocpet:hidden2", "0"); } catch (e) {} },
    hide: function () { if (host) host.style.display = "none"; try { localStorage.setItem("ocpet:hidden2", "1"); } catch (e) {} },
    toggle: function () { (host && host.style.display === "none") ? api.show() : api.hide(); },
    setMood: function (m) { setTransient(m, 3000); },
    say: function (txt, ms) { say(txt, ms); },
    // hooks for an external renderer (e.g. Live2D)
    host: null,
    onTap: null,
    mood: function () { return effectiveMood(); },
    wireInput: function (el) { return wireInput(el); },
    suppressBlob: function () { return suppressBlob(); },
    destroy: function () { stop = true; if (raf) cancelAnimationFrame(raf); if (domMo) domMo.disconnect(); if (reader) try { reader.cancel(); } catch (e) {} if (host) host.remove(); window.__ocpet = null; }
  };
  function loadLive2D() {
    var url = new URL("__skins__/pet/live2d/live2d.js", document.baseURI).href + "?t=" + Date.now();
    fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (code) { try { new Function(code)(); } catch (e) { log("live2d error", e); } })
      .catch(function () { log("live2d.js unavailable; using blob"); });
  }

  function start() {
    build();
    api.host = host;
    try { if (localStorage.getItem("ocpet:hidden2") === "1") host.style.display = "none"; } catch (e) {}
    activity();
    domMo = domFallback();
    connect();
    idleQuips();
    raf = requestAnimationFrame(frame);
    window.__ocpet = api; window.ocpet = api;
    if (cfg.model || cfg.models) loadLive2D();   // upgrade to a Live2D model/models if configured
    else say(NAME + " 上线啦~", 2600);
    log("ready");
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
