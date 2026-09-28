# 3d-viewer — divergences from KiCad

Reference: `/home/akshay/kicad-reference/3d-viewer` (10.0.5). Layout rule:
every module sits at the path KiCad keeps its counterpart at, the way
`pcbnew/` and `cvpcb/` do; no `src/`.

Only *divergences* are listed. Anything not mentioned matches.

## What moved here 09-28

Everything below lived under `designer/src/editors/pcb/` until this pass
(the same history `cvpcb/` and `pagelayout_editor/` have). `Viewer3DFrame.tsx`
— `EDA_3D_VIEWER_FRAME` itself — has **not** moved yet; see "Still in
designer/" below.

| KiCad | here |
|---|---|
| `3d_viewer/3d_menubar.cpp` | `3d_menubar.ts` |
| `3d_viewer/toolbars_3d.cpp` | `toolbars_3d.ts` |
| `dialogs/appearance_controls_3D.cpp` | `dialogs/appearance_controls_3d.tsx` — the panel only; the frame docks it |
| `3d_canvas/board_adapter.cpp` | `board_adapter_colors.ts` — `GetLayerColors()`'s stackup-colour block only, whole; the rest of `BOARD_ADAPTER` is split across `pcb3d.ts` / `board_3d_layers.ts` / `viewer3d_appearance.ts` |
| `plugins/3d/occ/loadmodel.cpp` | `loadmodel.ts` — KiCad's OpenCascade kernel, WASM-compiled (`occt-import-js`), plus `occt_tessellate.ts` / `occt_types.ts` / `occt_worker.ts`. KiCad keeps this plugin *outside* `3d-viewer/`, under a sibling `plugins/` top-level directory; there is no `plugins/` package here, so it stays inside this one rather than invent a package for one plugin. |

No exact counterpart, extra (the same shape `pcbnew/board_types.ts` etc. are
for `pcbnew/`): `pcb3d.ts` (the scene builder — `create_3Dgraphic_brd_items.cpp`
+ `create_layer_items.cpp`, fused because the split gains nothing on a scene
graph that is one `THREE.Scene`), `board_3d_layers.ts`, `camera3d.ts`,
`component3d.ts`, `pick3d.ts`, `gl_fixed_function.ts` (the shader/material
half `common_ogl` and `3d_rendering/opengl` split between them upstream),
`viewer3d_types.ts` (the data types, split out for the reason its own header
says — a menu inventory that imports `pcb3d.js` for one type drags three.js
and the STEP loader into every typecheck that touches it), `board_outline.ts`
(board-polygon-with-holes tessellation for the scene; shared with the 2D PCB
editor's Board Area Shadow layer, which imports it from here).

## Never imports `designer/`

Like `cvpcb/` and `pcbnew/`, nothing here reaches into the app. Three seams,
all app-level data a frame or the account's storage supplies, none of it
resolvable by this package on its own:

- **`mount3DViewer`'s `modelsBase` parameter** (`pcb3d.ts`) — where the hosted
  `packages3D` bucket serves `<Library>.3dshapes/<Model>.glb` from
  (`designer/src/libraryHosts.ts`'s `MODELS3D_HOST`). A plain parameter: the
  two designer callers (`Viewer3DFrame.tsx`, `widgets/footprint_preview_3d.tsx`)
  pass it in, exactly as `PCBNEW_APP` would.
- **`loadmodel.ts`'s `setModelCache`** — the tessellation cache is KiCad's
  `.3dc` cache in IndexedDB (`designer/src/editors/pcb/model_cache.ts`), which
  itself needs `home/idb_open.ts`'s IndexedDB handle and `home/local_vault.ts`'s
  sealing layer: real app-storage plumbing, not a value a frame can just pass
  down. `loadmodel.ts` exports a settable `ModelCache` seam instead
  (`modelKey`/`cacheGet`/`cachePut`), defaulting to "never cache" so the
  package works unconfigured (a test, or this package used with no app around
  it). `designer/src/editors/pcb/viewer3d_cache_shim.ts` wires the real one in,
  imported for its side effect by every designer module that can trigger a
  model load.
- **`PhysicalStackup` / `BoardFinish`** (`viewer3d_types.ts`) — narrowed,
  local stand-ins for the real types in `designer/src/editors/pcb/board_settings.ts`
  (the Board Setup dialog's data model, 946 lines, no reason for this package
  to see any of the rest of it). Every field `stackupColors` reads is on both,
  so passing the real object in through `Viewer3DFrame`'s `stackup` /
  `boardFinish` props type-checks on both sides without an import.

## Still in `designer/`

`Viewer3DFrame.tsx` (`EDA_3D_VIEWER_FRAME`) has not moved. Unlike the pieces
above, it is not data or a pure function — it calls `settings.updateViewer3d`
/ `settings.updateCommon` (the persisted Preferences store) directly at
several dozen call sites, and reads `useViewer3dSettings()` /
`useToolbarEntries()`, two live hooks into that same store. Giving it a
`VIEWER3D_APP` the way `CVPCB_APP` / `PL_EDITOR_APP` give their frames one —
`GetViewer3dSettings()` / `UpdateViewer3dSettings()`, a `toolbars` prop, and
the rest — is a real design task on a 945-line file, not a file move, and is
left for its own pass. Everything the frame imports that could move without
that redesign already has (this whole package); the frame keeps importing all
of it from `@ziroeda/3d-viewer` rather than `./`.
