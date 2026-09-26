// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_library_parity.cpp`, the provider half; the
 * compare functions (`FOOTPRINT::FootprintNeedsUpdate` and its helpers) are
 * in `footprint_needs_update.ts`.
 *
 * Library parity test.
 *
 * Errors generated:
 * - DRCE_LIB_FOOTPRINT_ISSUES
 * - DRCE_LIB_FOOTPRINT_MISMATCH
 */
import { IO_ERROR } from '@ziroeda/common/ki_exception.js';
import { UNDEFINED_LAYER } from '@ziroeda/common/layer_ids.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import { FootprintNeedsUpdate } from '../footprint_needs_update.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_LIBRARY_PARITY extends DRC_TEST_PROVIDER {
  constructor() {
    super();
    this.m_isRuleDriven = false;
  }

  override GetName(): string {
    return 'library_parity';
  }

  Run(): boolean {
    const board = this.m_drcEngine!.GetBoard()!;
    // PROJECT* project = board->GetProject(): the host's adapter stands in for the project.
    const adapter = board.GetFootprintLibAdapter();

    if (!adapter) {
      this.REPORT_AUX('No project loaded, skipping library parity tests.');
      return true; // Continue with other tests
    }

    if (!this.reportPhase('Loading footprint library table...')) return false; // DRC cancelled

    /** `std::map<LIB_ID, std::shared_ptr<FOOTPRINT>>`, keyed by the LIB_ID's string form. */
    const libFootprintCache = new Map<string, FOOTPRINT>();

    let msg: string;
    let ii = 0;
    const progressDelta = 250;

    if (!this.reportPhase('Checking board footprints against library...')) return false;

    for (const footprint of board.Footprints()) {
      if (
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES) &&
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH)
      ) {
        return true; // Continue with other tests
      }

      if (!this.reportProgress(ii++, board.Footprints().length, progressDelta)) return false; // DRC cancelled

      const fpID = footprint.GetFPID();
      const libName = fpID.GetLibNickname();
      const fpName = fpID.GetLibItemName();

      if (libName === '') {
        // Not much we can do here
        continue;
      }

      const libTableRow = adapter.GetRow(libName);

      if (!libTableRow) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)!;
          msg = `The current configuration does not include the footprint library '${unescapeString(libName)}'`;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetCenter(), UNDEFINED_LAYER);
        }

        continue;
      } else if (!adapter.HasLibrary(libName, true)) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)!;
          msg = `The footprint library '${unescapeString(libName)}' is not enabled in the current configuration`;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetCenter(), UNDEFINED_LAYER);
        }

        continue;
      } else if (!adapter.IsLibraryLoaded(libName)) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)!;
          msg = `The footprint library '${unescapeString(libName)}' was not found at '${adapter.GetFullURI(libTableRow, true)}'`;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetCenter(), UNDEFINED_LAYER);
        }

        continue;
      }

      const cacheKey = fpID.GetUniStringLibId();
      let libFootprint: FOOTPRINT | null = libFootprintCache.get(cacheKey) ?? null;

      if (libFootprint === null) {
        try {
          libFootprint = adapter.LoadFootprint(libName, fpName, true);

          if (libFootprint) libFootprintCache.set(cacheKey, libFootprint);
        } catch (e) {
          if (!(e instanceof IO_ERROR)) throw e;
        }
      }

      if (!libFootprint) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)!;
          msg = `Footprint '${fpName}' not found in library '${libName}'`;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetCenter(), UNDEFINED_LAYER);
        }
      } else if (FootprintNeedsUpdate(footprint, libFootprint, BOARD_ITEM.COMPARE_FLAGS.DRC)) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH)) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH)!;
          msg = `Footprint '${fpName}' does not match copy in library '${libName}'`;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetCenter(), UNDEFINED_LAYER);
        }
      }
    }

    return true;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_LIBRARY_PARITY);
