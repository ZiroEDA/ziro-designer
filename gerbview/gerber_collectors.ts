// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBER_COLLECTOR` (gerbview/gerber_collectors.h, gerber_collectors.cpp):
 * the items under a point, by each item's own `HitTest`.
 */
import { COLLECTOR } from '@ziroeda/common/collector.js';
import { type EDA_ITEM, INSPECT_RESULT } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export class GERBER_COLLECTOR extends COLLECTOR {
  constructor() {
    super();
    this.SetScanTypes([
      KICAD_T.GERBER_LAYOUT_T,
      KICAD_T.GERBER_IMAGE_T,
      KICAD_T.GERBER_DRAW_ITEM_T,
    ]);
  }

  /**
   * The examining function within the INSPECTOR which is passed to the iterate function.
   *
   * @param testItem is an EDA_ITEM to examine.
   * @param testData is not used here.
   * @return SEARCH_QUIT if the iterator is to stop the scan, else SCAN_CONTINUE.
   */
  override Inspect(testItem: EDA_ITEM, _testData: unknown): INSPECT_RESULT {
    if (testItem.HitTest(this.m_refPos)) this.Append(testItem);

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Scan an EDA_ITEM using this class's Inspector method, which does the collection.
   *
   * @param aItem An EDA_ITEM to scan
   * @param aScanTypes A list of KICAD_Ts that specs what is to be collected and the priority
   *                   order of the resultant collection in "m_list".
   * @param aRefPos A VECTOR2I to use in hit-testing.
   */
  Collect(aItem: EDA_ITEM, aScanTypes: readonly KICAD_T[], aRefPos: VECTOR2I): void {
    this.Empty(); // empty the collection, primary criteria list

    this.SetScanTypes(aScanTypes);

    // remember where the snapshot was taken from and pass refPos to
    // the Inspect() function.
    this.SetRefPos(aRefPos);

    aItem.Visit(this.m_inspector, null, this.m_scanTypes);
  }
}
