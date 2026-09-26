// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_text_mirroring.cpp`.
 *
 * Text mirroring tests.
 * Errors generated:
 * - DRCE_MIRRORED_TEXT_ON_FRONT_LAYER
 * - DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER
 */
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_TEXT_MIRRORING extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'text_mirroring';
  }

  Run(): boolean {
    if (
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER) &&
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER)
    ) {
      this.REPORT_AUX('Text mirroring violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking text mirroring...')) return false; // DRC cancelled

    const topLayers = new LSET([
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.F_Fab,
    ]);
    const bottomLayers = new LSET([
      PCB_LAYER_ID.B_Cu,
      PCB_LAYER_ID.B_SilkS,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.B_Fab,
    ]);

    const checkTextMirroring = (
      item: BOARD_ITEM,
      text: EDA_TEXT,
      isMirrored: boolean,
      errorCode: number,
    ): void => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(errorCode)) return;

      const layerMatch =
        (isMirrored && topLayers.Contains(item.GetLayer())) ||
        (!isMirrored && bottomLayers.Contains(item.GetLayer()));

      if (layerMatch && text.IsMirrored() === isMirrored) {
        const drcItem = DRC_ITEM.Create(errorCode)!;

        drcItem.SetItems(item);

        this.reportViolation(drcItem, item.GetPosition(), item.GetLayer());
      }
    };

    const progressDelta = 500;
    let count = 0;
    let progressIndex = 0;

    const itemTypes: KICAD_T[] = [
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_TEXTBOX_T,
      KICAD_T.PCB_TABLECELL_T,
      KICAD_T.PCB_DIMENSION_T,
    ];

    this.forEachGeometryItem(
      itemTypes,
      topLayers.or(bottomLayers),
      (_item: BOARD_ITEM): boolean => {
        ++count;
        return true;
      },
    );

    this.forEachGeometryItem(itemTypes, topLayers.or(bottomLayers), (item: BOARD_ITEM): boolean => {
      if (!this.reportProgress(progressIndex++, count, progressDelta)) return false;

      if (item instanceof EDA_TEXT) {
        const text = item as unknown as EDA_TEXT;

        if (
          !text.IsVisible() ||
          !this.m_drcEngine!.GetBoard()!.IsLayerEnabled(item.GetLayer()) ||
          !this.m_drcEngine!.GetBoard()!.IsLayerVisible(item.GetLayer())
        ) {
          return true;
        }

        checkTextMirroring(item, text, true, PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER);
        checkTextMirroring(item, text, false, PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER);
      }

      return true;
    });

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_TEXT_MIRRORING);
