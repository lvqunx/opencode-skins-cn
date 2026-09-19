(function () {
  "use strict";

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";
  state.add(canvas);
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var W = 0, H = 0, parts = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  function spawn(initial) {
    var life = 5 + Math.random() * 5;
    return {
      x: Math.random() * W,
      y: initial ? Math.random() * H : H + 10,
      r: 0.8 + Math.random() * 2.2,
      vy: 24 + Math.random() * 48,
      sway: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      age: initial ? Math.random() * life : 0,
      life: life,
      hue: 18 + Math.random() * 26
    };
  }
  for (var i = 0; i < 60; i++) parts.push(spawn(true));

  var raf = 0, running = true, last = performance.now();

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
    var glow = ctx.createRadialGradient(W / 2, H + 80, 0, W / 2, H + 80, Math.max(W, H) * 0.55);
    glow.addColorStop(0, "rgba(255,120,40," + (0.10 + pulse * 0.08) + ")");
    glow.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.age += dt;
      p.y -= p.vy * dt;
      p.x += Math.sin(t * 1.6 + p.phase) * p.sway * 0.5;
      if (p.age > p.life || p.y < -12) {
        parts[i] = spawn(false);
        continue;
      }
      var k = p.age / p.life;
      var a = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.8;
      var flick = 0.75 + 0.25 * Math.sin(t * 9 + p.phase * 7);
      ctx.globalAlpha = Math.max(0, a * flick);
      ctx.fillStyle = "hsl(" + p.hue + ", 100%, 62%)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.r > 2) {
        ctx.globalAlpha = Math.max(0, a * flick * 0.35);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
