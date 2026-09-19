# Live2D for the code pet

The pet can render a **Live2D Cubism** model (3 / 4 / 5) instead of the built-in
procedural blob. It follows your cursor and reacts to the same real events.

## 1. Fetch the runtime + a model

The runtime libs (Live2D **Cubism Core**, PIXI, pixi-live2d-display) and any
models are **not** committed here — Cubism Core is proprietary and models are
copyrighted. Pull them locally:

```bash
node fetch-live2d.mjs             # libs + a free "Haru" sample -> userData
node fetch-live2d.mjs --no-model  # libs only (bring your own model)
```

Everything lands in `<userData>/skins/pet/live2d/{vendor,model}`
(`<userData>` = `%APPDATA%\ai.opencode.desktop`).

## 2. Point the pet at the model

In `<userData>/skins/active.json`:

```jsonc
"pet": {
  "model": "live2d/model/haru/haru_greeter_t03.model3.json",  // relative to pet/ or a URL
  "name": "Haru",
  "width": 240, "height": 320,   // pet box size on screen
  "fit": 0.95                    // model scale inside the box
}
```

Relaunch OpenCode (or `Ctrl+Alt+R`). If the libs or model fail to load, the pet
silently falls back to the procedural blob.

## Use your own model

Drop a Cubism model folder under `pet/live2d/model/<name>/` (needs the
`.model3.json` + `.moc3` + textures, ideally physics/motions/expressions) and set
`model` to its `.model3.json`. Or fetch a remote one:

```bash
node fetch-live2d.mjs --model "https://…/xxx.model3.json" --name xxx
```

## Multiple models & switching

List several and cycle with **`Ctrl`+`Alt`+`P`** (or `ocpet.nextModel()`):

```jsonc
"pet": {
  "width": 240, "height": 320, "lipSync": true,
  "models": {
    "haru":   { "model": "live2d/model/haru/haru_greeter_t03.model3.json", "name": "Haru" },
    "hiyori": { "model": "live2d/model/hiyori/Hiyori.model3.json", "name": "Hiyori" }
  }
}
```

Runtime: `ocpet.setModel("hiyori")` · `ocpet.setModel(1)` · `ocpet.nextModel()`.

**Per-skin character** — give a skin's `skin.json` a `"pet": { "model": "…" }` and
the pet swaps to that character while the skin is active, reverting on switch-away.

## Lip-sync (interface reserved)

`"lipSync": true` adds a placeholder mouth-flap while the assistant is "talking".
To drive it for real, feed a 0..1 openness each frame — e.g. from an
`AnalyserNode` on TTS audio:

```js
ocpet.lipSync(amplitude)   // 0..1 ; pass null to hand back to the placeholder
```

## Reactions

Moods drive the model two ways (both best-effort, never throw):

| mood | expression/motion (by common name) | standard Cubism params |
| :-- | :-- | :-- |
| thinking | `f00` | look up, eyes up |
| working | `f02` | slight smile |
| happy | `f01` + `Tap` motion | big smile, mouth open |
| error | `f03` | brows down, quick head shake |
| sleeping | — | eyes forced closed, head tilt |

Expression/motion **names vary per model** so those are a bonus (the map above is
tuned for Haru); the parameter effects use standard IDs (`ParamEyeLOpen`,
`ParamMouthForm`, `ParamAngleZ`, …) that work on most models. The model
**watches your cursor**, and **clicks are hit-tested** — patting the **head** vs
poking the **body** trigger different motions and lines.

## Notes
- Requires WebGL (fine in Electron).
- Pinned: PIXI 6.5.10 + pixi-live2d-display 0.4.0 (Cubism 2 & 4).
- Cubism Core license: <https://www.live2d.com/en/download/cubism-sdk/>
