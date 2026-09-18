// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_footprint_checks.cpp`.
 *
 * Footprint tests:
 * - DRCE_FOOTPRINT_TYPE_MISMATCH,
 * - DRCE_OVERLAPPING_PADS,
 * - DRCE_PAD_TH_WITH_NO_HOLE,
 * - DRCE_PADSTACK,
 * - DRCE_PADSTACK_INVALID,
 * - DRCE_FOOTPRINT (unknown or duplicate pads in net-tie pad groups),
 * - DRCE_SHORTING_ITEMS
 */
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_FOOTPRINT_CHECKS extends DRC_TEST_PROVIDER {
  constructor() {
    super();
    this.m_isRuleDriven = false;
  }

  override GetName(): string {
    return 'footprint checks';
  }

  Run(): boolean {
    if (!this.reportPhase('Checking footprints...')) return false; // DRC cancelled

    const errorHandler = (
      aItemA: BOARD_ITEM | null,
      aItemB: BOARD_ITEM | null,
      aItemC: BOARD_ITEM | null,
      aErrorCode: number,
      aMsg: string,
      aPt: VECTOR2I,
      aLayer: PCB_LAYER_ID,
    ): void => {
      const drcItem = DRC_ITEM.Create(aErrorCode)!;

      if (aMsg.length > 0) drcItem.SetErrorDetail(aMsg);

      drcItem.SetItems(aItemA, aItemB, aItemC);

      this.reportViolation(drcItem, aPt, aLayer);
    };

    for (const footprint of this.m_drcEngine!.GetBoard()!.Footprints()) {
      if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH)) {
        footprint.CheckFootprintAttributes((aMsg: string) => {
          errorHandler(
            footprint,
            null,
            null,
            PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH,
            aMsg,
            footprint.GetPosition(),
            footprint.GetLayer(),
          );
        });
      }

      if (
        !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_PAD_TH_WITH_NO_HOLE) ||
        !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_PADSTACK)
      ) {
        footprint.CheckPads(this.m_drcEngine!, (aPad: PAD, aErrorCode: number, aMsg: string) => {
          if (!this.m_drcEngine!.IsErrorLimitExceeded(aErrorCode)) {
            errorHandler(
              aPad,
              null,
              null,
              aErrorCode,
              aMsg,
              aPad.GetPosition(),
              aPad.GetPrincipalLayer(),
            );
          }
        });
      }

      // Don't call footprint->CheckShortingPads().  At the board level we know about nets,
      // and the pads may have the same net even though they're distinct pads.

      if (footprint.IsNetTie()) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SHORTING_ITEMS)) {
          footprint.CheckNetTies(
            (
              aItemA: BOARD_ITEM,
              aItemB: BOARD_ITEM,
              aItemC: BOARD_ITEM | null,
              aPosition: VECTOR2I,
            ) => {
              errorHandler(
                aItemA,
                aItemB,
                aItemC,
                PCB_DRC_CODE.DRCE_SHORTING_ITEMS,
                '',
                aPosition,
                footprint.GetLayer(),
              );
            },
          );
        }

        footprint.CheckNetTiePadGroups((aMsg: string) => {
          errorHandler(
            footprint,
            null,
            null,
            PCB_DRC_CODE.DRCE_FOOTPRINT,
            aMsg,
            footprint.GetPosition(),
            footprint.GetLayer(),
          );
        });
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_FOOTPRINT_CHECKS);
