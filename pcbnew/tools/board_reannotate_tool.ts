// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_REANNOTATE_TOOL` (pcbnew/tools/board_reannotate_tool.cpp), the part
 * that runs on live items: `ReannotateDuplicates`, which gives each selected
 * footprint whose reference another footprint already holds the next free
 * number of its prefix. The Geographical Reannotate dialog is
 * `dialogs/dialog_board_reannotate.ts`, whose view-model
 * `reannotateDuplicates` this supersedes once the paste path is live.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { GetRefDesNumber, GetRefDesPrefix } from '@ziroeda/common/refdes_utils.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';

/** A selection's footprints, and those of any group in it, recursively. */
function footprintsOf(aItems: Iterable<EDA_ITEM>, aOut: FOOTPRINT[]): void {
  for (const item of aItems) {
    if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) aOut.push(item as FOOTPRINT);

    if (item.Type() === KICAD_T.PCB_GROUP_T) {
      (item as BOARD_ITEM).RunOnChildren((aGroupItem: BOARD_ITEM) => {
        if (aGroupItem.Type() === KICAD_T.PCB_FOOTPRINT_T) aOut.push(aGroupItem as FOOTPRINT);
      }, RECURSE_MODE.RECURSE);
    }
  }
}

export class BOARD_REANNOTATE_TOOL {
  private readonly m_board: BOARD;

  constructor(aBoard: BOARD) {
    this.m_board = aBoard;
  }

  /**
   * `ReannotateDuplicates` (board_reannotate_tool.cpp:78-192). The designators
   * of the board and of `aAdditionalFootprints` (items not on the board yet,
   * such as an array's earlier copies) are taken; the selection's footprints
   * are sorted by reference, then y descending, x ascending, then UUID, and
   * each one that clashes with another footprint climbs its number until it
   * is free. A vacated designator is never freed, as upstream.
   */
  ReannotateDuplicates(
    aSelectionToReannotate: Iterable<EDA_ITEM>,
    aAdditionalFootprints: readonly EDA_ITEM[],
  ): number {
    const selection = [...aSelectionToReannotate];

    if (selection.length === 0) return 0;

    // 1. Build list of designators on the board & the additional footprints
    const fpOnBoard: FOOTPRINT[] = [...this.m_board.Footprints()];
    footprintsOf(aAdditionalFootprints, fpOnBoard);

    const usedDesignatorsMap = new Map<string, KIID[]>();
    const insert = (aRef: string, aUuid: KIID): void => {
      const list = usedDesignatorsMap.get(aRef);
      if (list) list.push(aUuid);
      else usedDesignatorsMap.set(aRef, [aUuid]);
    };

    for (const fp of fpOnBoard) insert(fp.GetReference(), fp.m_Uuid);

    // 2. Get a sorted list of footprints from the selection
    const fpInSelection: FOOTPRINT[] = [];
    footprintsOf(selection, fpInSelection);

    fpInSelection.sort((aA, aB) => {
      const ii = strNumCmp(aA.GetReference(), aB.GetReference(), true);

      if (ii !== 0) return ii;

      // Sort by position: x, then y
      const pa = aA.GetPosition();
      const pb = aB.GetPosition();

      if (pa.y !== pb.y) return pa.y > pb.y ? -1 : 1;
      if (pa.x !== pb.x) return pa.x < pb.x ? -1 : 1;

      // ensure a deterministic sort
      return aA.m_Uuid < aB.m_Uuid ? -1 : aA.m_Uuid > aB.m_Uuid ? 1 : 0;
    });

    // 3. Iterate through the sorted list of footprints
    for (const fp of fpInSelection) {
      const stem = GetRefDesPrefix(fp.GetReference());
      let value = GetRefDesNumber(fp.GetReference());
      let duplicate = false;

      for (;;) {
        const holders = usedDesignatorsMap.get(fp.GetReference());

        if (holders === undefined) break;

        if (holders.some((uuid) => uuid !== fp.m_Uuid)) duplicate = true;

        // The only designator in the board with this reference is the selected one
        if (!duplicate) break;

        if (value < 0) value = 1;
        else ++value;

        fp.SetReference(stem + String(value));
      }

      if (duplicate) insert(fp.GetReference(), fp.m_Uuid);
    }

    return 0;
  }
}
