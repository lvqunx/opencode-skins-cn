(function () {
  "use strict";

  var CHARS = "銈偆銈︺偍銈偒銈偗銈便偝銈点偡銈广偦銈姐偪銉併儎銉嗐儓銉娿儖銉屻儘銉?123456789ABCDEF<>$+-*/=";
  var FONT = 14;

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.92;";
  state.add(canvas);
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  var W = 0, H = 0, drops = [], lastRow = [], speeds = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    var cols = Math.ceil(W / FONT);
    drops = []; lastRow = []; speeds = [];
    for (var i = 0; i < cols; i++) {
      drops[i] = Math.random() * -60;
      lastRow[i] = -1;
      speeds[i] = 7 + Math.random() * 16;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#010403";
    ctx.fillRect(0, 0, W, H);
  }
  resize();
  window.addEventListener("resize", resize);

  function pick() {
    return CHARS[(Math.random() * CHARS.length) | 0];
  }

  var raf = 0, running = true, last = performance.now();

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(1,4,3,0.16)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT + "px 'JetBrainsMono Nerd Font Mono','Cascadia Mono',Consolas,monospace";
    for (var i = 0; i < drops.length; i++) {
      drops[i] += speeds[i] * dt;
      var row = Math.floor(drops[i]);
      if (row !== lastRow[i]) {
        var x = i * FONT;
        var y = row * FONT;
        if (row < 0) {
          lastRow[i] = row;
          continue;
        }
        if (y > H + FONT) {
          if (Math.random() > 0.94) {
            drops[i] = -Math.random() * 8;
            lastRow[i] = -1;
          }
          continue;
        }
        ctx.fillStyle = "rgba(59,255,158,0.55)";
        ctx.fillText(pick(), x, y - FONT);
        ctx.fillStyle = "rgba(200,255,225,0.95)";
        ctx.fillText(pick(), x, y);
        lastRow[i] = row;
      }
    }
    if (running) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function onVis() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", onVis);

  state.onTeardown(function () {
    running = false;
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("resize", resize);
  });
})();
