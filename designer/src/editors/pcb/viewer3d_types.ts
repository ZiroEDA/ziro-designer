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

/** What the 5-pane status bar shows (`EDA_3D_VIEWER_STATUSBAR`). */
/**
 * `EDA_3D_CANVAS::DisplayStatus` and the two reporters beside it: the panes
 * are ACTIVITY ("Loading...", "Last render time N ms"), HOVERED_ITEM (the
 * footprint/pad/net under the cursor), X_POS `dx %3.2f`, Y_POS `dy %3.2f`
 * and ZOOM_LEVEL `zoom %3.2f` — where dx/dy are the camera's pan
 * (`m_camera_pos.xy`, 3D units) and zoom is `1 / m_zoom`.
 */
export interface Viewer3DStatus {
  dx: number;
  dy: number;
  zoom: number;
  activity: string;
  hovered: string;
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
  /** `EDA_3D_ACTIONS::pivotCenter` (Space) — look at the board point under the cursor. */
  pivotCenter: () => void;
  /**
   * `FOOTPRINT::IsSelected()` as `renderOpaqueModels` reads it — the board
   * editor's selection, by footprint index, drawn in the selection colour.
   */
  setSelectedFootprints: (footprints: ReadonlySet<number>) => void;
  /**
   * `EDA_3D_CANVAS::OnLeftUp`'s `$SELECT: 0,F<ref>` — a click on a model or
   * pad names its footprint, a click on nothing sends an empty list. The
   * board editor treats it exactly as a `$SELECT` from the schematic.
   */
  onSelect?: (parts: string[]) => void;

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
  /** `render.opengl_highlight_on_rollover` (default true). */
  highlightOnRollover?: boolean;
  /** `GetNetClass()->GetHumanReadableName()` by net code, for the HOVERED_ITEM pane. */
  netClassOf?: (net: number) => string;
  /**
   * `EDA_3D_VIEWER_SETTINGS::m_UseStackupColors` — the appearance panel's
   * "Use board stackup colors". Stored true, but the first open of the frame
   * clears it (eda_3d_viewer_frame.cpp:574), so the working default is
   * FALSE: the colour theme's `3d_viewer.*` entries.
   */
  useStackupColors?: boolean;
  /** `BOARD::IsFootprintHolder()` — the footprint editor/browser's board skips the ×1.6 "home zoom" hack. */
  footprintHolder?: boolean;
  /** `render.show_fp_references` / `show_fp_values` / `show_fp_text` (default true). */
  showFpReferences?: boolean;
  showFpValues?: boolean;
  showFpText?: boolean;
  /** `render.opengl_show_off_board_silk` (default false). */
  showOffBoardSilk?: boolean;
  /** `render.subtract_mask_from_silk` (default false). */
  subtractMaskFromSilk?: boolean;
  /** `render.clip_silk_on_via_annulus` (default false). */
  clipSilkOnViaAnnuli?: boolean;
  /** `render.show_plated_barrels` (default true). */
  showPlatedBarrels?: boolean;
  /** `render.plated_and_bare_copper` (default false): finish colour only where the mask opens. */
  differentiatePlatedCopper?: boolean;
  /** `render.opengl_copper_thickness` (default true): extrude the layers' walls. */
  copperThickness?: boolean;
  /** `render.show_board_body` (default true). */
  showBoardBody?: boolean;
  /** `render.show_soldermask_top` / `_bottom` (default true). */
  showSoldermaskTop?: boolean;
  showSoldermaskBottom?: boolean;
  /** `render.show_navigator` (default true): the axis spheres in the corner. */
  showNavigator?: boolean;
  /** `render.show_footprints_{insert,normal,virtual,not_in_posfile,dnp}`. */
  showFootprintsInsert?: boolean;
  showFootprintsNormal?: boolean;
  showFootprintsVirtual?: boolean;
  showFootprintsNotInPosfile?: boolean;
  showFootprintsDnp?: boolean;
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
