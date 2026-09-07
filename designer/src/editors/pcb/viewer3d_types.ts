// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The 3D viewer's *data* types, split out of `pcb3d.ts` for the same reason
 * `menu_types.ts` was split out of `MenuBar.tsx`.
 *
 * `viewer3dMenus.ts` needs `Grid3D` and friends, but `pcb3d.ts` pulls in
 * three.js, `component3d.ts` and `loadmodel.ts` — and `loadmodel.ts` imports
 * `occt-import-js` (no types) and a `?url` wasm asset (Vite-only). A
 * *type-only* import is still a module resolution, so importing these from
 * `pcb3d.js` made the whole menu inventory fail `qa`'s typecheck with errors
 * from a STEP loader it never touches.
 *
 * `pcb3d.ts` re-exports all of these, so existing importers are unaffected.
 */

/** The six standard directions of `CAMERA::ViewCommand_T1` (common/gal/3d/camera.cpp). */
export type View3DDir = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';

/** `EDA_3D_ACTIONS::rotate{X,Y,Z}{CW,CCW}`. */
export type Rotate3DAxis = 'x' | 'y' | 'z';

/** `VIEW3D_PAN_*`. */
export type Move3DDir = 'left' | 'right' | 'up' | 'down';

/** The 3D Grid submenu (`EDA_3D_ACTIONS::noGrid` / `show{10,5,2_5,1}mmGrid`). */
export type Grid3D = 'none' | '10mm' | '5mm' | '2.5mm' | '1mm';

/**
 * Where the camera sits for each of the six axis-aligned views, as a unit
 * direction from the orbit target plus the up vector — `[eye, up]`.
 *
 * Derived from `CAMERA::ViewCommand_T1` rather than copied from it, because
 * upstream states these as *board* rotations off the reset pose and the
 * composition is easy to get backwards. Two things make it subtle:
 *
 *  - `m_rotate_aux` is an angle *triple*, and `updateRotationMatrix()` always
 *    applies it as `Rx·Ry·Rz` (camera.cpp:216) whatever order the Rotate*_T1
 *    calls came in. So VIEW3D_RIGHT's `RotateZ(-90); RotateX(-90);` is
 *    `Rx(-90)·Rz(-90)`, not `Rz(-90)·Rx(-90)`.
 *  - the camera starts at `(0, 0, -d)` (camera.cpp:49) and the view matrix is
 *    `T(pos)·Aux·T(-lookat)`, so the eye lands at `Aux⁻¹·(0,0,d)` and the up
 *    vector at `Aux⁻¹·(0,1,0)`.
 *
 * Our scene's axes match KiCad's 3D space: `TO_SFVEC2F` negates board Y
 * (create_3Dgraphic_brd_items.cpp:61) exactly as `boardGeom.ts`'s `to3d` does.
 */
export const VIEW3D_CAMERA: Record<
  View3DDir,
  { eye: [number, number, number]; up: [number, number, number] }
> = {
  // aux (0,0,0) — Reset_T1()
  top: { eye: [0, 0, 1], up: [0, 1, 0] },
  // aux (0,180,0). A 180 deg turn about Y leaves up alone — negating it here
  // roll-flips the whole bottom view, which is what it did.
  bottom: { eye: [0, 0, -1], up: [0, 1, 0] },
  // aux (-90,0,0)
  front: { eye: [0, -1, 0], up: [0, 0, 1] },
  // aux (-90,0,180)
  back: { eye: [0, 1, 0], up: [0, 0, 1] },
  // aux (-90,0,-90)
  right: { eye: [1, 0, 0], up: [0, 0, 1] },
  // aux (-90,0,90)
  left: { eye: [-1, 0, 0], up: [0, 0, 1] },
};

/** What the 5-pane status bar shows (`EDA_3D_VIEWER_STATUSBAR`). */
export interface Viewer3DStatus {
  /** X_POS / Y_POS: the board point under the pointer, in mm. */
  x: number | null;
  y: number | null;
  /** ZOOM_LEVEL, expressed like KiCad's camera zoom (1.0 == zoom-to-fit). */
  zoom: number;
}

export interface Viewer3D {
  dispose: () => void;

  // -- View menu / top toolbar commands ------------------------------------
  /** `ACTIONS::zoomInCenter` — 1.26x, three steps per doubling. */
  zoomIn: () => void;
  /** `ACTIONS::zoomOutCenter`. */
  zoomOut: () => void;
  /** `ACTIONS::zoomFitScreen` — back to the initial framing. */
  zoomFit: () => void;
  /** `ACTIONS::zoomRedraw`. */
  redraw: () => void;
  /** One of the six axis-aligned views. */
  setView: (dir: View3DDir) => void;
  /** `EDA_3D_ACTIONS::flipView` — 180 deg about Y. */
  flip: () => void;
  /** `EDA_3D_ACTIONS::homeView` — reset the camera. */
  home: () => void;
  /** `EDA_3D_ACTIONS::rotate{X,Y,Z}{CW,CCW}`, `rotation_increment` degrees. */
  rotate: (axis: Rotate3DAxis, cw: boolean) => void;
  /** `VIEW3D_PAN_*`. */
  move: (dir: Move3DDir) => void;
  /** `EDA_3D_ACTIONS::toggleOrtho`. */
  setOrtho: (on: boolean) => void;
  /** The 3D Grid submenu. */
  setGrid: (grid: Grid3D) => void;
  /**
   * `EDA_3D_VIEWER_SETTINGS::m_Camera` — Preferences > 3D Viewer > General's
   * Camera Options, applied live rather than at mount.
   */
  setCamera: (o: Partial<Viewer3dCameraOptions>) => void;

  // -- File / Edit menu ----------------------------------------------------
  /** `EDA_3D_ACTIONS::exportImage` — the current view as a PNG blob. */
  snapshot: () => Promise<Blob | null>;

  /** Called on pointer move / camera change to feed the status bar. */
  onStatus?: (s: Viewer3DStatus) => void;
}

/**
 * `EDA_3D_VIEWER_SETTINGS::m_Render`, as the three.js scene reads it.
 *
 * The settings file's own shape is `prefs/settings.ts`' `Viewer3dRender`; this
 * is the subset `mount3DViewer` can honour, named the way a renderer talks
 * rather than the way a JSON key does. A field absent means "the file's
 * default", which is what a viewer built with no settings object gets upstream.
 *
 * It lives beside `Grid3D` for the same reason that does: `viewer3dMenus.ts`
 * and `Viewer3DFrame.tsx` both need the type, and importing it from `pcb3d.js`
 * would drag three.js and the STEP loader into `qa`'s typecheck.
 */
export interface Viewer3dRenderOptions {
  /** `render.show_zones` — zone fills in the copper layer. */
  showZones?: boolean;
  /** `render.material_mode`, a `MATERIAL_MODE`: 0 NORMAL, 1 DIFFUSE_ONLY, 2 CAD. */
  materialMode?: 0 | 1 | 2;
  /** `render.opengl_AA_mode`, an `ANTIALIASING_MODE`: 0 is NONE. */
  antiAliasing?: 0 | 1 | 2 | 3;
  /** `render.opengl_show_model_bbox` — a `Box3Helper` around each 3D model. */
  showModelBbox?: boolean;
  /** `render.opengl_selection_color`, as CSS. */
  selectionColor?: string;
}

/**
 * `EDA_3D_VIEWER_SETTINGS::m_Camera`, as the scene reads it.
 *
 * Applied through a setter rather than at mount: `EDA_3D_CANVAS` re-reads these
 * on `CommonSettingsChanged`, and rebuilding the scene to change a rotation
 * step would re-tessellate every STEP model in it.
 */
export interface Viewer3dCameraOptions {
  /** `camera.rotation_increment`, DEGREES. */
  rotationIncrement: number;
  /** `camera.animation_enabled` — whether a view change is animated at all. */
  animationEnabled: boolean;
  /** `camera.moving_speed_multiplier`, the 1..5 slider. */
  movingSpeedMultiplier: number;
}
