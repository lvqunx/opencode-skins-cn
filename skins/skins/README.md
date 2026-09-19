# Authoring skins

A skin is a folder under `skins/<name>/` with a `skin.json`. Add its name to
`skins/index.json` (and/or `active.json`'s `skins` array) so it shows up in the
cycle list. Set the default in `active.json` → `active`.

`active.json` also holds engine options:

```jsonc
{
  "active": "spirited-away",   // default skin (localStorage overrides at runtime)
  "hotkeys": true,             // Ctrl+Alt+S/R/0 shortcuts
  "hotReload": true,           // re-apply on skin.json save (~1.5s)
  "pet": true,                 // load the code pet overlay (or a config object)
  "skins": ["...", "..."]     // skins shown in the cycle list
}
```

```
skins/
  index.json          ["aurora","mesh","glass","video","oled","mytheme"]
  mytheme/
    skin.json
    mytheme.css       (optional)
    mytheme.js        (optional)
    assets/clip.mp4   (optional)
```

## `skin.json`

```jsonc
{
  "name": "mytheme",
  "title": "My Theme",
  "description": "…",
  "base": "dark",                 // "dark" | "light" — sets color-scheme

  "vars": {                        // CSS custom properties, applied with !important
    "--color-v2-background-bg-accent": "#ff5c8a",
    "--color-v2-text-text-base": "#f0eefb"
  },

  "cssText": ":root{}",           // optional inline CSS
  "css": "mytheme.css",           // optional CSS file (served over the protocol)

  "background": {                  // optional dynamic layer behind the whole UI
    "type": "video",              // "video" | "image" | "shader" | "gradient" | "none"
    "src": "assets/clip.mp4",     // video/image (relative to the skin folder)
    "shader": "aurora",           // for type:shader — aurora | mesh | waves | stars
    "gradient": "linear-gradient(...)", // for type:gradient
    "colors": [265, 190, 330],    // shader hues (degrees)
    "fallback": "aurora",         // shader/gradient to use if a video fails to load
    "opacity": 0.5,
    "blur": 2, "brightness": 0.7, "saturate": 1.1,
    "loop": true, "fit": "cover", "playbackRate": 1,
    "surfaceAlpha": 0.6,          // 0..1 — how opaque app panels sit over the bg
    "revealSurfaces": true,       // false = don't auto-translucify panels

    "glass": true,                // frosted-glass panels instead of a flat tint:
                                  //   panels go ~transparent and blur what's behind
                                  //   them (found by matching the app's surface-token
                                  //   colors, so it survives hashed class names).
    "glassBlur": 20,              // backdrop blur radius in px  (glass mode only)
    "glassTint": 0.08,            // residual panel fill alpha, 0 = pure glass
    "glassSaturate": 1.2          // backdrop saturation           (glass mode only)
  },

  "patches": [                     // declarative DOM edits, re-applied on re-render
    { "selector": "button", "style": { "border-radius": "10px" } },
    { "selector": "[role='dialog']", "addClass": "my-glass" },
    { "selector": ".unwanted", "hide": true }
  ],

  "js": "mytheme.js"              // optional advanced module (see below)
}
```

### Patch rule fields
`selector` (required) + any of:
`hide`, `remove`, `style:{prop:val}`, `addClass`, `removeClass`, `attr:{k:v}`,
`text`, `html`, `before` (HTML inserted before), `after` (HTML inserted after).

### `mytheme.js`
Runs with `(ocskin, skin, state)`:
```js
// return a teardown fn, or use state.onTeardown(cb)
const el = document.createElement("div"); document.body.appendChild(el);
state.add(el);                         // auto-removed on skin switch
state.onTeardown(() => console.log("bye"));
ocskin.patch(".msg", { style: { opacity: "0.95" } });
```

## Overridable design tokens

The current UI ("oc-2") is driven by these. Overriding a `--color-v2-*` token
also mirrors to its private `--v2-*` source automatically (and vice-versa).

**Background / surfaces**
`--color-v2-background-bg-base` · `-bg-deep` · `-bg-contrast` · `-bg-inverse`
· `-bg-accent` · `-bg-layer-01`…`-layer-04`
Legacy: `--background-base` · `--background-weak` · `--background-strong`
· `--background-stronger` · `--color-surface-base` · `--color-surface-raised-base`
· `--color-surface-inset-base`

**Text**
`--color-v2-text-text-base` · `-text-muted` · `-text-faint` · `-text-accent`

**Border**
`--color-v2-border-border-base` · `-border-muted` · `-border-strong` · `-border-focus`

**Icon**
`--color-v2-icon-icon-base` · `-icon-muted` · `-icon-accent` · `-icon-contrast`

**Overlay / state**
`--color-v2-overlay-simple-overlay-hover` · `-pressed` · `-scrim`
· `--color-v2-state-fg-danger`

**Misc**
`--font-family-text` (e.g. `"JetBrains Mono", monospace`)

> Full list: open DevTools and run
> `getComputedStyle(document.documentElement).cssText` — every `--…` there is
> fair game. Colors accept any CSS color incl. `color-mix()` and alpha.

## Tips
- Three ways to sit panels over a background:
  - **fully transparent** (`surfaceAlpha: 0`, `blur: 0`): the sharpest, most
    immersive look — the raw video shows through everything. Pair it with
    `"css": "../_lib/transparent.css"` (a shared helper that clears the titlebar
    dock and adds a text-shadow so text stays readable with no panel fill). This
    is what the **video** skin ships with.
  - **flat tint** (`surfaceAlpha`, 0..1): a dark scrim over the video — lower =
    more shows through (0.15 = whisper, 0.5 = clearly muted). Good when a busy
    clip makes text hard to read.
  - **frosted glass** (`glass: true`): panels go ~transparent and blur what's
    behind them. Gorgeous over **dark/calm** clips; over a **bright** clip the
    blur reads as a milky wash, so prefer *fully transparent* there.
- To keep panels solid but recolor the app, use `type:"none"` and just set `vars`
  (see the **oled** skin).
- `Ctrl+Alt+R` (or `hotReload:true`) re-applies after you save — fast iteration.
- Target stable ARIA roles / semantic tags (`[role="dialog"]`, `aside`, `nav`,
  `button`, `input`) in CSS/patches rather than the app's hashed utility classes.
