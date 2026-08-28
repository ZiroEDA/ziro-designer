// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's Objects tab: what each row means, which rows each
 * frame gets, and how flipping one affects the others.
 *
 * Counterpart: `APPEARANCE_CONTROLS::s_objectSettings` and
 * `s_allowedInFpEditor` (`pcbnew/widgets/appearance_controls.cpp:329-379`),
 * read by the one `rebuildObjects` (`:2434-2470`) that both PCB_EDIT_FRAME and
 * FOOTPRINT_EDIT_FRAME's APPEARANCE_CONTROLS runs.
 *
 * It sits in `widgets/` beside `appearance_controls.tsx` rather than under
 * `editors/pcb/`, because the widget that reads it is shared: a table under one
 * launcher's directory is a table the other launcher copies.
 */

export interface ObjectState {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  zones: boolean;
  filledShapes: boolean;
  images: boolean;
  footprintsFront: boolean;
  footprintsBack: boolean;
  fpValues: boolean;
  fpReferences: boolean;
  fpText: boolean;
  ratsnest: boolean;
  drcWarnings: boolean;
  drcErrors: boolean;
  drcExclusions: boolean;
  anchors: boolean;
  points: boolean;
  lockedShadow: boolean;
  collidingCourtyards: boolean;
  boardAreaShadow: boolean;
  drawingSheet: boolean;
  grid: boolean;
}

/**
 * Flip one Objects row, with the Footprint Text meta-control
 * (appearance_controls.cpp onObjectVisibilityChanged).
 *
 * "Because Footprint Text is a meta-control that also can disable
 * values/references, drag them along here so that the user is less likely to
 * be confused" — and the other way, turning a value or reference back *on*
 * restores the meta-control, "in case that user changes Footprint
 * Value/References when the Footprint Text meta-control is disabled". Turning
 * one of them off deliberately does not, which is what leaves you free to show
 * references alone.
 */
export function toggleObject(prev: ObjectState, key: keyof ObjectState): ObjectState {
  const on = !prev[key];
  const next: ObjectState = { ...prev, [key]: on };
  if (key === 'fpText') {
    next.fpReferences = on;
    next.fpValues = on;
  } else if ((key === 'fpReferences' || key === 'fpValues') && on) {
    next.fpText = true;
  }
  return next;
}

/**
 * One row of the Objects tab, or the spacer `RR()` emits between groups.
 *
 * `slider` is APPEARANCE_SETTING::can_control_opacity and `noVisibility` is
 * `!can_control_visibility` — the two optional trailing arguments of the `RR`
 * macro.
 */
export type ObjectRow =
  | 'sep'
  | {
      key: keyof ObjectState;
      label: string;
      tooltip: string;
      slider?: boolean;
      noVisibility?: boolean;
    };

/**
 * The Objects tab, row for row: appearance_controls.cpp's `s_objectSettings`
 * (`:330-363`), in its order, with its labels and its tooltips.
 *
 * [data] KiCad hardcodes this table, so it is mirrored rather than derived —
 * but mirrored is the whole contract. There is no "Constrained Item Shadow"
 * row here because there is none upstream: grepping the whole 10.0.5 tree for
 * that label, for `LAYER_CONSTRAINTS_SHADOW` and for `constrainedShadow`
 * returns nothing at all — not in the source and not in any of the 44
 * translation catalogues, which carry every user-visible string KiCad has.
 * Its three neighbours ("Colliding Courtyards", "Board Area Shadow", "Locked
 * Item Shadow") are each in appearance_controls.cpp and in all 44, which is
 * how we know the search works.
 *
 * Nor is there a `disabled` flag. Upstream draws all 23 rows live; greying is
 * a claim to the user that a control is unavailable, and we were making it
 * about nine rows KiCad shows normally.
 */
export const OBJECT_ROWS: readonly ObjectRow[] = [
  { key: 'tracks', label: 'Tracks', tooltip: 'Show tracks', slider: true },
  { key: 'vias', label: 'Vias', tooltip: 'Show all vias', slider: true },
  { key: 'pads', label: 'Pads', tooltip: 'Show all pads', slider: true },
  { key: 'zones', label: 'Zones', tooltip: 'Show copper zones', slider: true },
  {
    key: 'filledShapes',
    label: 'Filled Shapes',
    tooltip: 'Opacity of filled shapes',
    slider: true,
    noVisibility: true,
  },
  { key: 'images', label: 'Images', tooltip: 'Show user images', slider: true },
  'sep',
  {
    key: 'footprintsFront',
    label: 'Footprints Front',
    tooltip: "Show footprints that are on board's front",
  },
  {
    key: 'footprintsBack',
    label: 'Footprints Back',
    tooltip: "Show footprints that are on board's back",
  },
  { key: 'fpValues', label: 'Values', tooltip: 'Show footprint values' },
  { key: 'fpReferences', label: 'References', tooltip: 'Show footprint references' },
  { key: 'fpText', label: 'Footprint Text', tooltip: 'Show all footprint text' },
  'sep',
  'sep',
  { key: 'ratsnest', label: 'Ratsnest', tooltip: 'Show unconnected nets as a ratsnest' },
  {
    key: 'drcWarnings',
    label: 'DRC Warnings',
    tooltip: 'DRC violations with a Warning severity',
  },
  { key: 'drcErrors', label: 'DRC Errors', tooltip: 'DRC violations with an Error severity' },
  {
    key: 'drcExclusions',
    label: 'DRC Exclusions',
    tooltip: 'DRC violations which have been individually excluded',
  },
  { key: 'anchors', label: 'Anchors', tooltip: 'Show footprint and text origins as a cross' },
  { key: 'points', label: 'Points', tooltip: 'Show explicit snap points as crosses' },
  { key: 'lockedShadow', label: 'Locked Item Shadow', tooltip: 'Show a shadow on locked items' },
  {
    key: 'collidingCourtyards',
    label: 'Colliding Courtyards',
    tooltip: 'Show colliding footprint courtyards',
  },
  { key: 'boardAreaShadow', label: 'Board Area Shadow', tooltip: 'Show board area shadow' },
  {
    key: 'drawingSheet',
    label: 'Drawing Sheet',
    tooltip: 'Show drawing sheet borders and title block',
  },
  { key: 'grid', label: 'Grid', tooltip: 'Show the (x,y) grid dots' },
];

/**
 * The GAL layers the **footprint editor** shows on this tab:
 * `s_allowedInFpEditor` (`appearance_controls.cpp:365-379`), keyed by our
 * `ObjectState` name for each `LAYER_*` id.
 *
 * [data] Upstream's set is `{ LAYER_TRACKS, LAYER_VIAS, LAYER_PADS,
 * LAYER_ZONES, LAYER_FILLED_SHAPES, LAYER_FP_VALUES, LAYER_FP_REFERENCES,
 * LAYER_FP_TEXT, LAYER_DRAW_BITMAPS, LAYER_GRID, LAYER_POINTS }` — eleven ids,
 * eleven keys here.
 *
 * This is the whole of the per-frame variation on this tab. It is DATA the
 * frame supplies, not a second widget: `rebuildObjects` walks the one
 * `s_objectSettings` table and skips what this set does not name.
 */
export const FP_EDITOR_OBJECT_KEYS: ReadonlySet<keyof ObjectState> = new Set<keyof ObjectState>([
  'tracks',
  'vias',
  'pads',
  'zones',
  'filledShapes',
  'images',
  'fpValues',
  'fpReferences',
  'fpText',
  'points',
  'grid',
]);

/**
 * The Objects rows one frame shows, in `s_objectSettings` order.
 *
 * The filter upstream is `if( m_isFpEditor && !s_allowedInFpEditor.count(
 * s_setting.id ) ) continue;` (`:2436`). A spacer row is `RR()`, whose default
 * constructor sets `id( -1 )` (`appearance_controls.h:172`), and -1 is not in
 * `s_allowedInFpEditor` — so the footprint editor drops the group separators
 * too, and its eleven rows run in one unbroken column.
 */
export function appearanceObjectRows(aFpEditor: boolean): readonly ObjectRow[] {
  if (!aFpEditor) return OBJECT_ROWS;
  return OBJECT_ROWS.filter((r) => r !== 'sep' && FP_EDITOR_OBJECT_KEYS.has(r.key));
}

/**
 * Every Objects row's opening visibility.
 *
 * [data] `GAL_SET::DefaultVisible()` (`pcbnew/layer_ids.cpp`) with the
 * project-local defaults on top: everything this tab lists is visible on a
 * fresh board, which is also why `matchPresetName`'s "renderLayers match" test
 * is "the Objects tab is untouched".
 */
export const DEFAULT_OBJECTS: ObjectState = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  filledShapes: true,
  images: true,
  footprintsFront: true,
  footprintsBack: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  ratsnest: true,
  drcWarnings: true,
  drcErrors: true,
  drcExclusions: true,
  anchors: true,
  points: true,
  lockedShadow: true,
  collidingCourtyards: true,
  boardAreaShadow: true,
  drawingSheet: true,
  grid: true,
};

/** The six rows that carry an opacity slider, and where their sliders open. */
export interface ObjectOpacity {
  tracks: number;
  vias: number;
  pads: number;
  zones: number;
  filledShapes: number;
  images: number;
}

/**
 * [data] `PROJECT_LOCAL_SETTINGS`' opacity defaults
 * (`pcbnew/project/project_local_settings.cpp`): tracks/vias/pads/filled
 * shapes open opaque, zones and images at 0.6.
 */
export const DEFAULT_OPACITY: ObjectOpacity = {
  tracks: 1.0,
  vias: 1.0,
  pads: 1.0,
  zones: 0.6,
  filledShapes: 1.0,
  images: 0.6,
};
