// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The bridge from an edit made on the plain-object `Board` view to a
 * BOARD_COMMIT on the live BOARD (issue 636, stage 2).
 *
 * The editor's tools still produce a new immutable view per edit (stage 3
 * moves them onto the item classes). Until then every such edit becomes one
 * commit: the view items that changed are staged as modifications before
 * the write-back (so the commit takes their images first), the write-back
 * puts the view into the BOARD through its own Add/Remove, and the items
 * the write-back added or removed are staged as done. `Push` then does
 * what it does for any commit — connectivity, teardrops, the listeners, the
 * frame's undo entry. The view is re-derived from the BOARD afterwards, so
 * whatever Push changed beyond the edit (a teardrop, a propagated net) is
 * what the editor shows.
 *
 * The view is immutable and structurally shared, so an item that changed is
 * a different object from the one in the previous view; an item without a
 * model of its own is a new one.
 */
import type { BOARD } from '../../board.js';
import { BOARD_COMMIT } from '../../board_commit.js';
import type { BOARD_ITEM } from '../../board_item.js';
import type { PCB_BASE_EDIT_FRAME } from '../../pcb_base_edit_frame.js';
import type { TeardropParameters, TeardropParametersList } from '../../teardrop.js';
import {
  TARGET_RECT,
  TARGET_ROUND,
  TARGET_TRACK,
  type TEARDROP_PARAMETERS,
  type TEARDROP_PARAMETERS_LIST,
} from '../../teardrop/teardrop_parameters.js';
import type { Board } from '../../types.js';
import { boardToBOARD } from './board_view.js';

/** A view item that may carry its model. */
interface ViewItem {
  k?: BOARD_ITEM;
}

/** The item lists of a view, in the order the write-back walks them. */
function viewLists(b: Board): readonly (readonly ViewItem[])[] {
  return [
    b.footprints,
    b.shapes,
    b.texts,
    b.textBoxes,
    b.tables,
    b.images,
    b.barcodes,
    b.dimensions,
    b.tracks,
    b.arcs,
    b.vias,
    b.points,
    b.zones,
    b.groups,
  ];
}

/** Every item the BOARD holds in its own lists (not footprint children). */
function boardItems(kb: BOARD): Set<BOARD_ITEM> {
  const out = new Set<BOARD_ITEM>();
  for (const fp of kb.Footprints()) out.add(fp);
  for (const d of kb.Drawings()) out.add(d);
  for (const t of kb.Tracks()) out.add(t);
  for (const z of kb.Zones()) out.add(z);
  for (const p of kb.Points()) out.add(p);
  for (const g of kb.Groups()) out.add(g);
  for (const g of kb.Generators()) out.add(g);
  return out;
}

/** The view's TEARDROP_PARAMETERS onto the class. */
function applyTeardropParameters(k: TEARDROP_PARAMETERS, v: TeardropParameters): void {
  k.m_TdMaxLen = v.tdMaxLen;
  k.m_TdMaxWidth = v.tdMaxWidth;
  k.m_BestLengthRatio = v.bestLengthRatio;
  k.m_BestWidthRatio = v.bestWidthRatio;
  k.m_WidthtoSizeFilterRatio = v.widthtoSizeFilterRatio;
  k.m_CurvedEdges = v.curvedEdges;
  k.m_Enabled = v.enabled;
  k.m_AllowUseTwoTracks = v.allowUseTwoTracks;
  k.m_TdOnPadsInZones = v.tdOnPadsInZones;
}

/**
 * The project's teardrop settings (the .kicad_pro's `teardrop_options` and
 * `teardrop_parameters`, which the designer holds in its board setup) onto
 * `BOARD_DESIGN_SETTINGS::m_TeardropParamsList`, which TEARDROP_MANAGER reads.
 */
export function applyTeardropParametersList(
  k: TEARDROP_PARAMETERS_LIST,
  v: TeardropParametersList,
): void {
  applyTeardropParameters(k.GetParameters(TARGET_ROUND), v.round);
  applyTeardropParameters(k.GetParameters(TARGET_RECT), v.rect);
  applyTeardropParameters(k.GetParameters(TARGET_TRACK), v.track);
  k.m_TargetVias = v.targetVias;
  k.m_TargetPTHPads = v.targetPTHPads;
  k.m_TargetSMDPads = v.targetSMDPads;
  k.m_TargetTrack2Track = v.targetTrack2Track;
  k.m_UseRoundShapesOnly = v.useRoundShapesOnly;
}

/**
 * Commit the difference between two views to the BOARD they share, through
 * the frame's BOARD_COMMIT. Returns the BOARD; the caller re-derives its view.
 *
 * @param aFrame the editor frame, whose tool manager holds the BOARD.
 * @param aPrev the view the edit started from (null for the first).
 * @param aNext the view the edit produced.
 * @param aMessage the undo entry's description.
 * @param aCommitFlags BOARD_COMMIT's flags (SKIP_TEARDROPS etc).
 */
export function commitViewToBoard(
  aFrame: PCB_BASE_EDIT_FRAME,
  aPrev: Board | null,
  aNext: Board,
  aMessage: string,
  aCommitFlags = 0,
): BOARD {
  const kb = aNext.k ?? aPrev?.k;

  if (!kb) throw new Error('commitViewToBoard: the view has no BOARD');

  if (aFrame.GetBoard() !== kb) aFrame.SetBoard(kb);

  const commit = new BOARD_COMMIT(aFrame);
  const before = boardItems(kb);

  // What changed: the same model reached through a different view object.
  const prevByK = new Map<BOARD_ITEM, ViewItem>();

  if (aPrev) {
    for (const list of viewLists(aPrev)) for (const it of list) if (it.k) prevByK.set(it.k, it);
  }

  for (const list of viewLists(aNext)) {
    for (const it of list) {
      if (!it.k || !before.has(it.k)) continue;

      const was = prevByK.get(it.k);

      if (was !== it) commit.Modify(it.k);
    }
  }

  // The write-back: the BOARD's lists become the view's, through BOARD::Add / Remove.
  boardToBOARD(aNext);

  const after = boardItems(kb);

  for (const k of after) if (!before.has(k)) commit.Added(k);
  for (const k of before) if (!after.has(k)) commit.Removed(k);

  if (!commit.Empty()) commit.Push(aMessage, aCommitFlags);

  return kb;
}
