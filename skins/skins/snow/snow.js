(function () {
  "use strict";

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";
  state.add(canvas);
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var W = 0, H = 0;

  var stars = [], flakes = [], shooting = null, nextShoot = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    stars = [];
    for (var i = 0; i < 90; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.75,
        r: 0.5 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.6
      });
    }
    if (!flakes.length) {
      for (var j = 0; j < 70; j++) {
        flakes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.8 + Math.random() * 2.0,
          vy: 12 + Math.random() * 26,
          sway: 0.3 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
          o: 0.35 + Math.random() * 0.55
        });
      }
    }
  }
  resize();
  window.addEventListener("resize", resize);

  var raf = 0, running = true, last = performance.now();

  function spawnShoot(now) {
    shooting = {
      x: Math.random() * W * 0.7,
      y: Math.random() * H * 0.3 + 20,
      vx: 420 + Math.random() * 380,
      vy: 130 + Math.random() * 160,
      born: now,
      life: 0.9 + Math.random() * 0.4
    };
    nextShoot = now + 5000 + Math.random() * 9000;
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var i, s;
    for (i = 0; i < stars.length; i++) {
      s = stars[i];
      var a = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = "#cfe2ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.y += f.vy * dt;
      f.x += Math.sin(t * 0.8 + f.phase) * f.sway * 0.6 + 0.12;
      if (f.y > H + 6) { f.y = -6; f.x = Math.random() * W; }
      if (f.x > W + 6) f.x = -6;
      ctx.globalAlpha = f.o;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!shooting && now > nextShoot) spawnShoot(now);
    if (shooting) {
      var age = (now - shooting.born) / 1000;
      if (age > shooting.life || shooting.x > W + 60 || shooting.y > H + 60) {
        shooting = null;
        if (!nextShoot) nextShoot = now + 4000;
      } else {
        shooting.x += shooting.vx * dt;
        shooting.y += shooting.vy * dt;
        var fade = 1 - age / shooting.life;
        var grad = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 0.12, shooting.y - shooting.vy * 0.12);
        grad.addColorStop(0, "rgba(255,255,255," + (0.9 * fade) + ")");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(shooting.x, shooting.y);
        ctx.lineTo(shooting.x - shooting.vx * 0.12, shooting.y - shooting.vy * 0.12);
        ctx.stroke();
      }
    }

    if (running) raf = requestAnimationFrame(frame);
  }
  nextShoot = performance.now() + 3500;
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
