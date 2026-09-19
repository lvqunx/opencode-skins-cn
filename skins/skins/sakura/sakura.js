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

  var N = 32;
  var petals = [];

  function spawn(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -30 - Math.random() * 100,
      s: 6 + Math.random() * 9,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 0.035,
      vy: 26 + Math.random() * 40,
      drift: 0.2 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      o: 0.35 + Math.random() * 0.5
    };
  }
  for (var i = 0; i < N; i++) petals.push(spawn(true));

  var raf = 0, running = true, last = performance.now();

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < N; i++) {
      var p = petals[i];
      p.y += p.vy * dt;
      p.x += Math.sin(t * 0.7 + p.phase) * p.drift + 0.35;
      p.a += p.va;
      if (p.y > H + 40 || p.x > W + 50) {
        petals[i] = spawn(false);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.globalAlpha = p.o;
      var g = ctx.createLinearGradient(-p.s / 2, 0, p.s / 2, 0);
      g.addColorStop(0, "#ffd9ea");
      g.addColorStop(1, "#ff9ec7");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s * 0.5, p.s * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
