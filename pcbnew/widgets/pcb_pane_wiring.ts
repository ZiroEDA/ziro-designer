// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The seam between the live `BOARD` the docked panes work on and the editor's
 * selection, which is a set of `${kind}:${index}` ids over the legacy `Board`
 * view (`edit-board.ts`).
 *
 * `PCB_SEARCH_PANE`'s hitlist and `PCB_VERTEX_EDITOR_PANE`'s item are
 * `BOARD_ITEM`s; `PCB_SELECTION_TOOL` holds them directly. Here the selection is
 * the ids, and every legacy item carries the live one as `k`, so translating in
 * either direction is a search for that reference.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import { boardItemId, parseBoardItemId } from '../edit-board.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { Board } from '../types.js';
import type { ZONE } from '../zone.js';
import type { PcbSearchWiring } from './search_handlers.js';
import type { PCB_VERTEX_EDITOR_PANE, VertexEditorFrame } from './vertex_editor_pane.js';

/** The id of the legacy item that wraps `aItem`, or null when the view has none. */
export function legacyIdOf(aBoard: Board, aItem: EDA_ITEM): string | null {
  const find = (aList: readonly { k?: unknown }[] | undefined): number =>
    aList ? aList.findIndex((x) => x.k === aItem) : -1;

  const groups: [Parameters<typeof boardItemId>[0], readonly { k?: unknown }[]][] = [
    ['track', aBoard.tracks],
    ['arc', aBoard.arcs],
    ['via', aBoard.vias],
    ['footprint', aBoard.footprints],
    ['zone', aBoard.zones],
    ['shape', aBoard.shapes],
    ['text', aBoard.texts],
    ['textbox', aBoard.textBoxes],
    ['table', aBoard.tables],
    ['image', aBoard.images],
    ['dimension', aBoard.dimensions],
    ['point', aBoard.points],
    ['barcode', aBoard.barcodes],
    ['group', aBoard.groups],
  ];

  for (const [kind, list] of groups) {
    const i = find(list);

    if (i >= 0) return boardItemId(kind, i);
  }

  for (let fi = 0; fi < aBoard.footprints.length; fi++) {
    const pi = find(aBoard.footprints[fi]!.pads);

    if (pi >= 0) return boardItemId('pad', fi, pi);
  }

  return null;
}

/** {@link legacyIdOf} over a hitlist, dropping what the view does not hold (a net, a ratsnest line). */
export function legacyIdsOf(aBoard: Board, aItems: readonly EDA_ITEM[]): string[] {
  const out: string[] = [];

  for (const item of aItems) {
    const id = legacyIdOf(aBoard, item);

    if (id !== null && !out.includes(id)) out.push(id);
  }

  return out;
}

/** The live item behind an id, or null. */
export function liveItemOfId(aBoard: Board, aId: string): BOARD_ITEM | null {
  const ref = parseBoardItemId(aId);

  if (!ref) return null;

  const at = <T extends { k?: BOARD_ITEM }>(aList: readonly T[] | undefined): BOARD_ITEM | null =>
    aList?.[ref.index]?.k ?? null;

  switch (ref.kind) {
    case 'track':
      return at(aBoard.tracks);
    case 'arc':
      return at(aBoard.arcs);
    case 'via':
      return at(aBoard.vias);
    case 'footprint':
      return at(aBoard.footprints);
    case 'zone':
      return at(aBoard.zones);
    case 'shape':
      return at(aBoard.shapes);
    case 'text':
      return at(aBoard.texts);
    case 'textbox':
      return at(aBoard.textBoxes);
    case 'table':
      return at(aBoard.tables);
    case 'image':
      return at(aBoard.images);
    case 'dimension':
      return at(aBoard.dimensions);
    case 'point':
      return at(aBoard.points);
    case 'barcode':
      return at(aBoard.barcodes);
    case 'group':
      return at(aBoard.groups);
    case 'pad':
      return aBoard.footprints[ref.index]?.pads[ref.sub ?? 0]?.k ?? null;
    default:
      return null;
  }
}

/** `itemHasEditableCorners` (`edit_tool.cpp:74-93`): a polygon shape, or a zone that is not a teardrop. */
export function itemHasEditableCorners(aItem: BOARD_ITEM | null): boolean {
  if (!aItem) return false;

  if (aItem.Type() === KICAD_T.PCB_SHAPE_T) return (aItem as PCB_SHAPE).GetShape() === SHAPE_T.POLY;

  if (aItem.Type() === KICAD_T.PCB_ZONE_T) return !(aItem as ZONE).IsTeardropArea();

  return false;
}

/** `selectionHasEditableCorners` (`edit_tool.cpp:109-116`): exactly one item, and it has corners. */
export function selectionHasEditableCorners(
  aBoard: Board,
  aSelection: ReadonlySet<string>,
): boolean {
  if (aSelection.size !== 1) return false;

  return itemHasEditableCorners(liveItemOfId(aBoard, [...aSelection][0]!));
}

/**
 * What `PCB_VERTEX_EDITOR_PANE` asks its `m_frame` (`PCB_BASE_EDIT_FRAME`,
 * `vertex_editor_pane.cpp`): the units, the origin, `BOARD_COMMIT commit( m_frame )`,
 * the canvas refresh, and `OnVertexEditorPaneClosed`.
 */
export function makeVertexEditorFrame(
  aFrame: PCB_BASE_EDIT_FRAME,
  aRefresh: () => void,
  aOnClosed: (aPane: PCB_VERTEX_EDITOR_PANE) => void,
): VertexEditorFrame {
  return {
    GetUnitsProvider: () => aFrame.GetUnitsProvider(),
    GetOriginTransforms: () => aFrame.GetOriginTransforms(),
    NewCommit: () => new BOARD_COMMIT(aFrame),
    RefreshItem: () => aRefresh(),
    OnVertexEditorPaneClosed: aOnClosed,
  };
}

/** What the editor supplies for the tool-manager side of `SelectItems` / `ActivateItem`. */
export interface PcbSearchWiringDeps {
  /** The `Board` view whose ids the selection holds. */
  getBoard(): Board | null;
  /** The editor's selection (`PCB_SELECTION_TOOL`), as ids. */
  setSelection(aIds: ReadonlySet<string>): void;
  /** `ACTIONS::centerSelection` / `zoomFitSelection`, over the ids just selected. */
  frameView(aIds: readonly string[], aFit: boolean): void;
  refresh(): void;
  /** `PCB_ACTIONS::properties`, on the first id selected. */
  properties(aId: string): void;
  /** `RENDER_SETTINGS::SetHighlight`. */
  highlightNets(aNetCodes: readonly number[]): void;
  showBoardSetupDialog(aInitialPage: string): void;
}

/** {@link PcbSearchWiring} over the editor's selection, remembering the last rows selected. */
export function makePcbSearchWiring(aDeps: PcbSearchWiringDeps): PcbSearchWiring {
  let hits: readonly string[] = [];

  return {
    clearSelection: () => {
      hits = [];
      aDeps.setSelection(new Set());
    },
    selectItems: (aItems) => {
      const board = aDeps.getBoard();

      hits = board ? legacyIdsOf(board, aItems) : [];
      aDeps.setSelection(new Set(hits));
    },
    centerSelection: () => aDeps.frameView(hits, false),
    zoomFitSelection: () => aDeps.frameView(hits, true),
    refresh: () => aDeps.refresh(),
    properties: () => {
      if (hits[0] !== undefined) aDeps.properties(hits[0]);
    },
    highlightNets: (aNetCodes) => aDeps.highlightNets(aNetCodes),
    showBoardSetupDialog: (aPage) => aDeps.showBoardSetupDialog(aPage),
  };
}
