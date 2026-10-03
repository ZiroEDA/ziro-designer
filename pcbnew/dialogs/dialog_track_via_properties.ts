// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track & Via Properties, headless.
 * Counterpart: `pcbnew/dialogs/dialog_track_via_properties.cpp`
 * (`TransferDataToWindow` / `TransferDataFromWindow`).
 *
 * The dialog edits a whole selection at once, so every field is three-state:
 * the first item seeds it, any later item that disagrees blanks it to
 * INDETERMINATE, and apply writes back only the fields that still hold a value.
 * That is the entire reason this is not a simple form — a blank width box means
 * "leave each track's own width alone", not "set the width to zero".
 *
 * The decision logic lives here so it can be tested without a UI.
 */

import { boardItemOfViewId, teardropParamsView } from '../pcb_io/kicad_sexpr/board_view.js';
import { TEARDROP_PARAMETERS } from '../teardrop/teardrop_parameters.js';
import type {
  Board,
  FrontBackOptBool,
  PcbArcTrack,
  PcbTrack,
  PcbVia,
  TeardropParams,
  UnconnectedLayerMode,
} from '../types.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { pcbIUScale, stringFromValue } from '@ziroeda/common/eda_units.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { NO_NET } from '@ziroeda/common/widgets/net_selector.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { EXCLUDE_ZONES } from '../connectivity/connectivity_data.js';
import type { PAD } from '../pad.js';
import {
  BACKDRILL_MODE,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PADSTACK,
  PADSTACK_DRILL_PROPS,
  PADSTACK_POST_MACHINING_PROPS,
  UNCONNECTED_LAYER_MODE,
} from '../padstack.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { GEOMETRY_MIN_SIZE, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import { IPC4761_PRESET, VIA_PROTECTION_UI_MIXIN } from '../via_protection_ui_mixin.js';
import type { TransferResult } from './dialog_text_properties.js';

/** The mask layer that pairs with a copper layer, F.Cu -> F.Mask. */
const maskSideOf = (layer: string): string | undefined =>
  layer === 'F.Cu' ? 'F.Mask' : layer === 'B.Cu' ? 'B.Mask' : undefined;

/** The tracks, arcs and vias a selection names, in board order. */
export interface TrackViaSelection {
  tracks: { index: number; item: PcbTrack }[];
  arcs: { index: number; item: PcbArcTrack }[];
  vias: { index: number; item: PcbVia }[];
}

/**
 * Every field the dialog edits. `undefined` is INDETERMINATE — the selection
 * disagrees, or the field does not apply — and apply leaves it alone.
 */
export interface TrackViaValues {
  // ----- Common -----
  net?: number;
  locked?: boolean;

  // ----- Tracks -----
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  trackWidth?: number;
  layer?: string;
  /** Whether the track opens the solder mask (PCB_TRACK::HasSolderMask). */
  hasMask?: boolean;
  /** `(solder_mask_margin …)`; null means "use the Board Setup value". */
  maskMargin?: number | null;

  // ----- Vias -----
  viaX?: number;
  viaY?: number;
  viaDiameter?: number;
  viaDrill?: number;
  viaType?: PcbVia['kind'];
  startLayer?: string;
  endLayer?: string;
  /**
   * The PADSTACK outer-layer flags. `undefined` here is "not being edited";
   * the flag's own third state — take the board stackup's — is the `front`/`back`
   * field being absent inside the object.
   */
  tenting?: FrontBackOptBool;
  covering?: FrontBackOptBool;
  plugging?: FrontBackOptBool;
  /** `null` is the third state (`none`): follow the board. */
  capping?: boolean | null;
  filling?: boolean | null;

  // ----- Teardrops (per item, `(teardrops …)`) -----
  tdEnabled?: boolean;
  tdAllowTwoTracks?: boolean;
  tdCurvedEdges?: boolean;
  tdMaxLen?: number;
  tdMaxWidth?: number;
  /** Percentages, as the dialog shows them (ratio x 100). */
  tdBestLengthPct?: number;
  tdBestWidthPct?: number;
  tdFilterPct?: number;

  // ----- The live dialog's window only (DIALOG_TRACK_VIA_PROPERTIES below) -----
  // The view-model form above neither reads nor writes these.

  /** `m_viaNotFree`, "Automatically update via nets": `!GetIsFree()`. */
  viaNotFree?: boolean;
  /** `m_annularRingsCtrl`'s row. */
  annularRings?: UnconnectedLayerMode;
  /**
   * `m_protectionFeatures`' row. `undefined` is the appended
   * INDETERMINATE row (CUSTOM or beyond): `setViaConfiguration` leaves it.
   */
  protection?: IPC4761_PRESET;
  /** `m_backdrillChoice`'s row; `undefined` is wxNOT_FOUND (mixed). */
  backdrill?: BACKDRILL_MODE;
  /** `null` is an empty box, `undefined` INDETERMINATE. IU. */
  backdrillFrontSize?: number | null;
  backdrillBackSize?: number | null;
  /** `undefined` is UNDEFINED_LAYER: "None", or mixed. */
  backdrillFrontLayer?: string;
  backdrillBackLayer?: string;
  /** `m_topPostMachine`'s row; `undefined` is wxNOT_FOUND (mixed). */
  topPostMachine?: PostMachineChoice;
  bottomPostMachine?: PostMachineChoice;
  /** Size 1, IU. `null` empty, `undefined` INDETERMINATE. */
  topPostMachineSize1?: number | null;
  bottomPostMachineSize1?: number | null;
  /**
   * Size 2: degrees (a double) when the row is Countersink, else a depth in
   * IU - the one control changes its units with the row.
   */
  topPostMachineSize2?: number | null;
  bottomPostMachineSize2?: number | null;
}

/** `m_topPostMachine` / `m_bottomPostMachine`'s rows (0: None, 1: Countersink, 2: Counterbore). */
export type PostMachineChoice = 'none' | 'countersink' | 'counterbore';

/** Resolve `track:N` / `arc:N` / `via:N` ids against the board. */
/** Is this selection something the dialog can edit at all? */
export const hasTrackOrVia = (sel: TrackViaSelection): boolean =>
  sel.tracks.length > 0 || sel.arcs.length > 0 || sel.vias.length > 0;

/**
 * Fold a value into a field: the first item seeds it, a disagreement blanks it.
 *
 * `seeded` tracks whether the field has been written yet, because `undefined`
 * cannot distinguish "not seeded" from "already indeterminate" — and a field
 * that has gone indeterminate must stay that way even if a later item happens
 * to match the seed.
 */
class Folder<T> {
  private seeded = false;
  private indeterminate = false;
  private value: T | undefined;

  add(v: T | undefined): void {
    if (!this.seeded) {
      this.seeded = true;
      this.value = v;
      return;
    }
    if (this.indeterminate) return;
    if (v !== this.value) {
      this.indeterminate = true;
      this.value = undefined;
    }
  }

  get(): T | undefined {
    return this.indeterminate ? undefined : this.value;
  }
}

const paramsOf = (via: PcbVia): TeardropParams =>
  via.teardrops ?? teardropParamsView(new TEARDROP_PARAMETERS());

/**
 * DIALOG_TRACK_VIA_PROPERTIES::TransferDataToWindow: seed the form from the
 * selection, blanking anything the items disagree on.
 */
export function collectTrackViaValues(sel: TrackViaSelection): TrackViaValues {
  const net = new Folder<number>();
  const locked = new Folder<boolean>();

  const startX = new Folder<number>();
  const startY = new Folder<number>();
  const endX = new Folder<number>();
  const endY = new Folder<number>();
  const trackWidth = new Folder<number>();
  const layer = new Folder<string>();
  const hasMask = new Folder<boolean>();
  const maskMargin = new Folder<number | null>();

  const viaX = new Folder<number>();
  const viaY = new Folder<number>();
  const viaDiameter = new Folder<number>();
  const viaDrill = new Folder<number>();
  const viaType = new Folder<PcbVia['kind']>();
  const startLayer = new Folder<string>();
  const endLayer = new Folder<string>();

  const tdEnabled = new Folder<boolean>();
  const tdAllowTwoTracks = new Folder<boolean>();
  const tdCurvedEdges = new Folder<boolean>();
  const tdMaxLen = new Folder<number>();
  const tdMaxWidth = new Folder<number>();
  const tdBestLengthPct = new Folder<number>();
  const tdBestWidthPct = new Folder<number>();
  const tdFilterPct = new Folder<number>();

  // Straight tracks own the Start/End boxes; an arc's endpoints are driven by
  // its mid point, so upstream leaves them out of the geometry fields.
  for (const { item } of sel.tracks) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    startX.add(item.start.x);
    startY.add(item.start.y);
    endX.add(item.end.x);
    endY.add(item.end.y);
    trackWidth.add(item.width);
    layer.add(item.layer);
    hasMask.add(item.maskLayer !== undefined);
    maskMargin.add(item.solderMaskMargin ?? null);
  }

  for (const { item } of sel.arcs) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    trackWidth.add(item.width);
    layer.add(item.layer);
    hasMask.add(item.maskLayer !== undefined);
    maskMargin.add(item.solderMaskMargin ?? null);
    // Blank the endpoint boxes: an arc in the selection makes them meaningless.
    startX.add(undefined);
    startY.add(undefined);
    endX.add(undefined);
    endY.add(undefined);
  }

  for (const { item } of sel.vias) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    viaX.add(item.at.x);
    viaY.add(item.at.y);
    viaDiameter.add(item.size);
    viaDrill.add(item.drill);
    viaType.add(item.kind);
    startLayer.add(item.layers[0]);
    endLayer.add(item.layers[1]);

    const td = paramsOf(item);
    tdEnabled.add(td.enabled);
    tdAllowTwoTracks.add(td.allowUseTwoTracks);
    tdCurvedEdges.add(td.curvedEdges);
    tdMaxLen.add(td.tdMaxLen);
    tdMaxWidth.add(td.tdMaxWidth);
    tdBestLengthPct.add(td.bestLengthRatio * 100);
    tdBestWidthPct.add(td.bestWidthRatio * 100);
    tdFilterPct.add(td.widthtoSizeFilterRatio * 100);
  }

  return {
    net: net.get(),
    locked: locked.get(),
    startX: startX.get(),
    startY: startY.get(),
    endX: endX.get(),
    endY: endY.get(),
    trackWidth: trackWidth.get(),
    layer: layer.get(),
    hasMask: hasMask.get(),
    maskMargin: maskMargin.get(),
    viaX: viaX.get(),
    viaY: viaY.get(),
    viaDiameter: viaDiameter.get(),
    viaDrill: viaDrill.get(),
    viaType: viaType.get(),
    startLayer: startLayer.get(),
    endLayer: endLayer.get(),
    tdEnabled: tdEnabled.get(),
    tdAllowTwoTracks: tdAllowTwoTracks.get(),
    tdCurvedEdges: tdCurvedEdges.get(),
    tdMaxLen: tdMaxLen.get(),
    tdMaxWidth: tdMaxWidth.get(),
    tdBestLengthPct: tdBestLengthPct.get(),
    tdBestWidthPct: tdBestWidthPct.get(),
    tdFilterPct: tdFilterPct.get(),
  };
}

/**
 * Apply the fields that still hold a value. The model takes the edit when the
 * board is written.
 */
function applyToTrack<T extends PcbTrack | PcbArcTrack>(
  board: Board,
  item: T,
  v: TrackViaValues,
): T {
  let next: T = { ...item };
  let changed = false;

  if (v.net !== undefined && v.net !== item.net) {
    next.net = v.net;
    changed = true;
  }

  if (v.trackWidth !== undefined && v.trackWidth !== item.width) {
    next.width = v.trackWidth;
    changed = true;
  }

  if (v.locked !== undefined && v.locked !== (item.locked ?? false)) {
    next.locked = v.locked;
    changed = true;
  }

  // Layer and mask are one decision: the file spells them as `(layer …)` or
  // `(layers copper mask)`, never both.
  const layer = v.layer ?? item.layer;
  const wantsMask = v.hasMask ?? item.maskLayer !== undefined;
  const maskLayer = wantsMask ? maskSideOf(layer) : undefined;

  if (layer !== item.layer || maskLayer !== item.maskLayer) {
    next.layer = layer;
    next.maskLayer = maskLayer;
    changed = true;
  }

  if (v.maskMargin !== undefined) {
    const margin = v.maskMargin === null ? undefined : v.maskMargin;
    if (margin !== item.solderMaskMargin) {
      next.solderMaskMargin = margin;
      changed = true;
    }
  }

  if (!changed) return item;

  return next;
}

/** Move one endpoint of a straight track. */
function applyTrackGeometry(track: PcbTrack, v: TrackViaValues): PcbTrack {
  const start = { x: v.startX ?? track.start.x, y: v.startY ?? track.start.y };
  const end = { x: v.endX ?? track.end.x, y: v.endY ?? track.end.y };

  const movedStart = start.x !== track.start.x || start.y !== track.start.y;
  const movedEnd = end.x !== track.end.x || end.y !== track.end.y;

  if (!movedStart && !movedEnd) return track;

  return { ...track, start, end };
}

/** Apply the via half. */
function applyToVia(board: Board, via: PcbVia, v: TrackViaValues): PcbVia {
  const next: PcbVia = { ...via };
  let changed = false;

  const at = { x: v.viaX ?? via.at.x, y: v.viaY ?? via.at.y };
  if (at.x !== via.at.x || at.y !== via.at.y) {
    next.at = at;
    changed = true;
  }

  if (v.net !== undefined && v.net !== via.net) {
    next.net = v.net;
    changed = true;
  }

  if (v.locked !== undefined && v.locked !== (via.locked ?? false)) {
    next.locked = v.locked;
    changed = true;
  }

  if (v.viaDiameter !== undefined && v.viaDiameter !== via.size) {
    next.size = v.viaDiameter;
    changed = true;
  }

  if (v.viaDrill !== undefined && v.viaDrill !== via.drill) {
    next.drill = v.viaDrill;
    changed = true;
  }

  if (v.viaType !== undefined && v.viaType !== via.kind) {
    next.kind = v.viaType;
    changed = true;
  }

  const layers: [string, string] = [v.startLayer ?? via.layers[0], v.endLayer ?? via.layers[1]];
  if (layers[0] !== via.layers[0] || layers[1] !== via.layers[1]) {
    next.layers = layers;
    changed = true;
  }

  for (const key of ['tenting', 'covering', 'plugging'] as const) {
    const want = v[key];
    if (want === undefined) continue;
    const have = via[key] ?? {};
    if (want.front === have.front && want.back === have.back) continue;
    next[key] = want;
    changed = true;
  }

  for (const key of ['capping', 'filling'] as const) {
    const want = v[key];
    if (want === undefined) continue;
    const value = want === null ? undefined : want;
    if (value === via[key]) continue;
    next[key] = value;
    changed = true;
  }

  const td = paramsOf(via);
  const nextTd: TeardropParams = {
    ...td,
    enabled: v.tdEnabled ?? td.enabled,
    allowUseTwoTracks: v.tdAllowTwoTracks ?? td.allowUseTwoTracks,
    curvedEdges: v.tdCurvedEdges ?? td.curvedEdges,
    tdMaxLen: v.tdMaxLen ?? td.tdMaxLen,
    tdMaxWidth: v.tdMaxWidth ?? td.tdMaxWidth,
    bestLengthRatio: v.tdBestLengthPct === undefined ? td.bestLengthRatio : v.tdBestLengthPct / 100,
    bestWidthRatio: v.tdBestWidthPct === undefined ? td.bestWidthRatio : v.tdBestWidthPct / 100,
    widthtoSizeFilterRatio:
      v.tdFilterPct === undefined ? td.widthtoSizeFilterRatio : v.tdFilterPct / 100,
  };

  if ((Object.keys(nextTd) as (keyof TeardropParams)[]).some((k) => nextTd[k] !== td[k])) {
    next.teardrops = nextTd;
    changed = true;
  }

  return changed ? next : via;
}

/**
 * DIALOG_TRACK_VIA_PROPERTIES::TransferDataFromWindow.
 *
 * Editing a coordinate box moves that endpoint on every selected track, which
 * is upstream's behaviour and only makes sense because the box is blank unless
 * the whole selection already shared the value.
 */
export function applyTrackViaValues(
  board: Board,
  sel: TrackViaSelection,
  v: TrackViaValues,
): Board {
  const trackIdx = new Set(sel.tracks.map((t) => t.index));
  const arcIdx = new Set(sel.arcs.map((a) => a.index));
  const viaIdx = new Set(sel.vias.map((x) => x.index));

  let changed = false;

  const tracks = board.tracks.map((t, i) => {
    if (!trackIdx.has(i)) return t;
    const next = applyTrackGeometry(applyToTrack(board, t, v), v);
    if (next !== t) changed = true;
    return next;
  });

  const arcs = board.arcs.map((a, i) => {
    if (!arcIdx.has(i)) return a;
    const next = applyToTrack(board, a, v);
    if (next !== a) changed = true;
    return next;
  });

  const vias = board.vias.map((via, i) => {
    if (!viaIdx.has(i)) return via;
    const next = applyToVia(board, via, v);
    if (next !== via) changed = true;
    return next;
  });

  return changed ? { ...board, tracks, arcs, vias } : board;
}

// ---------------------------------------------------------------------------
// The live dialog: DIALOG_TRACK_VIA_PROPERTIES on PCB_TRACK / PCB_ARC / PCB_VIA
// (#636 stage 6)
// ---------------------------------------------------------------------------

/**
 * `DoNotShowCheckbox( __FILE__, __LINE__ )` for the two questions
 * (dialog_track_via_properties.cpp:952, :990). Stable forever: a changed key
 * silently un-silences the question for every user.
 */
export const TRACK_VIA_DO_NOT_SHOW_KEYS = {
  shortingNets: 'pcbnew/dialogs/dialog_track_via_properties.cpp:confirmShortingNets',
  padChange: 'pcbnew/dialogs/dialog_track_via_properties.cpp:confirmPadChange',
} as const;

/** `m_ViaTypeChoice`'s rows (:814-821, :1501-1508). */
const VIA_KIND_OF_TYPE: Partial<Record<VIATYPE, PcbVia['kind']>> = {
  [VIATYPE.THROUGH]: 'through',
  [VIATYPE.MICROVIA]: 'micro',
  [VIATYPE.BLIND]: 'blind',
  [VIATYPE.BURIED]: 'buried',
};

const VIATYPE_OF_KIND: Record<PcbVia['kind'], VIATYPE> = {
  through: VIATYPE.THROUGH,
  micro: VIATYPE.MICROVIA,
  blind: VIATYPE.BLIND,
  buried: VIATYPE.BURIED,
};

/** `m_annularRingsCtrl`'s rows, in order (getAnnularRingSelection, :223-234). */
const ANNULAR_ROWS: readonly [UNCONNECTED_LAYER_MODE, UnconnectedLayerMode][] = [
  [UNCONNECTED_LAYER_MODE.KEEP_ALL, 'keep_all'],
  [UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END, 'remove_except_start_and_end'],
  [UNCONNECTED_LAYER_MODE.REMOVE_ALL, 'remove_all'],
  [UNCONNECTED_LAYER_MODE.START_END_ONLY, 'start_end_only'],
];

const annularRowOf = (aVia: PCB_VIA): number => {
  const row = ANNULAR_ROWS.findIndex(([m]) => m === aVia.Padstack().UnconnectedLayerMode());
  return row < 0 ? 0 : row;
};

/** A layer choice's selection as a name; UNDEFINED_LAYER is `undefined`. */
const layerName = (aLayer: number): string | undefined =>
  aLayer === PCB_LAYER_ID.UNDEFINED_LAYER ? undefined : LSET_Name(aLayer);

const layerOf = (aName: string | undefined): PCB_LAYER_ID =>
  aName === undefined ? PCB_LAYER_ID.UNDEFINED_LAYER : (LSET_NameToLayer(aName) as PCB_LAYER_ID);

/** `getBackdrillDrills` (:236-253): the drill starting on F_Cu, the one starting on B_Cu. */
function backdrillDrills(aVia: PCB_VIA): [PADSTACK_DRILL_PROPS, PADSTACK_DRILL_PROPS] {
  const sec = aVia.Padstack().SecondaryDrill();
  const ter = aVia.Padstack().TertiaryDrill();
  let top = new PADSTACK_DRILL_PROPS();
  let bottom = new PADSTACK_DRILL_PROPS();

  if (sec.start === PCB_LAYER_ID.F_Cu) top = sec;
  else if (ter.start === PCB_LAYER_ID.F_Cu) top = ter;

  if (sec.start === PCB_LAYER_ID.B_Cu) bottom = sec;
  else if (ter.start === PCB_LAYER_ID.B_Cu) bottom = ter;

  return [top, bottom];
}

function backdrillModeOf(
  aTop: PADSTACK_DRILL_PROPS,
  aBottom: PADSTACK_DRILL_PROPS,
): BACKDRILL_MODE {
  const top = aTop.end !== PCB_LAYER_ID.UNDEFINED_LAYER && aTop.size.x > 0;
  const bottom = aBottom.end !== PCB_LAYER_ID.UNDEFINED_LAYER && aBottom.size.x > 0;

  if (top && bottom) return BACKDRILL_MODE.BACKDRILL_BOTH;
  if (bottom) return BACKDRILL_MODE.BACKDRILL_BOTTOM;
  if (top) return BACKDRILL_MODE.BACKDRILL_TOP;
  return BACKDRILL_MODE.NO_BACKDRILL;
}

/**
 * `UNIT_BINDER::GetIntValue()` of a box: an empty box reads 0, and so does
 * INDETERMINATE_STATE, whose text has no leading number.
 */
const intValue = (v: number | null | undefined): number => v ?? 0;

/** The post-machining props a row and its two boxes stand for (:1429-1462). */
function postMachiningOf(
  aChoice: PostMachineChoice,
  aSize1: number | null | undefined,
  aSize2: number | null | undefined,
  aCurrent: PADSTACK_POST_MACHINING_PROPS,
): PADSTACK_POST_MACHINING_PROPS {
  const props = new PADSTACK_POST_MACHINING_PROPS();

  props.mode =
    aChoice === 'countersink'
      ? PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK
      : aChoice === 'counterbore'
        ? PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE
        : PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED;

  if (aSize1 !== undefined) props.size = intValue(aSize1);
  else props.size = aCurrent.size;

  if (aSize2 !== undefined) {
    if (props.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK)
      props.angle = KiROUND(intValue(aSize2) * 10.0);
    else props.depth = intValue(aSize2);
  } else {
    props.angle = aCurrent.angle;
    props.depth = aCurrent.depth;
  }

  return props;
}

/** Fold one post-machining side over the vias (:343-353, :455-483, :642-762). */
class PostMachiningFold {
  private set = false;
  private value: PAD_DRILL_POST_MACHINING_MODE | undefined;
  private size = 0;
  private depth = 0;
  private angle = 0;
  private mixed = false;
  private sizeMixed = false;
  private depthMixed = false;
  private angleMixed = false;

  add(aProps: PADSTACK_POST_MACHINING_PROPS): void {
    if (!this.set) {
      this.set = true;
      this.value = aProps.mode;
      this.size = aProps.size;
      this.depth = aProps.depth;
      this.angle = aProps.angle;
      return;
    }

    if (this.value !== aProps.mode) this.mixed = true;
    if (this.size !== aProps.size) this.sizeMixed = true;
    if (this.depth !== aProps.depth) this.depthMixed = true;
    if (this.angle !== aProps.angle) this.angleMixed = true;
  }

  /** The row and its two boxes, then onTopPostMachineChange's defaults (:1963-1997). */
  window(): {
    choice: PostMachineChoice | undefined;
    size1: number | null | undefined;
    size2: number | null | undefined;
  } {
    let choice: PostMachineChoice | undefined;
    let size1: number | null | undefined;
    let size2: number | null | undefined;

    if (this.mixed) {
      choice = undefined;
      size1 = undefined;
      size2 = undefined;
    } else if (this.set && this.value !== undefined) {
      switch (this.value) {
        case PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE:
          choice = 'counterbore';
          size1 = this.sizeMixed ? undefined : this.size;
          size2 = this.depthMixed ? undefined : this.depth;
          break;

        case PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK:
          choice = 'countersink';
          size1 = this.sizeMixed ? undefined : this.size;
          size2 = this.angleMixed ? undefined : this.angle / 10.0;
          break;

        default:
          choice = 'none';
          size1 = null;
          size2 = null;
          break;
      }
    } else {
      choice = 'none';
      size1 = null;
      size2 = null;
    }

    // Countersink: an indeterminate or zero angle becomes 82 degrees.
    if (choice === 'countersink' && (size2 === undefined || intValue(size2) === 0)) size2 = 82.0;

    return { choice, size1, size2 };
  }
}

/**
 * The live selection the dialog edits, from the editor's view ids: the
 * tracks, arcs and vias, in selection order.
 */
export function trackViaLiveSelection(aBoard: Board, aIds: Iterable<string>): PCB_TRACK[] {
  const items: PCB_TRACK[] = [];

  for (const id of aIds) {
    const item = boardItemOfViewId(aBoard, id);
    if (item instanceof PCB_TRACK) items.push(item);
  }

  return items;
}

/** A question the OK path asks, and the answer it takes as "go ahead". */
export type TrackViaAsk = (aRequest: KiDialogRequest) => KiDialogResult | Promise<KiDialogResult>;

/**
 * `DIALOG_TRACK_VIA_PROPERTIES` (dialog_track_via_properties.cpp) on the
 * live PCB_TRACK / PCB_ARC / PCB_VIA items of a selection.
 *
 * TransferDataToWindow (:168-887) folds the selection into the window: the
 * first track and the first via seed their boxes, any later item that
 * disagrees blanks a box to INDETERMINATE. The window is returned as
 * TrackViaValues, `undefined` for an INDETERMINATE control.
 *
 * TransferDataFromWindow (:996-1678) validates the via parameters
 * (PCB_VIA::ValidateViaParameters) and the track width, then writes every
 * determinate control onto every selected item in one BOARD_COMMIT, "Edit
 * Track/Via Properties". A net change also moves the tracks connected to the
 * selection (connectivity, zones excluded) and the pads they touch that share
 * the old net, after two questions: a short with another net (cancel reverts
 * everything) and the pads that will follow (cancel leaves nets alone).
 *
 * Where the C++ differs from the view-model form above, the C++ decides:
 *  - an arc's start and end are edited like a straight track's;
 *  - "Curved edges" is the FIRST via's value, never INDETERMINATE (:381-388
 *    has no mixed check), and OK writes it to every via;
 *  - mixed annular-ring modes select row 3, "Start and end layers only"
 *    (:423-429, the choice already has four rows), and OK writes it;
 *  - two tracks with no local mask margin read as INDETERMINATE (:315
 *    compares the empty box's 0 against an empty optional);
 *  - any via whose padstack needs an update is given the FIRST via's whole
 *    padstack (`m_viaStack`, :335 and :1535-1539) - and a plain via always
 *    needs one, because the None post-machining row writes
 *    NOT_POST_MACHINED over an unset mode (:1429-1462). So OK on vias of
 *    mixed diameter or drill gives them the first via's.
 *
 * Not ported: the padstack mode and per-layer diameter controls (the edit
 * layer stays PADSTACK::ALL_LAYERS), the predefined-size lists, and the
 * control-enable handlers.
 */
export class DIALOG_TRACK_VIA_PROPERTIES extends VIA_PROTECTION_UI_MIXIN {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_items: readonly EDA_ITEM[];
  /** True if the dialog displays any track properties. */
  readonly m_tracks: boolean;
  /** True if the dialog displays any via properties. */
  readonly m_vias: boolean;
  /** Temporary padstack of the edited via(s): the first via's. */
  private readonly m_viaStack: PADSTACK | null;
  /** The currently-shown copper layer of the edited via(s). */
  private readonly m_editLayer: PCB_LAYER_ID = PADSTACK.ALL_LAYERS;
  private readonly m_padstackDirty = false;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aItems: Iterable<EDA_ITEM>) {
    super();
    this.m_frame = aFrame;
    this.m_items = [...aItems];

    let tracks = false;
    let viaStack: PADSTACK | null = null;

    for (const item of this.m_items) {
      if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) tracks = true;
      else if (item.Type() === KICAD_T.PCB_VIA_T && !viaStack)
        viaStack = new PADSTACK((item as PCB_VIA).Padstack());
    }

    this.m_tracks = tracks;
    this.m_vias = viaStack !== null;
    this.m_viaStack = viaStack;
  }

  TransferDataToWindow(): TrackViaValues {
    let nets = false;
    let net = 0;
    let hasLocked = false;
    let hasUnlocked = false;
    let viaType = VIATYPE.NOT_DEFINED;

    const startX = new Folder<number>();
    const startY = new Folder<number>();
    const endX = new Folder<number>();
    const endY = new Folder<number>();
    const trackWidth = new Folder<number>();
    const layer = new Folder<number>();
    const hasMask = new Folder<boolean>();
    let maskMargin: number | null | undefined;
    let firstTrack = true;

    const viaX = new Folder<number>();
    const viaY = new Folder<number>();
    const viaDiameter = new Folder<number>();
    const viaDrill = new Folder<number>();
    const viaNotFree = new Folder<boolean>();
    const firstLayer = new Folder<number>();
    const lastLayer = new Folder<number>();
    let annularRow = 0;

    const tdEnabled = new Folder<boolean>();
    const tdTwoTracks = new Folder<boolean>();
    const tdMaxLen = new Folder<number>();
    const tdMaxWidth = new Folder<number>();
    const tdLen = new Folder<number>();
    const tdWidth = new Folder<number>();
    const tdFilter = new Folder<number>();
    let tdCurved: boolean | undefined;
    let protection: IPC4761_PRESET | undefined;

    const front = new PostMachiningFold();
    const back = new PostMachiningFold();
    let secondaryEnd: number = PCB_LAYER_ID.UNDEFINED_LAYER;
    let secondaryEndMixed = false;
    let secondarySize = 0;
    let secondarySizeMixed = false;
    let tertiaryEnd: number = PCB_LAYER_ID.UNDEFINED_LAYER;
    let tertiaryEndMixed = false;
    let tertiarySize = 0;
    let tertiarySizeMixed = false;
    let backdrillDir = BACKDRILL_MODE.NO_BACKDRILL;
    let backdrillDirMixed = false;
    let firstVia = true;

    for (const item of this.m_items) {
      const conn = item as BOARD_CONNECTED_ITEM;

      if (!nets) {
        net = conn.GetNetCode();
        nets = true;
      } else if (net !== conn.GetNetCode()) {
        net = -1;
      }

      switch (item.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T: {
          const t = item as PCB_TRACK;

          startX.add(t.GetStartX());
          startY.add(t.GetStartY());
          endX.add(t.GetEndX());
          endY.add(t.GetEndY());
          trackWidth.add(t.GetWidth());
          layer.add(t.GetLayer());
          hasMask.add(t.HasSolderMask());

          if (firstTrack) {
            maskMargin = t.GetLocalSolderMaskMargin() ?? null;
            firstTrack = false;
          } else if (maskMargin !== undefined) {
            // `m_trackMaskMargin.GetValue() != t->GetLocalSolderMaskMargin()`:
            // the box's value (0 when empty) against an optional.
            const m = t.GetLocalSolderMaskMargin();
            if (m === undefined || intValue(maskMargin) !== m) maskMargin = undefined;
          }

          if (t.IsLocked()) hasLocked = true;
          else hasUnlocked = true;

          break;
        }

        case KICAD_T.PCB_VIA_T: {
          const v = item as PCB_VIA;
          const td = v.GetTeardropParams();
          const [topDrill, bottomDrill] = backdrillDrills(v);
          const dir = backdrillModeOf(topDrill, bottomDrill);

          viaX.add(v.GetPosition().x);
          viaY.add(v.GetPosition().y);
          viaDiameter.add(v.GetWidth(this.m_editLayer));
          viaDrill.add(v.GetDrillValue());
          viaNotFree.add(!v.GetIsFree());
          firstLayer.add(v.TopLayer());
          lastLayer.add(v.BottomLayer());
          tdEnabled.add(td.m_Enabled);
          tdTwoTracks.add(td.m_AllowUseTwoTracks);
          tdMaxLen.add(td.m_TdMaxLen);
          tdMaxWidth.add(td.m_TdMaxWidth);
          tdLen.add(td.m_BestLengthRatio * 100.0);
          tdWidth.add(td.m_BestWidthRatio * 100.0);
          tdFilter.add(td.m_WidthtoSizeFilterRatio * 100.0);
          front.add(v.Padstack().FrontPostMachining());
          back.add(v.Padstack().BackPostMachining());

          if (firstVia) {
            firstVia = false;
            viaType = v.GetViaType();
            annularRow = annularRowOf(v);
            secondaryEnd = topDrill.end;
            tertiaryEnd = bottomDrill.end;
            secondarySize = topDrill.size.x;
            tertiarySize = bottomDrill.size.x;
            backdrillDir = dir;
            tdCurved = td.m_CurvedEdges;

            const preset = this.getViaConfiguration(v);
            protection = preset >= IPC4761_PRESET.CUSTOM ? undefined : preset;
          } else {
            if (viaType !== v.GetViaType()) viaType = VIATYPE.NOT_DEFINED;

            // A fourth row is already there, so a disagreement selects it.
            if (annularRow !== annularRowOf(v)) annularRow = 3;

            if (protection !== undefined && this.getViaConfiguration(v) !== protection)
              protection = undefined;

            if (secondaryEnd !== topDrill.end) secondaryEndMixed = true;
            if (tertiaryEnd !== bottomDrill.end) tertiaryEndMixed = true;
            if (backdrillDir !== dir) backdrillDirMixed = true;
            if (bottomDrill.size.x !== tertiarySize) tertiarySizeMixed = true;
            if (topDrill.size.x !== secondarySize) secondarySizeMixed = true;
          }

          if (v.IsLocked()) hasLocked = true;
          else hasUnlocked = true;

          break;
        }
      }
    }

    const out: TrackViaValues = {
      net: net >= 0 ? net : undefined,
      locked: hasLocked && hasUnlocked ? undefined : hasLocked,
    };

    if (this.m_tracks) {
      out.startX = startX.get();
      out.startY = startY.get();
      out.endX = endX.get();
      out.endY = endY.get();
      out.trackWidth = trackWidth.get();
      const l = layer.get();
      out.layer = l === undefined ? undefined : layerName(l);
      out.hasMask = hasMask.get();
      out.maskMargin = maskMargin;
    }

    if (this.m_vias) {
      out.viaX = viaX.get();
      out.viaY = viaY.get();
      out.viaDiameter = viaDiameter.get();
      out.viaDrill = viaDrill.get();
      out.viaType = VIA_KIND_OF_TYPE[viaType];
      out.viaNotFree = viaNotFree.get();
      const s = firstLayer.get();
      const e = lastLayer.get();
      out.startLayer = s === undefined ? undefined : layerName(s);
      out.endLayer = e === undefined ? undefined : layerName(e);
      out.annularRings = ANNULAR_ROWS[annularRow]![1];
      out.protection = protection;

      out.tdEnabled = tdEnabled.get();
      out.tdAllowTwoTracks = tdTwoTracks.get();
      out.tdCurvedEdges = tdCurved;
      out.tdMaxLen = tdMaxLen.get();
      out.tdMaxWidth = tdMaxWidth.get();
      out.tdBestLengthPct = tdLen.get();
      out.tdBestWidthPct = tdWidth.get();
      out.tdFilterPct = tdFilter.get();

      // Backdrill direction and sizes (:566-611).
      let frontSize: number | null | undefined;
      let backSize: number | null | undefined;

      if (backdrillDirMixed) {
        out.backdrill = undefined;
        backSize = tertiarySizeMixed ? undefined : tertiarySize;
        frontSize = secondarySizeMixed ? undefined : secondarySize;
      } else {
        out.backdrill = backdrillDir;

        if (
          backdrillDir === BACKDRILL_MODE.BACKDRILL_BOTTOM ||
          backdrillDir === BACKDRILL_MODE.BACKDRILL_BOTH
        )
          backSize = tertiarySizeMixed ? undefined : tertiarySize;
        else backSize = null;

        if (
          backdrillDir === BACKDRILL_MODE.BACKDRILL_TOP ||
          backdrillDir === BACKDRILL_MODE.BACKDRILL_BOTH
        )
          frontSize = secondarySizeMixed ? undefined : secondarySize;
        else frontSize = null;
      }

      let frontLayer = secondaryEndMixed ? undefined : layerName(secondaryEnd);
      let backLayer = tertiaryEndMixed ? undefined : layerName(tertiaryEnd);

      // onBackdrillChange (:1921-1960): an enabled side with no layer takes
      // its own outer layer, and a zero size 1.1 x the drill.
      const sel = out.backdrill;
      const enableTop =
        sel === BACKDRILL_MODE.BACKDRILL_TOP || sel === BACKDRILL_MODE.BACKDRILL_BOTH;
      const enableBottom =
        sel === BACKDRILL_MODE.BACKDRILL_BOTTOM || sel === BACKDRILL_MODE.BACKDRILL_BOTH;

      if (enableTop) {
        if (frontLayer === undefined) frontLayer = LSET_Name(PCB_LAYER_ID.F_Cu);
        if (intValue(frontSize) === 0) frontSize = KiROUND(intValue(out.viaDrill) * 1.1);
      }

      if (enableBottom) {
        if (backLayer === undefined) backLayer = LSET_Name(PCB_LAYER_ID.B_Cu);
        if (intValue(backSize) === 0) backSize = KiROUND(intValue(out.viaDrill) * 1.1);
      }

      out.backdrillFrontSize = frontSize;
      out.backdrillBackSize = backSize;
      out.backdrillFrontLayer = frontLayer;
      out.backdrillBackLayer = backLayer;

      const top = front.window();
      const bottom = back.window();
      out.topPostMachine = top.choice;
      out.topPostMachineSize1 = top.size1;
      out.topPostMachineSize2 = top.size2;
      out.bottomPostMachine = bottom.choice;
      out.bottomPostMachineSize1 = bottom.size1;
      out.bottomPostMachineSize2 = bottom.size2;
    }

    return out;
  }

  /** `m_netSelector->GetValue()`: the name the combo shows. */
  private netSelectorValue(aNetCode: number): string {
    if (aNetCode === -1) return INDETERMINATE_STATE;

    const netinfo = this.m_frame.GetBoard()?.FindNet(aNetCode);

    if (aNetCode > 0 && netinfo) return unescapeString(netinfo.GetNetname());

    return NO_NET;
  }

  /** confirmShortingNets (:934-955). */
  private shortingNetsRequest(aNet: number, aShortingNets: readonly number[]): KiDialogRequest {
    const name = this.netSelectorValue(aNet);
    const message =
      aShortingNets.length === 1
        ? `Applying these changes will short net ${name} with ${
            this.m_frame.GetBoard()?.FindNet(aShortingNets[0]!)?.GetNetname() ?? ''
          }.`
        : `Applying these changes will short net ${name} with other nets.`;

    return {
      caption: 'Confirmation',
      message,
      icon: 'warning',
      labels: { ok: 'Apply Anyway', cancel: 'Cancel Changes' },
      doNotShowKey: TRACK_VIA_DO_NOT_SHOW_KEYS.shortingNets,
    };
  }

  /** confirmPadChange (:958-993). */
  private padChangeRequest(aNet: number, aPads: readonly PAD[]): KiDialogRequest {
    const name = this.netSelectorValue(aNet);
    const ref = (p: PAD): string => p.GetParentFootprint()?.GetReference() ?? '';
    let message: string;

    if (aPads.length === 1) {
      const pad = aPads[0]!;
      message = `Changing the net will also update ${ref(pad)} pad ${pad.GetNumber()} to ${name}.`;
    } else if (aPads.length === 2) {
      const [pad1, pad2] = aPads as [PAD, PAD];
      message = `Changing the net will also update ${ref(pad1)} pad ${pad1.GetNumber()} and ${ref(pad2)} pad ${pad2.GetNumber()} to ${name}.`;
    } else {
      message = `Changing the net will also update ${aPads.length} connected pads to ${name}.`;
    }

    return {
      caption: 'Confirmation',
      message,
      icon: 'warning',
      labels: { ok: 'Change Nets', cancel: 'Leave Nets Unchanged' },
      doNotShowKey: TRACK_VIA_DO_NOT_SHOW_KEYS.padChange,
    };
  }

  /** The backdrill drills the window stands for (:1297-1389). */
  private backdrillWindow(v: TrackViaValues): {
    secondary: PADSTACK_DRILL_PROPS;
    tertiary: PADSTACK_DRILL_PROPS;
  } {
    const stack = this.m_viaStack!;
    const secondary = new PADSTACK_DRILL_PROPS();
    const tertiary = new PADSTACK_DRILL_PROPS();
    const mode = v.backdrill;

    if (mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH) {
      if (v.backdrillBackSize === undefined || v.backdrillBackSize === null)
        tertiary.size = { ...stack.TertiaryDrill().size };
      else tertiary.size = { x: v.backdrillBackSize, y: v.backdrillBackSize };

      tertiary.start = PCB_LAYER_ID.B_Cu;
      tertiary.shape = PAD_DRILL_SHAPE.CIRCLE;
      tertiary.end = layerOf(v.backdrillBackLayer);
    }

    if (mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH) {
      if (v.backdrillFrontSize === undefined || v.backdrillFrontSize === null)
        secondary.size = { ...stack.SecondaryDrill().size };
      else secondary.size = { x: v.backdrillFrontSize, y: v.backdrillFrontSize };

      secondary.start = PCB_LAYER_ID.F_Cu;
      secondary.shape = PAD_DRILL_SHAPE.CIRCLE;
      secondary.end = layerOf(v.backdrillFrontLayer);
    }

    return { secondary, tertiary };
  }

  /** The malformed-data checks (:1022-1210); design rules are DRC's business. */
  private validate(v: TrackViaValues): TransferResult {
    if (this.m_vias) {
      const startLayer = v.startLayer === undefined ? undefined : layerOf(v.startLayer);
      const endLayer = v.endLayer === undefined ? undefined : layerOf(v.endLayer);

      let secondaryDrill: number | undefined;
      let tertiaryDrill: number | undefined;
      let secondaryStart: PCB_LAYER_ID | undefined;
      let secondaryEnd: PCB_LAYER_ID | undefined;
      let tertiaryStart: PCB_LAYER_ID | undefined;
      let tertiaryEnd: PCB_LAYER_ID | undefined;
      const mode = v.backdrill;

      if (mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH) {
        // An empty box reads 0 once the second, unguarded read runs (:1073-1074).
        tertiaryDrill =
          v.backdrillBackSize === undefined
            ? this.m_viaStack!.TertiaryDrill().size.x
            : intValue(v.backdrillBackSize);
        tertiaryStart = PCB_LAYER_ID.B_Cu;
        if (v.backdrillBackLayer !== undefined) tertiaryEnd = layerOf(v.backdrillBackLayer);
      }

      if (mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH) {
        secondaryDrill =
          v.backdrillFrontSize === undefined
            ? this.m_viaStack!.SecondaryDrill().size.x
            : intValue(v.backdrillFrontSize);
        secondaryStart = PCB_LAYER_ID.F_Cu;
        if (v.backdrillFrontLayer !== undefined) secondaryEnd = layerOf(v.backdrillFrontLayer);
      }

      const error = PCB_VIA.ValidateViaParameters(
        v.viaDiameter,
        v.viaDrill,
        startLayer,
        endLayer,
        secondaryDrill,
        secondaryStart,
        secondaryEnd,
        tertiaryDrill,
        tertiaryStart,
        tertiaryEnd,
        this.m_frame.GetBoard()?.GetCopperLayerCount() ?? 0,
      );

      // DisplayError; the focus it moves to the field is the window's.
      if (error) return { ok: false, message: error.m_Message };
    }

    // m_trackWidth.Validate( GEOMETRY_MIN_SIZE, INT_MAX )
    if (this.m_tracks && v.trackWidth !== undefined && v.trackWidth < GEOMETRY_MIN_SIZE) {
      const min = stringFromValue(pcbIUScale, this.m_frame.GetUserUnits(), GEOMETRY_MIN_SIZE, true);
      return { ok: false, message: `Track width must be at least ${min}.` };
    }

    return { ok: true };
  }

  /** The PCB_TRACE_T / PCB_ARC_T case (:1227-1267). */
  private applyTrack(track: PCB_TRACK, v: TrackViaValues, aLock: boolean | undefined): void {
    if (v.startX !== undefined) track.SetStartX(v.startX);
    if (v.startY !== undefined) track.SetStartY(v.startY);
    if (v.endX !== undefined) track.SetEndX(v.endX);
    if (v.endY !== undefined) track.SetEndY(v.endY);
    if (v.trackWidth !== undefined) track.SetWidth(v.trackWidth);

    const layer = layerOf(v.layer);
    if (layer !== PCB_LAYER_ID.UNDEFINED_LAYER) track.SetLayer(layer);

    if (v.hasMask !== undefined) track.SetHasSolderMask(v.hasMask);

    if (v.maskMargin !== undefined)
      track.SetLocalSolderMaskMargin(v.maskMargin === null ? undefined : v.maskMargin);

    if (aLock !== undefined) track.SetLocked(aLock);
  }

  /** The PCB_VIA_T case (:1269-1593). */
  private applyVia(via: PCB_VIA, v: TrackViaValues, aLock: boolean | undefined): void {
    const stack = this.m_viaStack!;
    let updatePadstack = this.m_padstackDirty;

    if (v.viaX !== undefined) via.SetPosition({ x: v.viaX, y: via.GetPosition().y });
    if (v.viaY !== undefined) via.SetPosition({ x: via.GetPosition().x, y: v.viaY });

    if (v.viaNotFree !== undefined) via.SetIsFree(!v.viaNotFree);

    if (v.viaDiameter !== undefined) {
      const newDiameter = v.viaDiameter;
      const currentSize = via.Padstack().Size(this.m_editLayer);

      if (currentSize.x !== newDiameter || currentSize.y !== newDiameter) {
        stack.SetSize({ x: newDiameter, y: newDiameter }, this.m_editLayer);
        updatePadstack = true;
      }
    }

    // Backdrill
    if (v.backdrill !== undefined) {
      const { secondary, tertiary } = this.backdrillWindow(v);

      if (!via.Padstack().SecondaryDrill().equals(secondary)) {
        stack.SecondaryDrill().assign(secondary);
        updatePadstack = true;
      }

      if (!via.Padstack().TertiaryDrill().equals(tertiary)) {
        stack.TertiaryDrill().assign(tertiary);
        updatePadstack = true;
      }
    } else {
      if (v.backdrillFrontSize !== undefined && v.backdrillFrontSize !== null) {
        const frontSize = v.backdrillFrontSize;
        const size = stack.SecondaryDrill().size;

        if (size.x !== frontSize || size.y !== frontSize) {
          stack.SecondaryDrill().size = { x: frontSize, y: frontSize };
          updatePadstack = true;
        }
      }

      if (v.backdrillBackSize !== undefined && v.backdrillBackSize !== null) {
        const backSize = v.backdrillBackSize;
        const size = stack.TertiaryDrill().size;

        if (size.x !== backSize || size.y !== backSize) {
          stack.TertiaryDrill().size = { x: backSize, y: backSize };
          updatePadstack = true;
        }
      }
    }

    // Post Machining
    const machine = (
      aChoice: PostMachineChoice | undefined,
      aSize1: number | null | undefined,
      aSize2: number | null | undefined,
      aCurrent: PADSTACK_POST_MACHINING_PROPS,
      aTarget: PADSTACK_POST_MACHINING_PROPS,
    ): void => {
      if (aChoice === undefined) return;

      const props = postMachiningOf(aChoice, aSize1, aSize2, aCurrent);

      if (!aCurrent.equals(props)) {
        aTarget.mode = props.mode;
        aTarget.size = props.size;
        aTarget.depth = props.depth;
        aTarget.angle = props.angle;
        updatePadstack = true;
      }
    };

    machine(
      v.topPostMachine,
      v.topPostMachineSize1,
      v.topPostMachineSize2,
      via.Padstack().FrontPostMachining(),
      stack.FrontPostMachining(),
    );
    machine(
      v.bottomPostMachine,
      v.bottomPostMachineSize1,
      v.bottomPostMachineSize2,
      via.Padstack().BackPostMachining(),
      stack.BackPostMachining(),
    );

    if (v.viaType !== undefined) via.SetViaType(VIATYPE_OF_KIND[v.viaType]);

    const startLayer = layerOf(v.startLayer);
    const endLayer = layerOf(v.endLayer);

    if (startLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (via.Padstack().Drill().start !== startLayer) {
        stack.Drill().start = startLayer;
        updatePadstack = true;
      }

      via.SetTopLayer(startLayer);
    }

    if (endLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (via.Padstack().Drill().end !== endLayer) {
        stack.Drill().end = endLayer;
        updatePadstack = true;
      }

      via.SetBottomLayer(endLayer);
    }

    if (updatePadstack) {
      via.SetPadstack(new PADSTACK(stack));
      via.SanitizeLayers();
    }

    const row = ANNULAR_ROWS.find(([, name]) => name === v.annularRings);
    if (row) via.Padstack().SetUnconnectedLayerMode(row[0]);

    if (v.viaDrill !== undefined) via.SetDrill(v.viaDrill);

    const targetParams = via.GetTeardropParams();

    if (v.tdEnabled !== undefined) targetParams.m_Enabled = v.tdEnabled;
    if (v.tdAllowTwoTracks !== undefined) targetParams.m_AllowUseTwoTracks = v.tdAllowTwoTracks;
    if (v.tdMaxLen !== undefined) targetParams.m_TdMaxLen = v.tdMaxLen;
    if (v.tdMaxWidth !== undefined) targetParams.m_TdMaxWidth = v.tdMaxWidth;
    if (v.tdBestLengthPct !== undefined) targetParams.m_BestLengthRatio = v.tdBestLengthPct / 100.0;
    if (v.tdBestWidthPct !== undefined) targetParams.m_BestWidthRatio = v.tdBestWidthPct / 100.0;
    if (v.tdFilterPct !== undefined) targetParams.m_WidthtoSizeFilterRatio = v.tdFilterPct / 100.0;
    if (v.tdCurvedEdges !== undefined) targetParams.m_CurvedEdges = v.tdCurvedEdges;

    if (aLock !== undefined) via.SetLocked(aLock);

    this.setViaConfiguration(via, v.protection ?? IPC4761_PRESET.CUSTOM);
  }

  /**
   * OK. `aAsk` answers the two KIDIALOGs (the frame's `useKiDialog().ask`);
   * without one, both are answered OK.
   */
  async TransferDataFromWindow(
    v: TrackViaValues,
    aAsk: TrackViaAsk = () => 'ok',
  ): Promise<TransferResult> {
    const board = this.m_frame.GetBoard()!;
    const connectivity = board.GetConnectivity();
    const selectedTracks: PCB_TRACK[] = [];
    const connectedTracks = new Set<PCB_TRACK>();

    for (const item of this.m_items) if (item instanceof PCB_TRACK) selectedTracks.push(item);

    for (const selected of selectedTracks) {
      connectedTracks.add(selected);

      // Exclude zones so we only follow direct copper, via, and pad connections.
      for (const connected of connectivity.GetConnectedItems(selected, EXCLUDE_ZONES)) {
        if (connected instanceof PCB_TRACK) connectedTracks.add(connected);
      }
    }

    const check = this.validate(v);
    if (!check.ok) return check;

    // If we survived that, then save the changes.
    const commit = new BOARD_COMMIT(this.m_frame);
    const lock = v.locked;

    for (const track of selectedTracks) {
      commit.Modify(track);

      switch (track.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
          this.applyTrack(track, v, lock);
          break;

        case KICAD_T.PCB_VIA_T:
          this.applyVia(track as PCB_VIA, v, lock);
          break;
      }
    }

    const shortingNets = new Set<number>();
    const newNetCode = v.net ?? -1;
    const changingPads = new Set<PAD>();

    // Not the connectivity code: it propagates through zones, which have not
    // been refilled yet.
    const collide = (a: BOARD_CONNECTED_ITEM, b: BOARD_CONNECTED_ITEM): boolean => {
      for (const layer of a.GetLayerSet().and(b.GetLayerSet()).Seq()) {
        if (a.GetEffectiveShape(layer).Collide(b.GetEffectiveShape(layer))) return true;
      }

      return false;
    };

    for (const track of connectedTracks) {
      for (const other of board.Tracks()) {
        if (other.GetNetCode() === track.GetNetCode() || other.GetNetCode() === newNetCode)
          continue;

        if (collide(track, other)) shortingNets.add(other.GetNetCode());
      }

      for (const footprint of board.Footprints()) {
        for (const pad of footprint.Pads()) {
          if (pad.GetNetCode() === newNetCode) continue;

          if (collide(track, pad)) {
            if (pad.GetNetCode() === track.GetNetCode()) changingPads.add(pad);
            else shortingNets.add(pad.GetNetCode());
          }
        }
      }
    }

    // std::set<int>: ascending, so a lone short names the lowest net code.
    const shorts = [...shortingNets].sort((a, b) => a - b);

    if (shorts.length && (await aAsk(this.shortingNetsRequest(newNetCode, shorts))) !== 'ok') {
      commit.Revert();
      return { ok: true };
    }

    if (v.net !== undefined) {
      const pads = [...changingPads];

      if (pads.length === 0 || (await aAsk(this.padChangeRequest(newNetCode, pads))) === 'ok') {
        for (const track of connectedTracks) {
          if (!selectedTracks.includes(track)) commit.Modify(track);

          track.SetNetCode(newNetCode);
        }

        for (const pad of pads) {
          commit.Modify(pad);
          pad.SetNetCode(newNetCode);
        }
      }
    }

    commit.Push('Edit Track/Via Properties');
    return { ok: true };
  }
}
