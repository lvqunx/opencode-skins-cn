/*
 * opencode-skins :: music player add-on
 * Port of the H3 Studio web UI player (clay-blog style):
 *   - floating disc toggle (bottom-right) + expandable glass panel
 *   - sources: NetEase playlist via Meting API (same defaults as H3 Studio),
 *     or local files uploaded into skins/music/assets
 *   - shuffle / repeat-one / auto-skip broken tracks / MediaSession / persisted state
 * Loaded by bg-button.js; requires the installer's /__skins_upload__/ route for local files.
 */
(function () {
  "use strict";
  if (window.__ocskinMusic) return;
  window.__ocskinMusic = true;

  var LS_KEY = "ocskin_music_player";
  var DEFAULT_API = "https://meting.mikus.ink/api";
  var DEFAULT_PLAYLIST_ID = "466636631";
  var ROOT = new URL("__skins__", document.baseURI).href.replace(/\/+$/, "");
  var UPLOAD = new URL("__skins_upload__", document.baseURI).href.replace(/\/+$/, "");

  function log() {
    try { console.log.apply(console, ["%c[ocskin-music]", "color:#62d9ff;font-weight:bold"].concat([].slice.call(arguments))); } catch (e) {}
  }
  function whenBody(cb) {
    if (document.body) return cb();
    document.addEventListener("DOMContentLoaded", cb, { once: true });
  }
  function fetchText(url) {
    return fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }
  function postFile(relPath, body) {
    return fetch(UPLOAD + "/" + relPath, { method: "POST", body: body, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    var m = Math.floor(s / 60);
    return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  }
  function clean(v, fb) {
    var t = String(v || "").trim().replace(/\s+/g, " ");
    return (t || fb).slice(0, 180);
  }
  function safeName(n) {
    return String(n || "track").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
  }

  var CSS = [
    ".ocm{position:fixed;right:16px;bottom:48px;z-index:2147482900;font:12px/1.45 'Inter',system-ui,sans-serif;--ocm-accent:#37e6ff;}",
    ".ocm *{box-sizing:border-box;}",
    ".ocm-toggle{position:relative;width:52px;height:52px;border-radius:50%;cursor:pointer;display:grid;place-items:center;padding:0;border:none;",
    "background:rgba(20,20,28,.82);backdrop-filter:blur(10px);color:#d7f0ff;",
    "transition:transform .18s,color .18s;}",
    ".ocm-toggle:hover{transform:translateY(-2px);color:var(--ocm-accent);}",
    ".ocm.is-playing .ocm-toggle{color:var(--ocm-accent);}",
    ".ocm-disc{position:relative;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;overflow:hidden;color:rgba(215,240,255,.92);",
    "background:repeating-radial-gradient(circle,#2c3440 0 2px,#171d27 3px 4px);}",
    ".ocm-disc svg{width:18px;height:18px;position:relative;z-index:1;}",
    ".ocm.is-playing .ocm-disc{animation:ocm-spin 6s linear infinite;}",
    ".ocm-disc img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;}",
    "@keyframes ocm-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
    ".ocm-pulse{position:absolute;right:-1px;bottom:-1px;display:flex;align-items:flex-end;gap:1.5px;width:17px;height:17px;padding:3px 3.5px;border:2px solid rgba(10,12,16,.95);border-radius:50%;background:var(--ocm-accent);opacity:0;transform:scale(.72);transition:opacity .18s,transform .26s;z-index:3;}",
    ".ocm.is-playing .ocm-pulse{opacity:1;transform:scale(1);}",
    ".ocm-pulse i{width:2px;height:6px;background:rgba(8,19,28,.9);border-radius:99px;animation:ocm-eq .8s ease-in-out infinite;}",
    ".ocm-pulse i:nth-child(1){animation-delay:0s;}.ocm-pulse i:nth-child(2){animation-delay:.15s;}.ocm-pulse i:nth-child(3){animation-delay:.3s;}",
    "@keyframes ocm-eq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1.15)}}",
    ".ocm-panel{position:absolute;right:0;bottom:60px;width:318px;max-height:min(72vh,560px);display:flex;flex-direction:column;",
    "background:rgba(16,17,24,.92);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.14);border-radius:14px;color:#eef2f7;box-shadow:0 18px 48px rgba(0,0,0,.5);overflow:hidden;",
    "opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity .16s,transform .16s;}",
    ".ocm.is-open .ocm-panel{opacity:1;transform:none;pointer-events:auto;}",
    ".ocm-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);}",
    ".ocm-state{display:flex;align-items:center;gap:7px;color:#cfd8e3;min-width:0;}",
    ".ocm-state svg{width:14px;height:14px;color:var(--ocm-accent);flex:0 0 auto;}",
    ".ocm-state span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".ocm-actions{display:flex;gap:2px;}",
    ".ocm-btn{background:none;border:none;color:#aab6c4;cursor:pointer;width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;}",
    ".ocm-btn:hover{background:rgba(255,255,255,.09);color:#fff;}",
    ".ocm-btn svg{width:15px;height:15px;}",
    ".ocm-btn[aria-pressed='true']{color:var(--ocm-accent);}",
    ".ocm-now{display:flex;gap:11px;align-items:center;padding:12px 12px 6px;}",
    ".ocm-cover{width:64px;height:64px;border-radius:10px;background:linear-gradient(145deg,rgba(255,255,255,.10),rgba(255,255,255,.03));display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;border:1px solid rgba(255,255,255,.08);}",
    ".ocm-cover svg{width:26px;height:26px;color:var(--ocm-accent);opacity:.9;}",
    ".ocm-cover img{width:100%;height:100%;object-fit:cover;}",
    ".ocm-meta{min-width:0;}",
    ".ocm-meta strong{display:block;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;}",
    ".ocm-meta span{display:block;font-size:11px;color:#93a2b3;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;}",
    ".ocm-timeline{padding:4px 12px 2px;}",
    ".ocm-timeline input{width:100%;-webkit-appearance:none;height:4px;border-radius:2px;background:linear-gradient(to right,var(--ocm-accent) var(--ocm-progress,0%),rgba(255,255,255,.14) var(--ocm-progress,0%));outline:none;cursor:pointer;}",
    ".ocm-timeline input:disabled{opacity:.5;cursor:default;}",
    ".ocm-timeline input::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);}",
    ".ocm-time{display:flex;justify-content:space-between;font-size:10px;color:#8794a5;margin-top:3px;}",
    ".ocm-controls{display:flex;align-items:center;justify-content:center;gap:10px;padding:6px 12px 10px;}",
    ".ocm-play{width:38px;height:38px;border-radius:50%;background:var(--ocm-accent);color:#08131c;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);}",
    ".ocm-play svg{width:17px;height:17px;}",
    ".ocm-play:hover{filter:brightness(1.1);}",
    ".ocm-qhead{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-top:1px solid rgba(255,255,255,.08);color:#b9c4d1;font-size:11px;}",
    ".ocm-qhead small{color:#7d8a9b;margin-right:4px;}",
    ".ocm-settings{padding:0 12px 10px;display:flex;flex-direction:column;gap:6px;}",
    ".ocm-settings input[type=text]{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef2f7;font:11px 'Inter',system-ui;padding:6px 8px;outline:none;}",
    ".ocm-settings input[type=text]:focus{border-color:var(--ocm-accent);}",
    ".ocm-srow{display:flex;gap:6px;flex-wrap:wrap;}",
    ".ocm-mini{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#dfe7f0;font:11px 'Inter',system-ui;border-radius:8px;padding:5px 9px;cursor:pointer;}",
    ".ocm-mini:hover{border-color:var(--ocm-accent);color:#fff;}",
    ".ocm-settings small{color:#8b98a8;font-size:10px;min-height:12px;}",
    ".ocm-queue{list-style:none;margin:0;padding:0 6px 8px;overflow-y:auto;flex:1 1 auto;min-height:60px;}",
    ".ocm-queue::-webkit-scrollbar{width:8px;}",
    ".ocm-queue::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px;}",
    ".ocm-queue li{margin:2px 0;}",
    ".ocm-track{width:100%;display:flex;align-items:center;gap:9px;padding:7px 8px;background:none;border:none;border-radius:9px;cursor:pointer;color:#cdd7e2;text-align:left;font:inherit;}",
    ".ocm-track:hover{background:rgba(255,255,255,.07);}",
    ".ocm-track[aria-current='true']{background:rgba(255,255,255,.10);color:#fff;}",
    ".ocm-track[aria-current='true'] strong{color:var(--ocm-accent);}",
    ".ocm-num{width:22px;flex:0 0 auto;text-align:center;font-size:10px;color:#7d8a9b;}",
    ".ocm-tart{width:26px;height:26px;border-radius:6px;object-fit:cover;flex:0 0 auto;}",
    ".ocm-copy{min-width:0;flex:1;}",
    ".ocm-copy strong{display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;}",
    ".ocm-copy small{display:block;font-size:10px;color:#8794a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;}",
    ".ocm-del{flex:0 0 auto;background:none;border:none;color:#6c7889;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px;display:none;}",
    ".ocm-track:hover .ocm-del{display:block;}",
    ".ocm-del:hover{color:#ff6b81;background:rgba(255,107,129,.1);}",
    ".ocm-empty{padding:14px;text-align:center;color:#7d8a9b;font-size:11px;}"
  ].join("");

  function build() {
    var style = document.createElement("style");
    style.id = "ocm-style";
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = document.createElement("div");
    root.className = "ocm";
    root.id = "ocm-root";
    root.innerHTML =
      '<button class="ocm-toggle" data-ocm-toggle type="button" title="音乐" aria-label="打开音乐播放器">' +
        '<span class="ocm-disc">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
          '<img data-ocm-dock alt="" hidden>' +
        '</span>' +
        '<span class="ocm-pulse"><i></i><i></i><i></i></span>' +
      '</button>' +
      '<section class="ocm-panel" data-ocm-panel aria-label="音乐播放器" aria-hidden="true" inert>' +
        '<header class="ocm-head">' +
          '<div class="ocm-state">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2l2-5 3 10 3-14 3 9h3"/></svg>' +
            '<span data-ocm-status>准备就绪</span>' +
          '</div>' +
          '<div class="ocm-actions">' +
            '<button class="ocm-btn" data-ocm-mute type="button" title="静音" aria-label="静音">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' +
            '</button>' +
            '<button class="ocm-btn" data-ocm-close type="button" title="收起" aria-label="收起">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<div class="ocm-now">' +
          '<div class="ocm-cover">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
            '<img data-ocm-cover alt="" hidden>' +
          '</div>' +
          '<div class="ocm-meta"><strong data-ocm-title>未播放</strong><span data-ocm-artist>网易云歌单 / 本地音乐</span></div>' +
        '</div>' +
        '<div class="ocm-timeline">' +
          '<input type="range" min="0" max="1000" value="0" step="1" data-ocm-progress aria-label="播放进度" disabled>' +
          '<div class="ocm-time"><span data-ocm-cur>0:00</span><span data-ocm-dur>0:00</span></div>' +
        '</div>' +
        '<div class="ocm-controls">' +
          '<button class="ocm-btn" data-ocm-shuffle type="button" title="随机播放" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg></button>' +
          '<button class="ocm-btn" data-ocm-prev type="button" title="上一首"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><path d="M19 5v14L8 12l11-7z"/></svg></button>' +
          '<button class="ocm-play" data-ocm-play type="button" title="播放" aria-label="播放"><svg data-ocm-icon-play viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg><svg data-ocm-icon-pause viewBox="0 0 24 24" fill="currentColor" hidden><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></button>' +
          '<button class="ocm-btn" data-ocm-next type="button" title="下一首"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14"/><path d="M5 5v14l11-7L5 5z"/></svg></button>' +
          '<button class="ocm-btn" data-ocm-repeat type="button" title="单曲循环" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button>' +
        '</div>' +
        '<div class="ocm-qhead"><span>播放列表</span><span><small data-ocm-count>0 首</small>' +
          '<button class="ocm-btn" data-ocm-settings type="button" title="歌单设置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></span></div>' +
        '<div class="ocm-settings" hidden>' +
          '<input type="text" data-ocm-playlist-input placeholder="网易云歌单 ID（默认 466636631）" spellcheck="false">' +
          '<input type="text" data-ocm-api-input placeholder="Meting API 地址（留空 = 默认）" spellcheck="false">' +
          '<div class="ocm-srow">' +
            '<button class="ocm-mini" data-ocm-save type="button">加载网易云歌单</button>' +
            '<button class="ocm-mini" data-ocm-local type="button">使用本地音乐</button>' +
            '<button class="ocm-mini" data-ocm-add type="button">添加本地音乐</button>' +
          '</div>' +
          '<small data-ocm-settings-status></small>' +
        '</div>' +
        '<ol class="ocm-queue" data-ocm-list></ol>' +
      '</section>' +
      '<audio data-ocm-audio preload="none"></audio>' +
      '<input type="file" data-ocm-file accept="audio/*" multiple hidden>';
    document.body.appendChild(root);
    return root;
  }

  function init() {
    var root = build();
    var $ = function (sel) { return root.querySelector(sel); };
    var toggle = $("[data-ocm-toggle]"), panel = $("[data-ocm-panel]"), closeBtn = $("[data-ocm-close]");
    var audio = $("[data-ocm-audio]"), fileInput = $("[data-ocm-file]");
    var playBtn = $("[data-ocm-play]"), prevBtn = $("[data-ocm-prev]"), nextBtn = $("[data-ocm-next]");
    var muteBtn = $("[data-ocm-mute]"), shuffleBtn = $("[data-ocm-shuffle]"), repeatBtn = $("[data-ocm-repeat]");
    var progress = $("[data-ocm-progress]"), curTime = $("[data-ocm-cur]"), durTime = $("[data-ocm-dur]");
    var titleEl = $("[data-ocm-title]"), artistEl = $("[data-ocm-artist]"), statusEl = $("[data-ocm-status]");
    var countEl = $("[data-ocm-count]"), listEl = $("[data-ocm-list]");
    var coverEl = $("[data-ocm-cover]"), dockCover = $("[data-ocm-dock]");
    var iconPlay = $("[data-ocm-icon-play]"), iconPause = $("[data-ocm-icon-pause]");
    var settingsBtn = $("[data-ocm-settings]");
    var setPanel = root.querySelector(".ocm-settings");
    var playlistInput = $("[data-ocm-playlist-input]"), apiInput = $("[data-ocm-api-input]");
    var saveBtn = $("[data-ocm-save]"), localBtn = $("[data-ocm-local]"), addBtn = $("[data-ocm-add]");
    var settingsStatus = $("[data-ocm-settings-status]");

    var tracks = [];
    var currentIndex = 0, loadedIndex = -1;
    var wantsPlayback = false, playGeneration = 0, skipScheduled = false, skipTimer = 0;
    var failedTracks = {};
    var remotePlaylistId = "", remoteApiBase = DEFAULT_API, mode = "remote";
    var localTracks = [];

    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) {}
    var shuffleEnabled = !!saved.shuffle, repeatOne = !!saved.repeatOne;
    audio.volume = isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.72;
    audio.muted = !!saved.muted;
    audio.loop = repeatOne;
    root.classList.toggle("is-muted", audio.muted);
    shuffleBtn.setAttribute("aria-pressed", String(shuffleEnabled));
    repeatBtn.setAttribute("aria-pressed", String(repeatOne));

    function persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          index: currentIndex, volume: audio.volume, muted: audio.muted, shuffle: shuffleEnabled,
          repeatOne: repeatOne, playlistId: remotePlaylistId,
          apiBase: remoteApiBase === DEFAULT_API ? "" : remoteApiBase, mode: mode
        }));
      } catch (e) {}
    }
    function setStatus(m) { statusEl.textContent = m; }
    function setAccent() {
      try {
        var v = window.ocskin && window.ocskin.getVar ? window.ocskin.getVar("--color-v2-text-text-accent") : "";
        root.style.setProperty("--ocm-accent", (v && v.trim()) || "#37e6ff");
      } catch (e) {}
    }
    function setOpen(open) {
      root.classList.toggle("is-open", open);
      panel.setAttribute("aria-hidden", String(!open));
      if (open) panel.removeAttribute("inert"); else panel.setAttribute("inert", "");
      toggle.setAttribute("aria-expanded", String(open));
    }

    function updateCover(imgEl, src) {
      if (!imgEl) return;
      if (!src) { imgEl.hidden = true; imgEl.removeAttribute("src"); return; }
      imgEl.hidden = false; imgEl.src = src;
    }
    coverEl.addEventListener("error", function () { coverEl.hidden = true; });
    dockCover.addEventListener("error", function () { dockCover.hidden = true; });

    function updateMediaSession(track) {
      if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title, artist: track.artist, album: "OpenCode Desktop",
          artwork: track.cover ? [{ src: track.cover, sizes: "300x300" }] : []
        });
      } catch (e) {}
    }

    function showTrack(index) {
      if (!tracks.length) {
        titleEl.textContent = "未播放"; artistEl.textContent = "列表为空";
        updateCover(coverEl, ""); updateCover(dockCover, "");
        countEl.textContent = "0 首";
        return;
      }
      currentIndex = ((index % tracks.length) + tracks.length) % tracks.length;
      var t = tracks[currentIndex];
      titleEl.textContent = t.title; artistEl.textContent = t.artist;
      updateCover(coverEl, t.cover); updateCover(dockCover, t.cover);
      listEl.querySelectorAll("[data-ocm-track]").forEach(function (b) {
        b.setAttribute("aria-current", String(Number(b.dataset.ocmTrack) === currentIndex));
      });
      countEl.textContent = (currentIndex + 1) + "/" + tracks.length;
      updateMediaSession(t);
      persist();
    }

    function resetTimeline() {
      progress.value = "0";
      progress.style.setProperty("--ocm-progress", "0%");
      progress.disabled = true;
      curTime.textContent = "0:00"; durTime.textContent = "0:00";
    }

    function loadCurrentAudio() {
      if (!tracks.length) return false;
      if (loadedIndex === currentIndex && audio.src) return true;
      loadedIndex = currentIndex;
      resetTimeline();
      audio.src = tracks[currentIndex].url;
      audio.load();
      return true;
    }

    function scheduleSkip() {
      if (skipScheduled || !wantsPlayback || !tracks.length) return;
      skipScheduled = true;
      failedTracks[currentIndex] = 1;
      root.classList.remove("is-playing", "is-loading");
      if (Object.keys(failedTracks).length >= tracks.length) {
        wantsPlayback = false; setStatus("所有曲目暂时都无法播放"); skipScheduled = false; return;
      }
      var next = currentIndex;
      do { next = (next + 1) % tracks.length; } while (failedTracks[next] && next !== currentIndex);
      setStatus("这首暂不可播，已切换下一首");
      skipTimer = window.setTimeout(function () { skipTimer = 0; skipScheduled = false; selectTrack(next, true, false); }, 420);
    }

    function playCurrent() {
      if (!loadCurrentAudio()) return;
      var generation = ++playGeneration;
      wantsPlayback = true;
      root.classList.add("is-loading");
      setStatus("正在缓冲…");
      audio.play().catch(function (error) {
        if (generation !== playGeneration || (error && error.name === "AbortError")) return;
        root.classList.remove("is-loading");
        if (error && error.name === "NotAllowedError") { wantsPlayback = false; setStatus("点击播放继续"); return; }
        scheduleSkip();
      });
    }

    function selectTrack(index, shouldPlay, userInitiated) {
      if (!tracks.length) return;
      if (userInitiated !== false && skipTimer) { window.clearTimeout(skipTimer); skipTimer = 0; skipScheduled = false; }
      if (userInitiated !== false) delete failedTracks[((index % tracks.length) + tracks.length) % tracks.length];
      var changed = currentIndex !== ((index % tracks.length) + tracks.length) % tracks.length;
      if (changed) {
        playGeneration += 1;
        if (!audio.paused) audio.pause();
      }
      showTrack(index);
      if (changed) { loadedIndex = -1; audio.removeAttribute("src"); audio.load(); resetTimeline(); }
      if (shouldPlay) playCurrent(); else setStatus("准备就绪");
    }

    function adjacentIndex(dir) {
      if (!shuffleEnabled || tracks.length < 2) return currentIndex + dir;
      var candidate = currentIndex;
      for (var i = 0; i < tracks.length * 2 && candidate === currentIndex; i++) candidate = Math.floor(Math.random() * tracks.length);
      return candidate === currentIndex ? currentIndex + dir : candidate;
    }

    function renderTracks() {
      listEl.replaceChildren();
      if (!tracks.length) {
        var li = document.createElement("li");
        li.className = "ocm-empty";
        li.textContent = "列表为空 — 点 ⚙ 加载网易云歌单或添加本地音乐";
        listEl.appendChild(li);
        return;
      }
      var frag = document.createDocumentFragment();
      tracks.forEach(function (track, index) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button"; btn.className = "ocm-track"; btn.dataset.ocmTrack = String(index);
        btn.setAttribute("aria-current", String(index === currentIndex));
        var num = document.createElement("span"); num.className = "ocm-num"; num.textContent = String(index + 1).padStart(2, "0");
        var art;
        if (track.cover) { art = document.createElement("img"); art.className = "ocm-tart"; art.src = track.cover; art.alt = ""; art.loading = "lazy"; }
        else { art = document.createElement("span"); art.className = "ocm-num"; art.textContent = "♪"; }
        var copy = document.createElement("span"); copy.className = "ocm-copy";
        var st = document.createElement("strong"); st.textContent = clean(track.title, "未知曲目");
        var sa = document.createElement("small"); sa.textContent = clean(track.artist, "未知艺术家");
        copy.append(st, sa);
        var del = document.createElement("button");
        del.className = "ocm-del"; del.type = "button"; del.title = "从本地列表移除"; del.textContent = "✕";
        del.addEventListener("click", function (ev) {
          ev.stopPropagation();
          localTracks.splice(index, 1);
          persistLocal();
          if (mode === "local") { applyTracks(localTracks.length ? localTracks.slice() : []); }
          else renderTracks();
        });
        btn.append(num, art, copy, del);
        btn.addEventListener("click", function () { selectTrack(index, true, true); });
        li.appendChild(btn); frag.appendChild(li);
      });
      listEl.appendChild(frag);
    }

    function applyTracks(newTracks) {
      tracks = (newTracks || []).slice();
      currentIndex = 0; loadedIndex = -1; failedTracks = {};
      playGeneration += 1;
      if (!audio.paused) audio.pause();
      audio.removeAttribute("src"); audio.load(); resetTimeline();
      renderTracks(); showTrack(currentIndex);
      if (!tracks.length) setStatus("列表为空");
    }

    /* ---------------- local playlist (skins/music) ---------------- */
    function localURL(fileName) { return ROOT + "/skins/music/assets/" + encodeURIComponent(fileName); }
    function loadLocalPlaylist() {
      return fetchText(ROOT + "/skins/music/playlist.json").then(function (txt) {
        var arr = JSON.parse(txt);
        if (!Array.isArray(arr)) arr = [];
        localTracks = arr.filter(function (t) { return t && t.url; }).map(function (t) {
          var url = t.url;
          if (url.indexOf("assets/") === 0) url = localURL(url.slice(7));
          return { title: t.title || "本地音乐", artist: t.artist || "本地音乐", cover: t.cover || "", url: url, local: true };
        });
        return localTracks;
      }).catch(function () { localTracks = []; return localTracks; });
    }
    function persistLocal() {
      var data = localTracks.map(function (t) {
        var url = t.url;
        var prefix = ROOT + "/skins/music/assets/";
        if (url.indexOf(prefix) === 0) url = "assets/" + decodeURIComponent(url.slice(prefix.length));
        return { title: t.title, artist: t.artist, url: url };
      });
      return postFile("skins/music/playlist.json", JSON.stringify(data, null, 2)).catch(function (e) {
        log("save playlist failed", e.message);
      });
    }
    function useLocal() {
      mode = "local"; persist();
      return loadLocalPlaylist().then(function (list) {
        applyTracks(list);
        if (list.length) { setStatus("本地音乐 · " + list.length + " 首"); settingsStatus.textContent = "已切换到本地音乐"; }
        else { setStatus("本地列表为空，点“添加本地音乐”"); settingsStatus.textContent = "本地列表为空"; }
      });
    }
    addBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = "";
      if (!files.length) return;
      settingsStatus.textContent = "正在导入 " + files.length + " 个文件…";
      var done = 0;
      var chain = Promise.resolve();
      files.forEach(function (f) {
        var dest = "skins/music/assets/" + Date.now() + "-" + safeName(f.name);
        chain = chain.then(function () {
          return postFile(dest, f).then(function () {
            localTracks.push({ title: f.name.replace(/\.[^.]+$/, ""), artist: "本地音乐", cover: "", url: localURL(dest.split("/").pop()), local: true });
            done++;
          }).catch(function (e) { log("upload failed", f.name, e.message); });
        });
      });
      chain.then(function () {
        return persistLocal();
      }).then(function () {
        settingsStatus.textContent = "已导入 " + done + " 首";
        try { window.ocskin && window.ocskin.toast && window.ocskin.toast("已导入 " + done + " 首本地音乐"); } catch (e) {}
        mode = "local"; persist();
        applyTracks(localTracks.slice());
        setStatus("本地音乐 · " + localTracks.length + " 首");
      });
    });

    /* ---------------- remote playlist (NetEase via Meting) ---------------- */
    function loadRemotePlaylist(id, apiBase) {
      if (!id) return Promise.resolve(false);
      setStatus("正在连接网易云歌单…");
      countEl.textContent = "加载中";
      listEl.innerHTML = '<li class="ocm-empty">正在从网易云读取歌单…</li>';
      var controller = new AbortController();
      var timer = window.setTimeout(function () { controller.abort(); }, 12000);
      var endpoint = new URL(apiBase, window.location.href);
      endpoint.searchParams.set("server", "netease");
      endpoint.searchParams.set("type", "playlist");
      endpoint.searchParams.set("id", id);
      return fetch(endpoint, { signal: controller.signal, mode: "cors", credentials: "omit", headers: { Accept: "application/json" } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          if (!Array.isArray(data) || !data.length) throw new Error("歌单为空");
          var list = data.slice(0, 250).map(function (item) {
            var cover = "";
            var url = "";
            try { cover = new URL(item.pic || item.cover || "", window.location.href).toString(); } catch (e) {}
            try {
              var u = new URL(item.url || item.src || "", window.location.href);
              if (u.protocol === "http:" && window.location.protocol === "https:") u.protocol = "https:";
              url = u.toString();
            } catch (e) {}
            return {
              title: clean(item.title || item.name, "未知歌曲"),
              artist: clean(item.author || item.artist, "未知歌手"),
              cover: cover, url: url
            };
          }).filter(function (t) { return t.url; });
          if (!list.length) throw new Error("没有可播放的曲目");
          mode = "remote"; persist();
          applyTracks(list);
          setStatus("网易云歌单 · " + list.length + " 首");
          settingsStatus.textContent = "已加载网易云歌单";
          return true;
        })
        .catch(function (error) {
          var reason = (error && error.name === "AbortError") ? "连接超时" : "歌单暂时无法加载";
          setStatus(reason);
          settingsStatus.textContent = reason + "，可换 API 地址/歌单 ID，或使用本地音乐";
          return loadLocalPlaylist().then(function (list) {
            if (list.length) { mode = "local"; persist(); applyTracks(list); setStatus("已改用本地音乐 · " + list.length + " 首"); return false; }
            applyTracks([]);
            return false;
          });
        })
        .finally(function () { window.clearTimeout(timer); });
    }

    /* ---------------- wiring ---------------- */
    toggle.addEventListener("click", function () { setOpen(!root.classList.contains("is-open")); });
    closeBtn.addEventListener("click", function () { setOpen(false); toggle.focus(); });
    document.addEventListener("pointerdown", function (ev) {
      if (root.classList.contains("is-open") && !root.contains(ev.target)) setOpen(false);
    }, true);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && root.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });

    playBtn.addEventListener("click", function () {
      if (!tracks.length) { setStatus("列表为空 — 点 ⚙ 加载歌单或添加本地音乐"); return; }
      if (audio.paused) playCurrent();
      else { playGeneration += 1; wantsPlayback = false; audio.pause(); }
    });
    prevBtn.addEventListener("click", function () { selectTrack(adjacentIndex(-1), wantsPlayback && !audio.paused); });
    nextBtn.addEventListener("click", function () { selectTrack(adjacentIndex(1), wantsPlayback && !audio.paused); });
    muteBtn.addEventListener("click", function () { audio.muted = !audio.muted; });
    shuffleBtn.addEventListener("click", function () {
      shuffleEnabled = !shuffleEnabled;
      shuffleBtn.setAttribute("aria-pressed", String(shuffleEnabled)); persist();
    });
    repeatBtn.addEventListener("click", function () {
      repeatOne = !repeatOne; audio.loop = repeatOne;
      repeatBtn.setAttribute("aria-pressed", String(repeatOne)); persist();
    });

    progress.addEventListener("input", function () {
      if (!isFinite(audio.duration) || audio.duration <= 0) return;
      var ratio = Number(progress.value) / 1000;
      progress.style.setProperty("--ocm-progress", (ratio * 100) + "%");
      audio.currentTime = ratio * audio.duration;
    });

    audio.addEventListener("playing", function () {
      wantsPlayback = true;
      root.classList.remove("is-loading"); root.classList.add("is-playing");
      iconPlay.setAttribute("hidden", ""); iconPause.removeAttribute("hidden");
      setStatus("正在播放");
    });
    audio.addEventListener("pause", function () {
      root.classList.remove("is-playing", "is-loading");
      iconPlay.removeAttribute("hidden"); iconPause.setAttribute("hidden", "");
      if (!wantsPlayback && audio.currentTime > 0 && !audio.ended) setStatus("已暂停");
    });
    audio.addEventListener("waiting", function () { if (wantsPlayback) { root.classList.add("is-loading"); setStatus("缓冲中…"); } });
    audio.addEventListener("loadedmetadata", function () {
      progress.disabled = !isFinite(audio.duration);
      durTime.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("timeupdate", function () {
      if (isFinite(audio.duration) && audio.duration > 0) {
        var ratio = audio.currentTime / audio.duration;
        progress.value = String(Math.round(ratio * 1000));
        progress.style.setProperty("--ocm-progress", (ratio * 100) + "%");
        curTime.textContent = fmtTime(audio.currentTime);
        durTime.textContent = fmtTime(audio.duration);
      }
    });
    audio.addEventListener("ended", function () { selectTrack(repeatOne ? currentIndex : adjacentIndex(1), true, false); });
    audio.addEventListener("error", scheduleSkip);
    audio.addEventListener("volumechange", function () { persist(); });

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", function () { playCurrent(); });
        navigator.mediaSession.setActionHandler("pause", function () { playGeneration += 1; wantsPlayback = false; audio.pause(); });
        navigator.mediaSession.setActionHandler("previoustrack", function () { selectTrack(adjacentIndex(-1), true); });
        navigator.mediaSession.setActionHandler("nexttrack", function () { selectTrack(adjacentIndex(1), true); });
      } catch (e) {}
    }

    settingsBtn.addEventListener("click", function () {
      var open = setPanel.hidden;
      setPanel.hidden = !open;
      settingsBtn.setAttribute("aria-pressed", String(open));
      if (open) {
        playlistInput.value = remotePlaylistId;
        apiInput.value = remoteApiBase === DEFAULT_API ? "" : remoteApiBase;
        playlistInput.focus();
      }
    });
    saveBtn.addEventListener("click", function () {
      var id = String(playlistInput.value || "").trim() || DEFAULT_PLAYLIST_ID;
      var api = String(apiInput.value || "").trim() || DEFAULT_API;
      remotePlaylistId = id; remoteApiBase = api; persist();
      loadRemotePlaylist(id, api);
    });
    localBtn.addEventListener("click", function () { useLocal(); });

    /* ---------------- boot ---------------- */
    remotePlaylistId = String(saved.playlistId || "").trim() || DEFAULT_PLAYLIST_ID;
    remoteApiBase = String(saved.apiBase || "").trim() || DEFAULT_API;
    mode = saved.mode === "local" ? "local" : "remote";

    if (window.ocskin && window.ocskin.on) {
      try { window.ocskin.on("applied", setAccent); } catch (e) {}
    }

    if (mode === "local") {
      loadLocalPlaylist().then(function (list) {
        applyTracks(list);
        setStatus(list.length ? "本地音乐 · " + list.length + " 首" : "本地列表为空");
      });
    } else {
      loadRemotePlaylist(remotePlaylistId, remoteApiBase);
    }
    setAccent();
    log("music player ready");
  }

  whenBody(init);
})();
