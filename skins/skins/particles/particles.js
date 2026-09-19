/*
 * opencode-skins :: Particle Net (port of the H3 Studio particles v3)
 * Three.js particle network rendered over the UI:
 *   - round shader dots (no texture), proximity link lines
 *   - mouse repel + size/color highlight + camera parallax
 *   - auto pause when the window is hidden, full teardown on skin switch
 * three.min.js (r128) is bundled next to this file and loaded from the skin folder.
 */
(function () {
  "use strict";

  var NAME = "particles";
  var ROOT = new URL("__skins__", document.baseURI).href.replace(/\/+$/, "");

  function log() {
    try {
      console.log.apply(console, ["%c[ocskin-fx]", "color:#37e6ff;font-weight:bold"].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  function loadThree(cb) {
    if (window.THREE) return cb(null);
    var s = document.createElement("script");
    s.src = ROOT + "/skins/" + NAME + "/three.min.js?v=" + Date.now();
    s.onload = function () { cb(window.THREE ? null : new Error("THREE not defined")); };
    s.onerror = function () { cb(new Error("three.min.js failed to load")); };
    document.head.appendChild(s);
  }

  function start() {
    var canvas = document.createElement("canvas");
    canvas.id = "ocskin-fx-canvas";
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147482500;";
    state.add(canvas);
    document.body.appendChild(canvas);

    var W = 0, H = 0, HALF_W = 9, HALF_H = 7;
    var scene = null, camera = null, renderer = null;
    var pGeo = null, pMat = null, lGeo = null, lMat = null;
    var particles = [];
    var baseCol = null;
    var cssAccent = "#37e6ff";
    var cssViolet = "#8b7bff";
    var LINK_DIST = 2.7;
    var CURSOR_R = 3.2;
    var BASE_SIZE = 2.0;
    var CURSOR_BOOST = 3.0;
    var PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.75);
    var targetPoint = 0.9, targetLink = 0.32;
    var curPoint = 0, curLink = 0;
    var mouse = { x: 0, y: 0, wx: 0, wy: 0, active: false };
    var raf = null, disposed = false;
    var clock = new THREE.Clock();

    function readAccent() {
      try {
        var v = ocksin.getVar("--color-v2-text-text-accent");
        if (v && v.trim()) cssAccent = v.trim();
      } catch (e) {}
      if (lMat) lMat.uniforms.uColor.value.set(cssAccent);
      if (baseCol) {
        var cA = new THREE.Color(), cB = new THREE.Color();
        try { cA.set(cssAccent); } catch (e) { cA.set("#37e6ff"); }
        try { cB.set(cssViolet); } catch (e) { cB.set("#8b7bff"); }
        for (var i = 0, n = particles.length; i < n; i++) {
          var cc = i % 2 ? cB : cA;
          baseCol[i * 3] = cc.r; baseCol[i * 3 + 1] = cc.g; baseCol[i * 3 + 2] = cc.b;
        }
      }
    }

    function onResize() {
      W = window.innerWidth; H = window.innerHeight;
      if (!renderer || !camera) return;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      var halfH = Math.tan((55 * Math.PI) / 360) * 15;
      HALF_W = halfH * (W / H) * 1.12;
      HALF_H = halfH * 1.05;
    }

    function onMouse(e) {
      mouse.x = (e.clientX / W) * 2 - 1;
      mouse.y = (e.clientY / H) * 2 - 1;
      mouse.wx = mouse.x * HALF_W * 1.25;
      mouse.wy = -mouse.y * HALF_H * 1.25;
      mouse.active = true;
    }

    function onMouseLeave() { mouse.active = false; }

    function onVis() {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else if (!raf) { raf = requestAnimationFrame(loop); }
    }

    function buildLineMaterial() {
      return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(cssAccent) },
          uOpacity: { value: targetLink }
        },
        vertexShader: [
          "attribute float aAlpha;",
          "varying float vA;",
          "void main() {",
          "  vA = aAlpha;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "}"
        ].join("\n"),
        fragmentShader: [
          "uniform vec3 uColor;",
          "uniform float uOpacity;",
          "varying float vA;",
          "void main() {",
          "  gl_FragColor = vec4(uColor, uOpacity * vA);",
          "}"
        ].join("\n")
      });
    }

    function loop() {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      var n = particles.length;
      var pos = pGeo.attributes.position.array;
      var col = pGeo.attributes.color.array;
      var sizes = pGeo.attributes.aSize.array;

      camera.position.x += (mouse.x * 1.0 - camera.position.x) * 0.035;
      camera.position.y += (-mouse.y * 0.6 - camera.position.y) * 0.035;
      camera.lookAt(scene.position);

      var wx = mouse.active ? mouse.wx : 1e9;
      var wy = mouse.active ? mouse.wy : 1e9;

      for (var i = 0; i < n; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        var dx = p.x - wx, dy = p.y - wy, dz = p.z;
        var md = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var boost = 0;
        if (mouse.active && md < CURSOR_R && md > 0.001) {
          boost = (CURSOR_R - md) / CURSOR_R;
          var pull = 0.012 * boost;
          p.x += (dx / md) * pull;
          p.y += (dy / md) * pull;
        }
        if (p.x > 12.4) p.x = -12.4; else if (p.x < -12.4) p.x = 12.4;
        if (p.y > 7.4) p.y = -7.4; else if (p.y < -7.4) p.y = 7.4;
        if (p.z > 6) p.z = -12; else if (p.z < -13) p.z = 5;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        sizes[i] = BASE_SIZE + CURSOR_BOOST * boost;
        var bi = i * 3;
        var r = baseCol[bi], g = baseCol[bi + 1], b = baseCol[bi + 2];
        var bright = 0.95 * boost;
        col[bi] = r + (1 - r) * bright;
        col[bi + 1] = g + (1 - g) * bright;
        col[bi + 2] = b + (1 - b) * bright;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
      pGeo.attributes.aSize.needsUpdate = true;

      var lpos = lGeo.attributes.position.array;
      var lalp = lGeo.attributes.aAlpha.array;
      var k = 0;
      for (var a = 0; a < n; a++) {
        for (var b = a + 1; b < n; b++) {
          var pa = particles[a], pb = particles[b];
          var ddx = pa.x - pb.x, ddy = pa.y - pb.y, ddz = pa.z - pb.z;
          var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 < LINK_DIST * LINK_DIST) {
            var o = Math.sqrt(d2) / LINK_DIST;
            var alpha = 1 - o;
            lpos[k * 6] = pa.x; lpos[k * 6 + 1] = pa.y; lpos[k * 6 + 2] = pa.z;
            lpos[k * 6 + 3] = pb.x; lpos[k * 6 + 4] = pb.y; lpos[k * 6 + 5] = pb.z;
            lalp[k] = alpha;
            k++;
          }
        }
      }
      if (mouse.active) {
        for (var c = 0; c < n; c++) {
          var pc = particles[c];
          var cx = pc.x - wx, cy = pc.y - wy, cz = pc.z;
          var cd = Math.sqrt(cx * cx + cy * cy + cz * cz);
          if (cd < CURSOR_R && cd > 0.001) {
            var ca = (1 - cd / CURSOR_R) * 0.9;
            lpos[k * 6] = wx; lpos[k * 6 + 1] = wy; lpos[k * 6 + 2] = 0;
            lpos[k * 6 + 3] = pc.x; lpos[k * 6 + 4] = pc.y; lpos[k * 6 + 5] = pc.z;
            lalp[k] = ca;
            k++;
          }
        }
      }
      lGeo.setDrawRange(0, k * 2);
      lGeo.attributes.position.needsUpdate = true;
      lGeo.attributes.aAlpha.needsUpdate = true;

      curPoint += (targetPoint - curPoint) * 0.04;
      curLink += (targetLink - curLink) * 0.04;
      pMat.uniforms.uOpacity.value = curPoint;
      lMat.uniforms.uOpacity.value = curLink;

      renderer.render(scene, camera);
    }

    function init() {
      try {
        W = window.innerWidth; H = window.innerHeight;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
        camera.position.set(0, 0, 15);

        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
        renderer.setPixelRatio(PIXEL_RATIO);
        renderer.setSize(W, H);
        renderer.setClearColor(0x000000, 0);

        var n = Math.max(60, Math.min(150, Math.floor((W * H) / 14000)));
        var pos = new Float32Array(n * 3);
        var col = new Float32Array(n * 3);
        var sizes = new Float32Array(n);
        baseCol = new Float32Array(n * 3);
        var cA = new THREE.Color(cssAccent), cB = new THREE.Color(cssViolet);
        for (var i = 0; i < n; i++) {
          particles.push({
            x: (Math.random() * 2 - 1) * 11,
            y: (Math.random() * 2 - 1) * 6,
            z: (Math.random() * 2 - 1) * 8 - 4,
            vx: (Math.random() * 2 - 1) * 0.006,
            vy: (Math.random() * 2 - 1) * 0.004,
            vz: (Math.random() * 2 - 1) * 0.004
          });
          pos[i * 3] = particles[i].x; pos[i * 3 + 1] = particles[i].y; pos[i * 3 + 2] = particles[i].z;
          col[i * 3] = cA.r; col[i * 3 + 1] = cA.g; col[i * 3 + 2] = cA.b;
          baseCol[i * 3] = cA.r; baseCol[i * 3 + 1] = cA.g; baseCol[i * 3 + 2] = cA.b;
          if (i % 2) {
            col[i * 3] = cB.r; col[i * 3 + 1] = cB.g; col[i * 3 + 2] = cB.b;
            baseCol[i * 3] = cB.r; baseCol[i * 3 + 1] = cB.g; baseCol[i * 3 + 2] = cB.b;
          }
          sizes[i] = BASE_SIZE;
        }
        pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        pGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        pMat = new THREE.ShaderMaterial({
          uniforms: {
            uPixelRatio: { value: PIXEL_RATIO },
            uOpacity: { value: 0 }
          },
          vertexShader: [
            "uniform float uPixelRatio;",
            "attribute float aSize;",
            "varying vec3 vColor;",
            "void main() {",
            "  vColor = color;",
            "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
            "  gl_PointSize = aSize * uPixelRatio;",
            "  gl_Position = projectionMatrix * mv;",
            "}"
          ].join("\n"),
          fragmentShader: [
            "varying vec3 vColor;",
            "uniform float uOpacity;",
            "void main() {",
            "  float d = distance(gl_PointCoord, vec2(0.5, 0.5));",
            "  float a = 1.0 - smoothstep(0.45, 0.5, d);",
            "  if (a < 0.02) discard;",
            "  gl_FragColor = vec4(vColor * uOpacity, 1.0);",
            "}"
          ].join("\n"),
          transparent: true,
          depthWrite: false,
          vertexColors: true
        });
        scene.add(new THREE.Points(pGeo, pMat));

        var maxLinks = Math.ceil((n * (n - 1)) / 2) + n;
        lGeo = new THREE.BufferGeometry();
        lGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxLinks * 6), 3));
        lGeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(maxLinks), 1));
        lMat = buildLineMaterial();
        scene.add(new THREE.LineSegments(lGeo, lMat));

        readAccent();
        onResize();
        window.addEventListener("resize", onResize);
        window.addEventListener("mousemove", onMouse, { passive: true });
        document.addEventListener("mouseleave", onMouseLeave);
        document.addEventListener("visibilitychange", onVis);
        loop();
        log("particle net ready", { n: n, w: W, h: H });
      } catch (e) {
        try { canvas.style.display = "none"; } catch (e2) {}
        log("init failed", e && e.message);
      }
    }

    state.onTeardown(function () {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVis);
      try { if (renderer) renderer.dispose(); } catch (e) {}
      try { if (pGeo) pGeo.dispose(); } catch (e) {}
      try { if (pMat) pMat.dispose(); } catch (e) {}
      try { if (lGeo) lGeo.dispose(); } catch (e) {}
      try { if (lMat) lMat.dispose(); } catch (e) {}
      try { canvas.remove(); } catch (e) {}
    });

    init();
  }

  loadThree(function (err) {
    if (err) {
      log("three load failed:", err.message);
      try { ocksin.toast("粒子特效加载失败: " + err.message); } catch (e) {}
      return;
    }
    start();
  });
})();
