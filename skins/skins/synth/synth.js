(function () {
  "use strict";

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";
  state.add(canvas);
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var W = 0, H = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  var raf = 0, running = true;

  function drawSun(t, hy) {
    var r = Math.min(W, H) * 0.21;
    var cx = W / 2;
    var cy = hy - r * 0.3;
    var breathe = 1 + Math.sin(t * 0.4) * 0.015;
    r *= breathe;
    var g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, "#ffd166");
    g.addColorStop(0.45, "#ff5ca8");
    g.addColorStop(1, "#ff2bd6");
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "destination-out";
    for (var i = 0; i < 7; i++) {
      var sy = cy + r * 0.02 + i * r * 0.14 + Math.sin(t * 0.6 + i) * 1.5;
      ctx.fillRect(cx - r, sy, r * 2, 2 + i * 1.3);
    }
    ctx.restore();
    var glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.1);
    glow.addColorStop(0, "rgba(255,43,214,0.22)");
    glow.addColorStop(1, "rgba(255,43,214,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGrid(t, hy) {
    var vpx = W / 2;
    ctx.lineWidth = 1;
    // converging verticals
    ctx.strokeStyle = "rgba(57,230,255,0.30)";
    var span = W / 9;
    for (var k = -12; k <= 12; k++) {
      ctx.beginPath();
      ctx.moveTo(vpx, hy);
      ctx.lineTo(vpx + k * span, H + 40);
      ctx.stroke();
    }
    // scrolling horizontals (accelerating with depth)
    for (var j = 0; j < 16; j++) {
      var p = (j / 16 + (t * 0.055) % (1 / 16)) % 1;
      var y = hy + (H - hy) * p * p;
      ctx.globalAlpha = 0.12 + p * 0.4;
      ctx.strokeStyle = "rgba(57,230,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var t = now / 1000;
    var hy = H * 0.58;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawSun(t, hy);
    ctx.fillStyle = "rgba(255,43,214,0.5)";
    ctx.fillRect(0, hy - 1, W, 2);
    drawGrid(t, hy);
    if (running) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function onVis() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
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
