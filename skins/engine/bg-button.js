/*
 * opencode-skins background button (add-on module)
 * Adds a floating button that lets you pick a local image and sets it as the
 * desktop background (creates/updates the "imagebg" skin on first use).
 *
 * Requires the installer's /__skins_upload__/ protocol route (install.mjs patch).
 * Disable with "bgButton": false in active.json.
 */
(function () {
  "use strict";
  if (window.__ocskinBgButton) return;
  window.__ocskinBgButton = true;

  var SKINS_ROOT = new URL("__skins__", document.baseURI).href.replace(/\/+$/, "");
  var UPLOAD_ROOT = new URL("__skins_upload__", document.baseURI).href.replace(/\/+$/, "");
  var SKIN_NAME = "imagebg";
  var MAX_BYTES = 25 * 1024 * 1024;

  function log() {
    try {
      console.log.apply(console, ["%c[ocskin-bg]", "color:#7c5cff;font-weight:bold"].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  function fetchText(url) {
    return fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.text();
    });
  }

  function postFile(relPath, body) {
    return fetch(UPLOAD_ROOT + "/" + relPath, { method: "POST", body: body, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + relPath);
      return r.text();
    });
  }

  function extFor(file) {
    var byMime = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    if (byMime[file.type]) return byMime[file.type];
    var m = /\.([a-z0-9]+)$/i.exec(file.name || "");
    return m ? m[1].toLowerCase() : "png";
  }

  function validateImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("无法识别的图片格式")); };
      img.src = url;
    });
  }

  function setBackground(file, api) {
    if (!/^image\//.test(file.type || "")) return Promise.reject(new Error("不是图片文件"));
    if (file.size > MAX_BYTES) return Promise.reject(new Error("图片太大（超过 25MB）"));
    var ext = extFor(file);
    var rel = "skins/" + SKIN_NAME + "/assets/bg." + ext;
    api.toast("正在设置背景图片…");
    return validateImage(file)
      .then(function () { return postFile(rel, file); })
      .then(function () {
        return fetchText(SKINS_ROOT + "/skins/" + SKIN_NAME + "/skin.json")
          .then(function (t) { return JSON.parse(t); })
          .catch(function () { return null; });
      })
      .then(function (manifest) {
        manifest = manifest || {};
        manifest.name = manifest.name || SKIN_NAME;
        manifest.title = manifest.title || "图片背景";
        manifest.base = manifest.base || "dark";
        manifest.css = manifest.css || "../_lib/transparent.css";
        var bg = manifest.background || {};
        bg.type = "image";
        bg.src = "assets/bg." + ext + "?v=" + Date.now();
        if (bg.opacity == null) bg.opacity = 1;
        if (bg.blur == null) bg.blur = 0;
        if (bg.brightness == null) bg.brightness = 1;
        if (bg.saturate == null) bg.saturate = 1.05;
        if (bg.surfaceAlpha == null) bg.surfaceAlpha = 0;
        manifest.background = bg;
        return postFile("skins/" + SKIN_NAME + "/skin.json", JSON.stringify(manifest, null, 2));
      })
      .then(function () {
        return api.list().then(function (list) {
          list = Array.isArray(list) ? list.slice() : [];
          if (list.indexOf(SKIN_NAME) < 0) {
            list.push(SKIN_NAME);
            return postFile("skins/index.json", JSON.stringify(list, null, 2));
          }
        }).catch(function () {});
      })
      .then(function () {
        return api.apply(SKIN_NAME);
      })
      .then(function () {
        api.toast("背景已更新");
        log("background updated:", rel);
      })
      .catch(function (e) {
        api.toast("设置失败：" + (e && e.message ? e.message : e));
        log("error", e);
      });
  }

  function mount(api) {
    if (api.config && api.config.bgButton === false) return;
    if (document.getElementById("ocskin-bg-button")) return;

    var btn = document.createElement("button");
    btn.id = "ocskin-bg-button";
    btn.type = "button";
    btn.title = "设置背景图片（点击选择图片）";
    btn.setAttribute("aria-label", "设置背景图片");
    var accent = "#37e6ff";
    try { accent = (api.getVar && api.getVar("--color-v2-text-text-accent")) || accent; } catch (e) {}
    btn.style.cssText = [
      "position:fixed", "right:78px", "bottom:48px", "z-index:2147483000",
      "width:52px", "height:52px", "border-radius:50%", "cursor:pointer", "padding:0",
      "display:flex", "align-items:center", "justify-content:center",
      "background:rgba(20,20,28,.82)", "backdrop-filter:blur(10px)",
      "border:1px solid rgba(255,255,255,.18)", "color:#dff3ff",
      "transition:transform .18s ease, border-color .18s ease, color .18s ease"
    ].join(";");
    btn.innerHTML = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>';
    btn.addEventListener("mouseenter", function () {
      btn.style.transform = "translateY(-2px)";
      btn.style.borderColor = accent;
      btn.style.color = accent;
    });
    btn.addEventListener("mouseleave", function () {
      btn.style.transform = "none";
      btn.style.borderColor = "rgba(255,255,255,.18)";
      btn.style.color = "#dff3ff";
    });
    if (api.on) {
      try { api.on("applied", function () { try { accent = api.getVar("--color-v2-text-text-accent") || "#37e6ff"; } catch (e) {} }); } catch (e) {}
    }

    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
    input.style.display = "none";
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      input.value = "";
      if (f) setBackground(f, api);
    });

    btn.addEventListener("click", function () {
      input.click();
    });

    document.body.appendChild(btn);
    document.body.appendChild(input);
    log("background button ready");
  }

  function whenBody(cb) {
    if (document.body) return cb();
    document.addEventListener("DOMContentLoaded", cb, { once: true });
  }

  var tries = 0;
  (function wait() {
    if (window.ocskin && window.ocskin.version) {
      return whenBody(function () { mount(window.ocskin); });
    }
    if (++tries > 200) return;
    setTimeout(wait, 100);
  })();

  
  // load sibling add-ons (music player)
  try {
    var extra = document.createElement("script");
    extra.src = new URL("__skins__/engine/music-player.js", document.baseURI).href + "?v=" + Date.now();
    document.head.appendChild(extra);
  } catch (e) {}

  // enforce the active skin's color scheme + native window-control colors.
  // The app re-applies its own theme shortly after startup, flipping
  // data-color-scheme back (and painting black window buttons over dark skins).
  try {
    var lastTb = "";
    var enforceScheme = function () {
      var base = "";
      try {
        var api = window.ocskin;
        var m = api && api.manifest ? api.manifest() : null;
        if (api && api.current && api.current() && m && (m.base === "dark" || m.base === "light")) base = m.base;
      } catch (e4) {}
      if (!base) return;
      var root = document.documentElement;
      if (root.dataset.colorScheme !== base) root.dataset.colorScheme = base;
      if (root.style.colorScheme !== base) root.style.colorScheme = base;
      if (base !== lastTb) {
        lastTb = base;
        try { console.log("%c[ocskin-tb]", "color:#37e6ff;font-weight:bold", "enforce", base); } catch (e3) {}
      }
      try {
        if (window.api && window.api.setTitlebar) window.api.setTitlebar({ mode: base, scheme: base });
      } catch (e2) {}
    };
    new MutationObserver(enforceScheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] });
    enforceScheme();
    setTimeout(enforceScheme, 500);
    setTimeout(enforceScheme, 1500);
    setTimeout(enforceScheme, 4000);
    setInterval(enforceScheme, 5000);
    if (window.ocskin && window.ocskin.on) {
      try { window.ocskin.on("applied", function () { setTimeout(enforceScheme, 60); }); } catch (e5) {}
    }
  } catch (e) {}
})();
