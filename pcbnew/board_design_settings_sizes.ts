// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The size-selection half of `BOARD_DESIGN_SETTINGS`
 * (`pcbnew/board_design_settings.cpp:1489-1607`, declarations in
 * `include/board_design_settings.h:295-500`).
 *
 * This is the layer between Board Setup > Pre-defined Sizes and everything that
 * places copper: three list indices, two "use a custom value instead" flags,
 * and six `GetCurrent…()` readers that resolve an index to a number. The router
 * is its main consumer — `PNS_KICAD_IFACE_BASE::ImportSizes` calls
 * `GetCurrentTrackWidth()`, `GetCurrentViaSize()`, `GetCurrentViaDrill()` and
 * all three `GetCurrentDiffPair…()` — so it lives in the engine, not in the
 * editor, and takes no React and no DOM.
 *
 * ## The reserved [0] entry
 *
 * Every one of the three lists begins with a dummy entry standing for "use the
 * netclass value": `TransferDataFromWindow` inserts it
 * (`panel_setup_tracks_and_vias.cpp:337-344`), the file writer writes it, and
 * the Pre-defined Sizes grid shows index 1 upward. Every index test below is
 * written against a list that HAS it. {@link withNetclassEntry} adds it to a
 * panel-order list, because the designer stores the lists without it.
 *
 * ## The asymmetry that looks like a typo and is not
 *
 *     UseNetClassTrack()    { return m_trackWidthIndex <= 0 && !m_useCustomTrackVia; }
 *     UseNetClassVia()      { return m_viaSizeIndex    <= 0 && !m_useCustomTrackVia; }
 *     UseNetClassDiffPair() { return m_diffPairIndex   == 0 && !m_useCustomDiffPair; }
 *
 * Track and via ask `<= 0`; the diff pair asks `== 0`. `SetDiffPairIndex` is
 * the other half of it — it clamps only when the list is non-empty, so a board
 * with no diff-pair rows keeps whatever index it had rather than being pulled
 * to -1. Kept exactly, because a negative index is reachable and the two
 * spellings disagree there.
 */

/** `VIA_DIMENSION` (`board_design_settings.h:120`), in IU. */
export interface ViaDimension {
  /** `m_Diameter`. `<= 0` means use the netclass via diameter. */
  diameter: number;
  /** `m_Drill`. `<= 0` means use the netclass via drill. */
  drill: number;
}

/** `DIFF_PAIR_DIMENSION` (`board_design_settings.h:158`), in IU. */
export interface DiffPairDimension {
  /** `m_Width`. `<= 0` means use the netclass differential pair width. */
  width: number;
  /** `m_Gap`. `<= 0` means use the netclass differential pair gap. */
  gap: number;
  /** `m_ViaGap`. `<= 0` means use the netclass differential pair via gap. */
  viaGap: number;
}

/**
 * What the Default netclass answers, in IU — `m_NetSettings->GetDefaultNetclass()`
 * as the readers below use it.
 *
 * The three differential-pair members are OPTIONAL, and that is the whole
 * point: `NETCLASS::HasDiffPairWidth()` is what decides whether
 * `GetCurrentDiffPairWidth()` falls back to the pair width or to the ordinary
 * track width. A netclass with a blank cell has no value, which is not the same
 * as having zero.
 */
export interface DefaultNetclassDims {
  /** `GetTrackWidth()`. */
  trackWidth: number;
  /** `GetClearance()`. */
  clearance: number;
  /** `GetViaDiameter()`. */
  viaDiameter: number;
  /** `GetViaDrill()`. */
  viaDrill: number;
  /** `HasDiffPairWidth() ? GetDiffPairWidth() : undefined`. */
  diffPairWidth?: number;
  /** `HasDiffPairGap() ? GetDiffPairGap() : undefined`. */
  diffPairGap?: number;
  /** `HasDiffPairViaGap() ? GetDiffPairViaGap() : undefined`. */
  diffPairViaGap?: number;
}

/**
 * The selection state, which is the mutable part of the block: three indices,
 * two flags and three custom values. Everything else a reader needs is the
 * board's lists and the Default netclass.
 */
export interface TrackViaSizeState {
  /** `m_trackWidthIndex`. */
  trackWidthIndex: number;
  /** `m_viaSizeIndex`. */
  viaSizeIndex: number;
  /** `m_diffPairIndex`. */
  diffPairIndex: number;
  /** `m_useCustomTrackVia` — ONE flag covering both the track and the via. */
  useCustomTrackVia: boolean;
  /** `m_useCustomDiffPair`, separate from the one above. */
  useCustomDiffPair: boolean;
  /** `m_customTrackWidth`. */
  customTrackWidth: number;
  /** `m_customViaSize`. */
  customViaSize: ViaDimension;
  /** `m_customDiffPair`. */
  customDiffPair: DiffPairDimension;
}

/** Everything a `GetCurrent…()` reader consults. */
export interface TrackViaSizes {
  /** `m_TrackWidthList`, INCLUDING the reserved [0]. */
  trackWidthList: readonly number[];
  /** `m_ViasDimensionsList`, INCLUDING the reserved [0]. */
  viasDimensionsList: readonly ViaDimension[];
  /** `m_DiffPairDimensionsList`, INCLUDING the reserved [0]. */
  diffPairDimensionsList: readonly DiffPairDimension[];
  /** `m_NetSettings->GetDefaultNetclass()`. */
  defaultNetclass: DefaultNetclassDims;
  /** The selection. */
  selection: TrackViaSizeState;
}

/**
 * `BOARD_DESIGN_SETTINGS`'s own initial values
 * (`board_design_settings.cpp` constructor): every index 0, neither custom
 * override on.
 */
export function defaultTrackViaSizeState(): TrackViaSizeState {
  return {
    trackWidthIndex: 0,
    viaSizeIndex: 0,
    diffPairIndex: 0,
    useCustomTrackVia: false,
    useCustomDiffPair: false,
    customTrackWidth: 0,
    customViaSize: { diameter: 0, drill: 0 },
    customDiffPair: { width: 0, gap: 0, viaGap: 0 },
  };
}

/**
 * Prepend the reserved "use netclass" entry to a panel-order list.
 *
 *     trackWidths.insert( trackWidths.begin(), 0 );      // dummy value
 *     vias.insert( vias.begin(), { 0, 0 } );
 *     diffPairs.insert( diffPairs.begin(), { 0, 0, 0 } );
 *
 * (`panel_setup_tracks_and_vias.cpp:337-344`.) The dummy is zeros, and the
 * readers never dereference it — `<= 0` catches it first — so it exists only to
 * make index 0 mean "netclass" and index 1 the first row the user typed.
 */
export function withNetclassEntry<T>(rows: readonly T[], dummy: T): T[] {
  return [dummy, ...rows];
}

// ---------------------------------------------------------------------------
// Setters. Each clears its custom flag, which is the part that is easy to drop:
// choosing a preset is how a user turns "custom" back off.

/** `SetTrackWidthIndex( aIndex )` (`board_design_settings.cpp:1518`). */
export function setTrackWidthIndex(s: TrackViaSizes, index: number): TrackViaSizeState {
  return {
    ...s.selection,
    trackWidthIndex: Math.min(index, s.trackWidthList.length - 1),
    useCustomTrackVia: false,
  };
}

/** `SetViaSizeIndex( aIndex )` (`board_design_settings.cpp:1489`). */
export function setViaSizeIndex(s: TrackViaSizes, index: number): TrackViaSizeState {
  return {
    ...s.selection,
    viaSizeIndex: Math.min(index, s.viasDimensionsList.length - 1),
    useCustomTrackVia: false,
  };
}

/**
 * `SetDiffPairIndex( aIndex )` (`board_design_settings.cpp:1537`).
 *
 *     if( !m_DiffPairDimensionsList.empty() )
 *         m_diffPairIndex = std::min( aIndex, (int) …size() - 1 );
 *     m_useCustomDiffPair = false;
 *
 * The guard means an EMPTY list leaves the index alone — the two size setters
 * above have no such guard and would clamp to -1 — while the flag is cleared
 * either way, outside the `if`.
 */
export function setDiffPairIndex(s: TrackViaSizes, index: number): TrackViaSizeState {
  const list = s.diffPairDimensionsList;
  return {
    ...s.selection,
    diffPairIndex: list.length > 0 ? Math.min(index, list.length - 1) : s.selection.diffPairIndex,
    useCustomDiffPair: false,
  };
}

// ---------------------------------------------------------------------------
// "Is the netclass in charge?" — what ImportSizes branches on.

/** `UseNetClassTrack()` (`board_design_settings.h:304`). */
export function useNetClassTrack(s: TrackViaSizeState): boolean {
  return s.trackWidthIndex <= 0 && !s.useCustomTrackVia;
}

/** `UseNetClassVia()` (`board_design_settings.h:309`). */
export function useNetClassVia(s: TrackViaSizeState): boolean {
  return s.viaSizeIndex <= 0 && !s.useCustomTrackVia;
}

/** `UseNetClassDiffPair()` (`board_design_settings.h:314`) — `== 0`, not `<= 0`. */
export function useNetClassDiffPair(s: TrackViaSizeState): boolean {
  return s.diffPairIndex === 0 && !s.useCustomDiffPair;
}

// ---------------------------------------------------------------------------
// Readers.

/** `GetCurrentTrackWidth()` (`board_design_settings.cpp:1525`). */
export function getCurrentTrackWidth(s: TrackViaSizes): number {
  const { selection: sel, trackWidthList: list } = s;

  if (sel.useCustomTrackVia) return sel.customTrackWidth;
  if (sel.trackWidthIndex <= 0 || sel.trackWidthIndex >= list.length)
    return s.defaultNetclass.trackWidth;
  return list[sel.trackWidthIndex]!;
}

/** `GetCurrentViaSize()` (`board_design_settings.cpp:1496`). */
export function getCurrentViaSize(s: TrackViaSizes): number {
  const { selection: sel, viasDimensionsList: list } = s;

  if (sel.useCustomTrackVia) return sel.customViaSize.diameter;
  if (sel.viaSizeIndex <= 0 || sel.viaSizeIndex >= list.length)
    return s.defaultNetclass.viaDiameter;
  return list[sel.viaSizeIndex]!.diameter;
}

/**
 * `GetCurrentViaDrill()` (`board_design_settings.cpp:1507`).
 *
 * The `return drill > 0 ? drill : -1` tail is upstream's and is load-bearing:
 * `PCB_VIA` reads -1 as "no drill set", so a zero must not reach it as a zero.
 */
export function getCurrentViaDrill(s: TrackViaSizes): number {
  const { selection: sel, viasDimensionsList: list } = s;
  let drill: number;

  if (sel.useCustomTrackVia) drill = sel.customViaSize.drill;
  else if (sel.viaSizeIndex <= 0 || sel.viaSizeIndex >= list.length)
    drill = s.defaultNetclass.viaDrill;
  else drill = list[sel.viaSizeIndex]!.drill;

  return drill > 0 ? drill : -1;
}

/**
 * `GetCurrentDiffPairWidth()` (`board_design_settings.cpp:1546`).
 *
 * The netclass branch is not the obvious one: a class with no differential-pair
 * width falls back to its ORDINARY track width, not to zero and not to the
 * board minimum.
 */
export function getCurrentDiffPairWidth(s: TrackViaSizes): number {
  const { selection: sel, diffPairDimensionsList: list, defaultNetclass: nc } = s;

  if (sel.useCustomDiffPair) return sel.customDiffPair.width;
  if (sel.diffPairIndex <= 0 || sel.diffPairIndex >= list.length)
    return nc.diffPairWidth ?? nc.trackWidth;
  return list[sel.diffPairIndex]!.width;
}

/**
 * `GetCurrentDiffPairGap()` (`board_design_settings.cpp:1565`).
 *
 * A class with no differential-pair gap falls back to its CLEARANCE, which is
 * the same reasoning as the width falling back to the track width: the pair is
 * two ordinary tracks at the ordinary spacing until something says otherwise.
 */
export function getCurrentDiffPairGap(s: TrackViaSizes): number {
  const { selection: sel, diffPairDimensionsList: list, defaultNetclass: nc } = s;

  if (sel.useCustomDiffPair) return sel.customDiffPair.gap;
  if (sel.diffPairIndex <= 0 || sel.diffPairIndex >= list.length)
    return nc.diffPairGap ?? nc.clearance;
  return list[sel.diffPairIndex]!.gap;
}

/**
 * `GetCurrentDiffPairViaGap()` (`board_design_settings.cpp:1584`).
 *
 * Its last fallback is `GetCurrentDiffPairGap()` — the RESOLVED gap, not the
 * netclass's raw one — so a board with a selected pre-defined row and a
 * netclass that names no via gap takes the via gap from that row's gap.
 */
export function getCurrentDiffPairViaGap(s: TrackViaSizes): number {
  const { selection: sel, diffPairDimensionsList: list, defaultNetclass: nc } = s;

  if (sel.useCustomDiffPair) return sel.customDiffPair.viaGap;
  if (sel.diffPairIndex <= 0 || sel.diffPairIndex >= list.length)
    return nc.diffPairViaGap ?? getCurrentDiffPairGap(s);
  return list[sel.diffPairIndex]!.viaGap;
}

// ---------------------------------------------------------------------------
// Cycling, and the menu's own transitions.

/**
 * `BOARD_EDITOR_CONTROL::TrackWidthInc` / `TrackWidthDec`
 * (`board_editor_control.cpp:1086-1200`), the half that runs while the router
 * is live. Which list it walks is the router's MODE:
 *
 *     if( routerTool->IsToolActive()
 *             && routerTool->Router()->Mode() == PNS_MODE_ROUTE_DIFF_PAIR )
 *         widthIndex = bds.GetDiffPairIndex() + 1;    // or - 1
 *     else
 *         widthIndex = bds.GetTrackWidthIndex();      // …
 *
 * Both wrap, and they wrap ASYMMETRICALLY: increment falls off the end to 0,
 * decrement falls off the front to `size() - 1`. Index 0 is in the cycle, so
 * "use netclass" is one of the stops.
 */
export function nextDiffPairIndex(s: TrackViaSizes, aDelta: 1 | -1): TrackViaSizeState {
  const size = s.diffPairDimensionsList.length;
  let index = s.selection.diffPairIndex + aDelta;

  if (aDelta > 0) {
    // `if( widthIndex >= (int) size ) widthIndex = 0;`
    if (index >= size) index = 0;
  } else if (index < 0) {
    // `if( widthIndex < 0 ) widthIndex = size - 1;`
    index = size - 1;
  }

  // `SetDiffPairIndex( widthIndex ); UseCustomDiffPairDimensions( false );`
  return setDiffPairIndex(s, index);
}

/**
 * The single-track arm of the same two actions, including the step it does
 * NOT take:
 *
 *     if( routerTool->IsToolActive() && Router()->GetState() == ROUTE_TRACK
 *             && bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth )
 *         bds.m_TempOverrideTrackWidth = true;
 *     else
 *         widthIndex++;
 *
 * The first press while "use the starting track's width" is on does not change
 * the index at all — it turns the override on, so the NEXT press starts from
 * where the index already was. Returns the new selection and the new override
 * flag, because the flag lives outside {@link TrackViaSizeState}.
 */
export function nextTrackWidthIndex(
  s: TrackViaSizes,
  aDelta: 1 | -1,
  aRouting: {
    routingTrack: boolean;
    useConnectedTrackWidth: boolean;
    tempOverrideTrackWidth: boolean;
  },
): { selection: TrackViaSizeState; tempOverrideTrackWidth: boolean } {
  const size = s.trackWidthList.length;

  if (
    aRouting.routingTrack &&
    aRouting.useConnectedTrackWidth &&
    !aRouting.tempOverrideTrackWidth
  ) {
    return { selection: s.selection, tempOverrideTrackWidth: true };
  }

  let index = s.selection.trackWidthIndex + aDelta;

  if (aDelta > 0) {
    if (index >= size) index = 0;
  } else if (index < 0) {
    index = size - 1;
  }

  // `SetTrackWidthIndex( widthIndex ); UseCustomTrackViaSize( false );`
  return {
    selection: setTrackWidthIndex(s, index),
    tempOverrideTrackWidth: aRouting.tempOverrideTrackWidth,
  };
}

/**
 * `TRACK_WIDTH_MENU::eventHandler`'s `ID_POPUP_PCB_SELECT_USE_NETCLASS_VALUES`
 * arm (`router_tool.cpp:383-389`) — the one menu item that resets FOUR things,
 * including `m_UseConnectedTrackWidth`, which no other arm touches.
 */
export function useNetclassTrackAndVia(s: TrackViaSizes): {
  selection: TrackViaSizeState;
  useConnectedTrackWidth: false;
} {
  const cleared: TrackViaSizes = {
    ...s,
    selection: { ...s.selection, useCustomTrackVia: false },
  };

  return {
    selection: setTrackWidthIndex({ ...cleared, selection: setViaSizeIndex(cleared, 0) }, 0),
    useConnectedTrackWidth: false,
  };
}
