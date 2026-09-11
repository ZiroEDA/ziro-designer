// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APPEARANCE_CONTROLS_3D` (3d-viewer/dialogs/appearance_controls_3D.cpp)
 * and the `BOARD_ADAPTER` halves it drives — `GetVisibleLayers`,
 * `SetVisibleLayers`, `GetLayerColors`, `GetDefaultColors`
 * (3d_canvas/board_adapter.cpp:598-935) — as data and pure functions. The
 * React panel (`Appearance3DPanel.tsx`) draws what these say; the viewer
 * (`pcb3d.ts`) is rebuilt from what they answer. No widget in here, so qa
 * can pin the semantics: which rows exist, what a toggle does to the preset,
 * which colours the stackup is allowed to own.
 */
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/src/color4d.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import {
  DEFAULT_BACKGROUND_BOT,
  DEFAULT_BACKGROUND_TOP,
  DEFAULT_BOARD_BODY,
  DEFAULT_COMMENTS,
  DEFAULT_ECOS,
  DEFAULT_SILKSCREEN,
  DEFAULT_SOLDERMASK,
  DEFAULT_SOLDERPASTE,
  DEFAULT_SURFACE_FINISH,
  type StackupColors,
} from './board_adapter_colors.js';
import type { PlotLayerSelection } from './board_3d_layers.js';

/**
 * `LAYER_3D_ID` (include/layer_ids.h:548-622) plus the three `GAL_LAYER_ID`s
 * the pane also toggles, as names. The numbers upstream are a bitset index;
 * nothing here needs them.
 */
export type Layer3dFlag =
  | 'LAYER_3D_BACKGROUND_BOTTOM'
  | 'LAYER_3D_BACKGROUND_TOP'
  | 'LAYER_3D_BOARD'
  | 'LAYER_3D_COPPER_TOP'
  | 'LAYER_3D_COPPER_BOTTOM'
  | 'LAYER_3D_SILKSCREEN_BOTTOM'
  | 'LAYER_3D_SILKSCREEN_TOP'
  | 'LAYER_3D_SOLDERMASK_BOTTOM'
  | 'LAYER_3D_SOLDERMASK_TOP'
  | 'LAYER_3D_SOLDERPASTE'
  | 'LAYER_3D_ADHESIVE'
  | 'LAYER_3D_USER_COMMENTS'
  | 'LAYER_3D_USER_DRAWINGS'
  | 'LAYER_3D_USER_ECO1'
  | 'LAYER_3D_USER_ECO2'
  | `LAYER_3D_USER_${number}`
  | 'LAYER_3D_PLATED_BARRELS'
  | 'LAYER_3D_TH_MODELS'
  | 'LAYER_3D_SMD_MODELS'
  | 'LAYER_3D_VIRTUAL_MODELS'
  | 'LAYER_3D_MODELS_NOT_IN_POS'
  | 'LAYER_3D_MODELS_MARKED_DNP'
  | 'LAYER_3D_BOUNDING_BOXES'
  | 'LAYER_3D_OFF_BOARD_SILK'
  | 'LAYER_3D_NAVIGATOR'
  | 'LAYER_FP_VALUES'
  | 'LAYER_FP_REFERENCES'
  | 'LAYER_FP_TEXT';

/** `LAYER_3D_USER_1..45`. */
export const userFlag = (n: number): Layer3dFlag => `LAYER_3D_USER_${n}`;
/** The `N` of a `LAYER_3D_USER_N` flag, or 0. */
export const userFlagIndex = (f: string): number => {
  const m = /^LAYER_3D_USER_(\d+)$/.exec(f);
  return m ? Number(m[1]) : 0;
};

/** One `APPEARANCE_SETTING_3D` (`RR( label, id, tooltip )`), or a spacer. */
export interface AppearanceRow3d {
  label: string;
  id: Layer3dFlag;
  tooltip: string;
}

/**
 * `s_layerSettings` (appearance_controls_3D.cpp:48-135), in order; `null`
 * is an `RR()` spacer. The model rows carry their action's tooltip
 * (eda_3d_actions.cpp:312-368).
 */
export const APPEARANCE_ROWS_3D: readonly (AppearanceRow3d | null)[] = [
  { label: 'Board Body', id: 'LAYER_3D_BOARD', tooltip: 'Show board body' },
  {
    label: 'Plated Barrels',
    id: 'LAYER_3D_PLATED_BARRELS',
    tooltip: 'Show barrels of plated through-holes and vias',
  },
  { label: 'F.Cu', id: 'LAYER_3D_COPPER_TOP', tooltip: 'Show front copper / surface finish color' },
  {
    label: 'B.Cu',
    id: 'LAYER_3D_COPPER_BOTTOM',
    tooltip: 'Show back copper / surface finish color',
  },
  { label: 'Adhesive', id: 'LAYER_3D_ADHESIVE', tooltip: 'Show adhesive' },
  { label: 'Solder Paste', id: 'LAYER_3D_SOLDERPASTE', tooltip: 'Show solder paste' },
  { label: 'F.Silkscreen', id: 'LAYER_3D_SILKSCREEN_TOP', tooltip: 'Show front silkscreen' },
  { label: 'B.Silkscreen', id: 'LAYER_3D_SILKSCREEN_BOTTOM', tooltip: 'Show back silkscreen' },
  { label: 'F.Mask', id: 'LAYER_3D_SOLDERMASK_TOP', tooltip: 'Show front solder mask' },
  { label: 'B.Mask', id: 'LAYER_3D_SOLDERMASK_BOTTOM', tooltip: 'Show back solder mask' },
  { label: 'User.Drawings', id: 'LAYER_3D_USER_DRAWINGS', tooltip: 'Show user drawings layer' },
  { label: 'User.Comments', id: 'LAYER_3D_USER_COMMENTS', tooltip: 'Show user comments layer' },
  { label: 'User.Eco1', id: 'LAYER_3D_USER_ECO1', tooltip: 'Show user ECO1 layer' },
  { label: 'User.Eco2', id: 'LAYER_3D_USER_ECO2', tooltip: 'Show user ECO2 layer' },
  ...Array.from({ length: 45 }, (_, i) => ({
    label: `User.${i + 1}`,
    id: userFlag(i + 1),
    tooltip: `Show user defined layer ${i + 1}`,
  })),
  null,
  {
    label: 'Through-hole Models',
    id: 'LAYER_3D_TH_MODELS',
    tooltip: "Show 3D models for 'Through hole' type footprints",
  },
  {
    label: 'SMD Models',
    id: 'LAYER_3D_SMD_MODELS',
    tooltip: "Show 3D models for 'Surface mount' type footprints",
  },
  {
    label: 'Virtual Models',
    id: 'LAYER_3D_VIRTUAL_MODELS',
    tooltip: "Show 3D models for 'unspecified' type footprints",
  },
  {
    label: 'Models not in POS File',
    id: 'LAYER_3D_MODELS_NOT_IN_POS',
    tooltip: 'Show 3D models even if not found in .pos file',
  },
  {
    label: 'Models marked DNP',
    id: 'LAYER_3D_MODELS_MARKED_DNP',
    tooltip: "Show 3D models even if marked 'Do Not Place'",
  },
  {
    label: 'Model Bounding Boxes',
    id: 'LAYER_3D_BOUNDING_BOXES',
    tooltip: 'Show 3D model bounding boxes in realtime renderer',
  },
  null,
  { label: 'Values', id: 'LAYER_FP_VALUES', tooltip: 'Show footprint values' },
  { label: 'References', id: 'LAYER_FP_REFERENCES', tooltip: 'Show footprint references' },
  { label: 'Footprint Text', id: 'LAYER_FP_TEXT', tooltip: 'Show all footprint text' },
  {
    label: 'Off-board Silkscreen',
    id: 'LAYER_3D_OFF_BOARD_SILK',
    tooltip: 'Do not clip silk layers to board outline',
  },
  null,
  { label: '3D Navigator', id: 'LAYER_3D_NAVIGATOR', tooltip: 'Show 3D navigator' },
  {
    label: 'Background Start',
    id: 'LAYER_3D_BACKGROUND_TOP',
    tooltip: 'Background gradient start color',
  },
  {
    label: 'Background End',
    id: 'LAYER_3D_BACKGROUND_BOTTOM',
    tooltip: 'Background gradient end color',
  },
];

/**
 * `Map3DLayerToPCBLayer` for the rows whose label is the BOARD's layer name
 * (`rebuildLayers`: `layerName = GetBoard()->GetLayerName( boardLayer )`).
 */
export function pcbLayerOfFlag(f: Layer3dFlag): string | undefined {
  switch (f) {
    case 'LAYER_3D_COPPER_TOP':
      return 'F.Cu';
    case 'LAYER_3D_COPPER_BOTTOM':
      return 'B.Cu';
    case 'LAYER_3D_SILKSCREEN_TOP':
      return 'F.SilkS';
    case 'LAYER_3D_SILKSCREEN_BOTTOM':
      return 'B.SilkS';
    case 'LAYER_3D_SOLDERMASK_TOP':
      return 'F.Mask';
    case 'LAYER_3D_SOLDERMASK_BOTTOM':
      return 'B.Mask';
    case 'LAYER_3D_ADHESIVE':
      return 'F.Adhes';
    case 'LAYER_3D_SOLDERPASTE':
      return 'F.Paste';
    case 'LAYER_3D_USER_COMMENTS':
      return 'Cmts.User';
    case 'LAYER_3D_USER_DRAWINGS':
      return 'Dwgs.User';
    case 'LAYER_3D_USER_ECO1':
      return 'Eco1.User';
    case 'LAYER_3D_USER_ECO2':
      return 'Eco2.User';
    default: {
      const u = userFlagIndex(f);
      return u ? `User.${u}` : undefined;
    }
  }
}

/**
 * `inStackupColors` (appearance_controls_3D.cpp:139-145): the swatches
 * "Use board stackup colors" takes over, and therefore locks.
 */
export const IN_STACKUP_COLORS: readonly Layer3dFlag[] = [
  'LAYER_3D_BOARD',
  'LAYER_3D_COPPER_TOP',
  'LAYER_3D_COPPER_BOTTOM',
  'LAYER_3D_SOLDERPASTE',
  'LAYER_3D_SILKSCREEN_TOP',
  'LAYER_3D_SILKSCREEN_BOTTOM',
  'LAYER_3D_SOLDERMASK_TOP',
  'LAYER_3D_SOLDERMASK_BOTTOM',
];

/** The rows that have a colour at all (`colors.count( layer )`). */
export const COLORED_FLAGS: readonly Layer3dFlag[] = [
  'LAYER_3D_BACKGROUND_TOP',
  'LAYER_3D_BACKGROUND_BOTTOM',
  'LAYER_3D_BOARD',
  'LAYER_3D_COPPER_TOP',
  'LAYER_3D_COPPER_BOTTOM',
  'LAYER_3D_SILKSCREEN_TOP',
  'LAYER_3D_SILKSCREEN_BOTTOM',
  'LAYER_3D_SOLDERMASK_TOP',
  'LAYER_3D_SOLDERMASK_BOTTOM',
  'LAYER_3D_SOLDERPASTE',
  'LAYER_3D_USER_DRAWINGS',
  'LAYER_3D_USER_COMMENTS',
  'LAYER_3D_USER_ECO1',
  'LAYER_3D_USER_ECO2',
  ...Array.from({ length: 45 }, (_, i) => userFlag(i + 1)),
];

export type Layer3dColors = ReadonlyMap<Layer3dFlag, Color4d>;

/**
 * `BOARD_ADAPTER::GetDefaultColors()` (board_adapter.cpp:612-631): the
 * `g_Default*` table — what a swatch's "Reset to Default" goes back to, and
 * what the "legacy colors" preset holds.
 */
export function defaultColors3d(): Map<Layer3dFlag, Color4d> {
  const m = new Map<Layer3dFlag, Color4d>();
  m.set('LAYER_3D_BACKGROUND_TOP', DEFAULT_BACKGROUND_TOP);
  m.set('LAYER_3D_BACKGROUND_BOTTOM', DEFAULT_BACKGROUND_BOT);
  m.set('LAYER_3D_BOARD', DEFAULT_BOARD_BODY);
  m.set('LAYER_3D_COPPER_TOP', DEFAULT_SURFACE_FINISH);
  m.set('LAYER_3D_COPPER_BOTTOM', DEFAULT_SURFACE_FINISH);
  m.set('LAYER_3D_SILKSCREEN_TOP', DEFAULT_SILKSCREEN);
  m.set('LAYER_3D_SILKSCREEN_BOTTOM', DEFAULT_SILKSCREEN);
  m.set('LAYER_3D_SOLDERMASK_TOP', DEFAULT_SOLDERMASK);
  m.set('LAYER_3D_SOLDERMASK_BOTTOM', DEFAULT_SOLDERMASK);
  m.set('LAYER_3D_SOLDERPASTE', DEFAULT_SOLDERPASTE);
  m.set('LAYER_3D_USER_DRAWINGS', DEFAULT_COMMENTS);
  m.set('LAYER_3D_USER_COMMENTS', DEFAULT_COMMENTS);
  m.set('LAYER_3D_USER_ECO1', DEFAULT_ECOS);
  m.set('LAYER_3D_USER_ECO2', DEFAULT_ECOS);
  return m;
}

/**
 * The colour theme's `3d_viewer.*` entries (`GetColorSettings( DEFAULT_THEME )
 * ->GetColor( layer )` for every key of `GetDefaultColors()`), which is what
 * `GetLayerColors` starts from when no saved preset is current. The theme has
 * no entry for the four user layers, so `GetColor` answers UNSPECIFIED there;
 * the 45 `User_N` rows take `3d_viewer.user_N`, whose default is the board
 * editor's `User_N` colour (color_settings.cpp:256-263).
 */
export function themeColors3d(): Map<Layer3dFlag, Color4d> {
  const T = BUILTIN_DEFAULT_THEME as Record<string, Color4d>;
  const m = new Map<Layer3dFlag, Color4d>();
  m.set('LAYER_3D_BACKGROUND_TOP', T.LAYER_3D_BACKGROUND_TOP!);
  m.set('LAYER_3D_BACKGROUND_BOTTOM', T.LAYER_3D_BACKGROUND_BOTTOM!);
  m.set('LAYER_3D_BOARD', T.LAYER_3D_BOARD!);
  m.set('LAYER_3D_COPPER_TOP', T.LAYER_3D_COPPER_TOP!);
  m.set('LAYER_3D_COPPER_BOTTOM', T.LAYER_3D_COPPER_TOP!);
  m.set('LAYER_3D_SILKSCREEN_TOP', T.LAYER_3D_SILKSCREEN_TOP!);
  m.set('LAYER_3D_SILKSCREEN_BOTTOM', T.LAYER_3D_SILKSCREEN_BOTTOM!);
  m.set('LAYER_3D_SOLDERMASK_TOP', T.LAYER_3D_SOLDERMASK_TOP!);
  m.set('LAYER_3D_SOLDERMASK_BOTTOM', T.LAYER_3D_SOLDERMASK_BOTTOM!);
  m.set('LAYER_3D_SOLDERPASTE', T.LAYER_3D_SOLDERPASTE!);
  m.set('LAYER_3D_USER_DRAWINGS', COLOR4D_UNSPECIFIED);
  m.set('LAYER_3D_USER_COMMENTS', COLOR4D_UNSPECIFIED);
  m.set('LAYER_3D_USER_ECO1', COLOR4D_UNSPECIFIED);
  m.set('LAYER_3D_USER_ECO2', COLOR4D_UNSPECIFIED);
  for (let n = 1; n <= 45; n++) m.set(userFlag(n), T[`User_${n}`] ?? COLOR4D_UNSPECIFIED);
  return m;
}

/**
 * `BOARD_ADAPTER::GetLayerColors()` (board_adapter.cpp:638-757): the preset's
 * colours if one is current, else the theme's; the stackup's on top when
 * "Use board stackup colors" is on; `m_ColorOverrides` (the swatches) last.
 * COPPER_BOTTOM always copies COPPER_TOP.
 */
export function layerColors3d(
  presetColors: Layer3dColors | undefined,
  useStackupColors: boolean,
  stackup: StackupColors | undefined,
  overrides: Layer3dColors,
): Map<Layer3dFlag, Color4d> {
  const colors = new Map<Layer3dFlag, Color4d>(presetColors ?? themeColors3d());
  if (useStackupColors && stackup) {
    colors.set('LAYER_3D_SILKSCREEN_TOP', stackup.silkTop);
    colors.set('LAYER_3D_SILKSCREEN_BOTTOM', stackup.silkBottom);
    colors.set('LAYER_3D_SOLDERMASK_TOP', stackup.maskTop);
    colors.set('LAYER_3D_SOLDERMASK_BOTTOM', stackup.maskBottom);
    if (stackup.body) colors.set('LAYER_3D_BOARD', stackup.body);
    if (stackup.copper) colors.set('LAYER_3D_COPPER_TOP', stackup.copper);
  }
  colors.set('LAYER_3D_COPPER_BOTTOM', colors.get('LAYER_3D_COPPER_TOP')!);
  for (const [k, v] of overrides) colors.set(k, v);
  return colors;
}

/**
 * The `show_*` flags of `EDA_3D_VIEWER_SETTINGS::m_Render` the visibility
 * set is read from and written to (`GetVisibleLayers` / `SetVisibleLayers`).
 */
export interface RenderShowFlags {
  show_board_body: boolean;
  show_plated_barrels: boolean;
  show_copper_top: boolean;
  show_copper_bottom: boolean;
  show_silkscreen_top: boolean;
  show_silkscreen_bottom: boolean;
  show_soldermask_top: boolean;
  show_soldermask_bottom: boolean;
  show_solderpaste: boolean;
  show_adhesive: boolean;
  show_comments: boolean;
  show_drawings: boolean;
  show_eco1: boolean;
  show_eco2: boolean;
  show_user: boolean[];
  show_footprints_normal: boolean;
  show_footprints_insert: boolean;
  show_footprints_virtual: boolean;
  show_footprints_not_in_posfile: boolean;
  show_footprints_dnp: boolean;
  show_fp_references: boolean;
  show_fp_values: boolean;
  show_fp_text: boolean;
  /** `render.opengl_show_model_bbox` / `render.opengl_show_off_board_silk` — the two with the prefix. */
  opengl_show_model_bbox: boolean;
  opengl_show_off_board_silk: boolean;
  show_navigator: boolean;
}

/** `eda_3d_viewer_settings.cpp:330-420`'s third arguments. */
export const RENDER_SHOW_DEFAULTS: RenderShowFlags = {
  show_board_body: true,
  show_plated_barrels: true,
  show_copper_top: true,
  show_copper_bottom: true,
  show_silkscreen_top: true,
  show_silkscreen_bottom: true,
  show_soldermask_top: true,
  show_soldermask_bottom: true,
  show_solderpaste: true,
  show_adhesive: true,
  show_comments: true,
  show_drawings: true,
  show_eco1: true,
  show_eco2: true,
  show_user: Array.from({ length: 45 }, () => false),
  show_footprints_normal: true,
  show_footprints_insert: true,
  show_footprints_virtual: true,
  show_footprints_not_in_posfile: true,
  show_footprints_dnp: false,
  show_fp_references: true,
  show_fp_values: true,
  show_fp_text: true,
  opengl_show_model_bbox: false,
  opengl_show_off_board_silk: false,
  show_navigator: true,
};

/** `FOLLOW_PCB` / `FOLLOW_PLOT_SETTINGS` / `LEGACY_PRESET_FLAG` (eda_3d_viewer_settings.h:32-34). */
export const FOLLOW_PCB = 'follow_pcb_editor';
export const FOLLOW_PLOT_SETTINGS = 'follow_plot_settings';

/** What the FOLLOW_PCB branch reads off the board editor. */
export interface PcbEditorVisibility {
  /** `m_board->IsLayerVisible( layer )`, by canonical name. */
  layers: ReadonlySet<string>;
  /** `IsElementVisible( LAYER_FP_REFERENCES / VALUES / TEXT )`. */
  fpReferences: boolean;
  fpValues: boolean;
  fpText: boolean;
}

/**
 * `BOARD_ADAPTER::GetVisibleLayers()` (board_adapter.cpp:808-935), the
 * board view branch: the render flags, then the preset's override.
 */
export function visibleLayers3d(
  render: RenderShowFlags,
  preset: string,
  presets: readonly LayerPreset3d[],
  plot: PlotLayerSelection | undefined,
  pcb: PcbEditorVisibility | undefined,
  /** `Map3DLayerToPCBLayer( layer )` → PCB_LAYER_ID, for the plot set test. */
  layerId: (name: string) => number,
): Set<Layer3dFlag> {
  const ret = new Set<Layer3dFlag>();
  const set = (f: Layer3dFlag, on: boolean): void => {
    if (on) ret.add(f);
    else ret.delete(f);
  };
  set('LAYER_3D_BOARD', render.show_board_body);
  set('LAYER_3D_PLATED_BARRELS', render.show_plated_barrels);
  set('LAYER_3D_COPPER_TOP', render.show_copper_top);
  set('LAYER_3D_COPPER_BOTTOM', render.show_copper_bottom);
  set('LAYER_3D_SILKSCREEN_TOP', render.show_silkscreen_top);
  set('LAYER_3D_SILKSCREEN_BOTTOM', render.show_silkscreen_bottom);
  set('LAYER_3D_SOLDERMASK_TOP', render.show_soldermask_top);
  set('LAYER_3D_SOLDERMASK_BOTTOM', render.show_soldermask_bottom);
  set('LAYER_3D_SOLDERPASTE', render.show_solderpaste);
  set('LAYER_3D_ADHESIVE', render.show_adhesive);
  set('LAYER_3D_USER_COMMENTS', render.show_comments);
  set('LAYER_3D_USER_DRAWINGS', render.show_drawings);
  set('LAYER_3D_USER_ECO1', render.show_eco1);
  set('LAYER_3D_USER_ECO2', render.show_eco2);
  for (let n = 1; n <= 45; n++) set(userFlag(n), render.show_user[n - 1] ?? false);
  set('LAYER_FP_REFERENCES', render.show_fp_references);
  set('LAYER_FP_VALUES', render.show_fp_values);
  set('LAYER_FP_TEXT', render.show_fp_text);
  set('LAYER_3D_TH_MODELS', render.show_footprints_normal);
  set('LAYER_3D_SMD_MODELS', render.show_footprints_insert);
  set('LAYER_3D_VIRTUAL_MODELS', render.show_footprints_virtual);
  set('LAYER_3D_MODELS_NOT_IN_POS', render.show_footprints_not_in_posfile);
  set('LAYER_3D_MODELS_MARKED_DNP', render.show_footprints_dnp);
  set('LAYER_3D_BOUNDING_BOXES', render.opengl_show_model_bbox);
  set('LAYER_3D_OFF_BOARD_SILK', render.opengl_show_off_board_silk);
  set('LAYER_3D_NAVIGATOR', render.show_navigator);

  if (preset === FOLLOW_PCB) {
    if (!pcb) return ret;
    set('LAYER_3D_BOARD', true);
    set('LAYER_3D_COPPER_TOP', pcb.layers.has('F.Cu'));
    set('LAYER_3D_COPPER_BOTTOM', pcb.layers.has('B.Cu'));
    set('LAYER_3D_SILKSCREEN_TOP', pcb.layers.has('F.SilkS'));
    set('LAYER_3D_SILKSCREEN_BOTTOM', pcb.layers.has('B.SilkS'));
    set('LAYER_3D_SOLDERMASK_TOP', pcb.layers.has('F.Mask'));
    set('LAYER_3D_SOLDERMASK_BOTTOM', pcb.layers.has('B.Mask'));
    set('LAYER_3D_SOLDERPASTE', pcb.layers.has('F.Paste'));
    set('LAYER_3D_ADHESIVE', pcb.layers.has('F.Adhes'));
    set('LAYER_3D_USER_COMMENTS', pcb.layers.has('Cmts.User'));
    set('LAYER_3D_USER_DRAWINGS', pcb.layers.has('Dwgs.User'));
    set('LAYER_3D_USER_ECO1', pcb.layers.has('Eco1.User'));
    set('LAYER_3D_USER_ECO2', pcb.layers.has('Eco2.User'));
    for (let n = 1; n <= 45; n++) set(userFlag(n), pcb.layers.has(`User.${n}`));
    set('LAYER_FP_REFERENCES', pcb.fpReferences);
    set('LAYER_FP_VALUES', pcb.fpValues);
    set('LAYER_FP_TEXT', pcb.fpText);
  } else if (preset === FOLLOW_PLOT_SETTINGS) {
    if (!plot) return ret;
    const has = (name: string): boolean => plot.layers.has(layerId(name));
    set('LAYER_3D_BOARD', true);
    set('LAYER_3D_COPPER_TOP', has('F.Cu'));
    set('LAYER_3D_COPPER_BOTTOM', has('B.Cu'));
    set('LAYER_3D_SILKSCREEN_TOP', has('F.SilkS'));
    set('LAYER_3D_SILKSCREEN_BOTTOM', has('B.SilkS'));
    set('LAYER_3D_SOLDERMASK_TOP', has('F.Mask'));
    set('LAYER_3D_SOLDERMASK_BOTTOM', has('B.Mask'));
    set('LAYER_3D_SOLDERPASTE', has('F.Paste'));
    set('LAYER_3D_ADHESIVE', has('F.Adhes'));
    set('LAYER_3D_USER_COMMENTS', has('Cmts.User'));
    set('LAYER_3D_USER_DRAWINGS', has('Dwgs.User'));
    set('LAYER_3D_USER_ECO1', has('Eco1.User'));
    set('LAYER_3D_USER_ECO2', has('Eco2.User'));
    for (let n = 1; n <= 45; n++) set(userFlag(n), has(`User.${n}`));
    set('LAYER_FP_REFERENCES', plot.plotReference);
    set('LAYER_FP_VALUES', plot.plotValue);
    set('LAYER_FP_TEXT', plot.plotFPText);
  } else {
    const p = presets.find((x) => x.name === preset);
    if (p) return new Set(p.layers);
  }
  return ret;
}

/**
 * `BOARD_ADAPTER::SetVisibleLayers( aLayers )` (board_adapter.cpp:772-805):
 * the set written back into the render flags.
 */
export function renderFlagsFromVisible(
  render: RenderShowFlags,
  v: ReadonlySet<Layer3dFlag>,
): RenderShowFlags {
  return {
    ...render,
    show_board_body: v.has('LAYER_3D_BOARD'),
    show_plated_barrels: v.has('LAYER_3D_PLATED_BARRELS'),
    show_copper_top: v.has('LAYER_3D_COPPER_TOP'),
    show_copper_bottom: v.has('LAYER_3D_COPPER_BOTTOM'),
    show_silkscreen_top: v.has('LAYER_3D_SILKSCREEN_TOP'),
    show_silkscreen_bottom: v.has('LAYER_3D_SILKSCREEN_BOTTOM'),
    show_soldermask_top: v.has('LAYER_3D_SOLDERMASK_TOP'),
    show_soldermask_bottom: v.has('LAYER_3D_SOLDERMASK_BOTTOM'),
    show_solderpaste: v.has('LAYER_3D_SOLDERPASTE'),
    show_adhesive: v.has('LAYER_3D_ADHESIVE'),
    show_comments: v.has('LAYER_3D_USER_COMMENTS'),
    show_drawings: v.has('LAYER_3D_USER_DRAWINGS'),
    show_eco1: v.has('LAYER_3D_USER_ECO1'),
    show_eco2: v.has('LAYER_3D_USER_ECO2'),
    show_user: Array.from({ length: 45 }, (_, i) => v.has(userFlag(i + 1))),
    show_footprints_normal: v.has('LAYER_3D_TH_MODELS'),
    show_footprints_insert: v.has('LAYER_3D_SMD_MODELS'),
    show_footprints_virtual: v.has('LAYER_3D_VIRTUAL_MODELS'),
    show_footprints_not_in_posfile: v.has('LAYER_3D_MODELS_NOT_IN_POS'),
    show_footprints_dnp: v.has('LAYER_3D_MODELS_MARKED_DNP'),
    show_fp_references: v.has('LAYER_FP_REFERENCES'),
    show_fp_values: v.has('LAYER_FP_VALUES'),
    show_fp_text: v.has('LAYER_FP_TEXT'),
    opengl_show_model_bbox: v.has('LAYER_3D_BOUNDING_BOXES'),
    opengl_show_off_board_silk: v.has('LAYER_3D_OFF_BOARD_SILK'),
    show_navigator: v.has('LAYER_3D_NAVIGATOR'),
  };
}

/**
 * `APPEARANCE_CONTROLS_3D::OnLayerVisibilityChanged` (:322-408): the eye
 * toggle, with its two meta-rules — Footprint Text drags References and
 * Values off with it, and turning either of those on turns Footprint Text
 * back on — and whether the change breaks a "Follow …" preset
 * (`killFollow`): a layer does, a model row does not.
 */
export function layerVisibilityChanged(
  visible: ReadonlySet<Layer3dFlag>,
  layer: Layer3dFlag,
  isVisible: boolean,
): { visible: Set<Layer3dFlag>; killFollow: boolean; fastRefresh: boolean } {
  const v = new Set(visible);
  const set = (f: Layer3dFlag, on: boolean): void => {
    if (on) v.add(f);
    else v.delete(f);
  };
  let killFollow = false;
  let fastRefresh = false;
  switch (layer) {
    case 'LAYER_FP_TEXT':
      if (!isVisible) {
        set('LAYER_FP_REFERENCES', false);
        set('LAYER_FP_VALUES', false);
      }
      set('LAYER_FP_TEXT', isVisible);
      killFollow = true;
      break;
    case 'LAYER_FP_REFERENCES':
    case 'LAYER_FP_VALUES':
      if (isVisible) set('LAYER_FP_TEXT', true);
      set(layer, isVisible);
      killFollow = true;
      break;
    case 'LAYER_3D_BOARD':
    case 'LAYER_3D_COPPER_TOP':
    case 'LAYER_3D_COPPER_BOTTOM':
    case 'LAYER_3D_PLATED_BARRELS':
    case 'LAYER_3D_SILKSCREEN_BOTTOM':
    case 'LAYER_3D_SILKSCREEN_TOP':
    case 'LAYER_3D_SOLDERMASK_BOTTOM':
    case 'LAYER_3D_SOLDERMASK_TOP':
    case 'LAYER_3D_SOLDERPASTE':
    case 'LAYER_3D_ADHESIVE':
    case 'LAYER_3D_USER_COMMENTS':
    case 'LAYER_3D_USER_DRAWINGS':
    case 'LAYER_3D_USER_ECO1':
    case 'LAYER_3D_USER_ECO2':
      set(layer, isVisible);
      killFollow = true;
      break;
    case 'LAYER_3D_TH_MODELS':
    case 'LAYER_3D_SMD_MODELS':
    case 'LAYER_3D_VIRTUAL_MODELS':
    case 'LAYER_3D_MODELS_NOT_IN_POS':
    case 'LAYER_3D_MODELS_MARKED_DNP':
      fastRefresh = true;
      set(layer, isVisible);
      break;
    default:
      set(layer, isVisible);
      if (userFlagIndex(layer)) killFollow = true;
      break;
  }
  return { visible: v, killFollow, fastRefresh };
}

/**
 * `onColorSwatchChanged` (:411-463): the three copper swatches are one
 * colour — the renderer has a single `m_CopperColor`.
 */
export function colorSwatchChanged(
  overrides: Layer3dColors,
  layer: Layer3dFlag,
  color: Color4d,
): Map<Layer3dFlag, Color4d> {
  const next = new Map(overrides);
  next.set(layer, color);
  const copper: Layer3dFlag[] = [
    'LAYER_3D_COPPER_TOP',
    'LAYER_3D_COPPER_BOTTOM',
    'LAYER_3D_PLATED_BARRELS',
  ];
  if (copper.includes(layer)) for (const c of copper) next.set(c, color);
  return next;
}

/** `LAYER_PRESET_3D` (eda_3d_viewer_settings.h): name, visibility, colours. */
export interface LayerPreset3d {
  name: string;
  layers: readonly Layer3dFlag[];
  colors: Readonly<Record<string, Color4d>>;
}

export const PRESET_SEPARATOR_3D = '---';

/**
 * `rebuildLayerPresetsWidget` (:555-573): the two Follow entries, the user's
 * presets after a separator when there are any, then the two commands.
 */
export function presetComboItems3d(userPresetNames: readonly string[]): string[] {
  return [
    'Follow PCB Editor',
    'Follow PCB Plot Settings',
    ...(userPresetNames.length ? [PRESET_SEPARATOR_3D, ...userPresetNames] : []),
    PRESET_SEPARATOR_3D,
    'Save preset...',
    'Delete preset...',
  ];
}

/** `updateLayerPresetWidget`: which combo entry a preset name shows as. */
export function presetComboValue(
  currentPreset: string,
  userPresetNames: readonly string[],
): string {
  if (currentPreset === FOLLOW_PCB) return 'Follow PCB Editor';
  if (currentPreset === FOLLOW_PLOT_SETTINGS) return 'Follow PCB Plot Settings';
  if (userPresetNames.includes(currentPreset)) return currentPreset;
  return PRESET_SEPARATOR_3D; // GetCount() - 3, the separator
}

/**
 * `syncLayerPresetSelection` (:576-615): after a manual change, the saved
 * preset that matches the current state exactly, else none (`""`).
 */
export function syncLayerPresetSelection(
  presets: readonly LayerPreset3d[],
  visible: ReadonlySet<Layer3dFlag>,
  colors: Layer3dColors,
  useStackupColors: boolean,
): string {
  const same = (a: Color4d, b: Color4d): boolean =>
    a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  const hit = presets.find((p) => {
    if (p.name.toLowerCase() === 'legacy colors' && useStackupColors) return false;
    const pl = new Set(p.layers);
    for (const f of visible) if (!pl.has(f)) return false;
    for (const f of pl) if (!visible.has(f)) return false;
    for (const [k, c] of colors) {
      const pc = p.colors[k];
      if (pc && !same(pc, c)) return false;
    }
    return true;
  });
  return hit ? hit.name : '';
}

/**
 * `rebuildViewportsWidget` / `viewportComboItems`: the viewports
 * alphabetically (a `std::map`), then the separator and the two commands.
 */
export function viewportComboItems3d(names: readonly string[]): string[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...[...names].sort(cmp), PRESET_SEPARATOR_3D, 'Save viewport...', 'Delete viewport...'];
}

/**
 * `BOARD_ADAPTER::GetDefaultVisibleLayers()` (board_adapter.cpp:948-985) —
 * what the "legacy colors" preset the first open creates
 * (eda_3d_viewer_frame.cpp:576-580) shows.
 */
export function defaultVisibleLayers3d(): Set<Layer3dFlag> {
  return new Set<Layer3dFlag>([
    'LAYER_3D_BOARD',
    'LAYER_3D_PLATED_BARRELS',
    'LAYER_3D_COPPER_TOP',
    'LAYER_3D_COPPER_BOTTOM',
    'LAYER_3D_SILKSCREEN_TOP',
    'LAYER_3D_SILKSCREEN_BOTTOM',
    'LAYER_3D_SOLDERMASK_TOP',
    'LAYER_3D_SOLDERMASK_BOTTOM',
    'LAYER_3D_SOLDERPASTE',
    'LAYER_3D_ADHESIVE',
    'LAYER_FP_REFERENCES',
    'LAYER_FP_VALUES',
    'LAYER_FP_TEXT',
    'LAYER_3D_TH_MODELS',
    'LAYER_3D_SMD_MODELS',
    'LAYER_3D_VIRTUAL_MODELS',
    'LAYER_3D_NAVIGATOR',
  ]);
}

/** The preset the first open of the frame leaves behind. */
export function legacyColorsPreset(): LayerPreset3d {
  return {
    name: 'legacy colors',
    layers: [...defaultVisibleLayers3d()],
    colors: Object.fromEntries(defaultColors3d()),
  };
}
