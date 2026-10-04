// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOARD_NETLIST_UPDATER on the live BOARD, for the netlist tests: a view board
 * written into its BOARD (so a test may edit the view first), a frame that
 * answers what the updater asks, the dialog's setters, and the results read
 * back as the view the tests were written against.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/settings/settings_manager.js';
import type { NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import {
  BOARD_NETLIST_UPDATER,
  type NETLIST_FOOTPRINT_LOADER,
} from '@ziroeda/pcbnew/netlist_reader/board_netlist_updater.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { boardFromBOARD, boardToBOARD } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { ParseFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board } from '@ziroeda/pcbnew/types.js';
import { TEST_PCB_FRAME } from './test_pcb_frame.js';

/** The board editor frame's half the updater asks for, as PCB_EDIT_FRAME's. */
class UPDATE_FRAME extends TEST_PCB_FRAME {
  ExchangeFootprint(...args: Parameters<PCB_EDIT_FRAME['ExchangeFootprint']>): void {
    PCB_EDIT_FRAME.prototype.ExchangeFootprint.apply(this as unknown as PCB_EDIT_FRAME, args);
  }

  override PlaceFootprint(...args: Parameters<PCB_EDIT_FRAME['PlaceFootprint']>): void {
    PCB_EDIT_FRAME.prototype.PlaceFootprint.apply(this as unknown as PCB_EDIT_FRAME, args);
  }
}

export interface UpdateOptions {
  isDryRun?: boolean;
  replaceFootprints?: boolean;
  deleteUnusedFootprints?: boolean;
  lookupByTimestamp?: boolean;
  overrideLocks?: boolean;
  updateFields?: boolean;
  removeExtraFields?: boolean;
  transferGroups?: boolean;
}

export interface UpdateResult {
  board: Board;
  addedFootprints: number[];
  errorCount: number;
  warningCount: number;
  /** `m_newFootprintsCount`: one per footprint added or exchanged, from the report. */
  newFootprintCount: number;
}

/**
 * `loadFootprint` over library files keyed "nickname:name": a fresh footprint
 * each time, named by its library (FOOTPRINT_LIBRARY_ADAPTER's `SetFPID`), its
 * nets cleared; a bare name searches the libraries alphabetically.
 */
export function libraryLoader(aLibrary: ReadonlyMap<string, string>): NETLIST_FOOTPRINT_LOADER {
  return (aFpid: LIB_ID): FOOTPRINT | null => {
    let key: string | undefined = aFpid.Format();

    if (!aLibrary.has(key)) {
      if (!aFpid.IsLegacy()) return null;

      key = [...aLibrary.keys()]
        .sort()
        .find((k) => k.slice(k.indexOf(':') + 1) === aFpid.GetLibItemName());
    }

    if (!key) return null;

    const fp = ParseFootprintFile(aLibrary.get(key)!);
    const id = new LIB_ID();
    id.Parse(key);
    fp.SetFPID(id);
    fp.ClearAllNets();
    return fp;
  };
}

export function runLiveUpdate(
  board: Board,
  netlist: NETLIST,
  loader: NETLIST_FOOTPRINT_LOADER,
  options: UpdateOptions = {},
): { reporter: Reporter; result: UpdateResult; kb: BOARD } {
  const kb: BOARD = boardToBOARD(board);

  // A board in the editor always has its project (SynchronizeComponentClasses reads it).
  if (!kb.GetProject()) {
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('netlist_test.kicad_pro', {});
    kb.SetProject(manager.Prj());
  }

  const frame = new UPDATE_FRAME(kb);
  const reporter = new Reporter();
  const updater = new BOARD_NETLIST_UPDATER(frame, kb, loader);
  updater.SetReporter(reporter);
  updater.SetIsDryRun(options.isDryRun ?? false);
  updater.SetReplaceFootprints(options.replaceFootprints ?? true);
  updater.SetDeleteUnusedFootprints(options.deleteUnusedFootprints ?? false);
  updater.SetLookupByTimestamp(options.lookupByTimestamp ?? false);
  updater.SetOverrideLocks(options.overrideLocks ?? false);
  updater.SetUpdateFields(options.updateFields ?? false);
  updater.SetRemoveExtraFields(options.removeExtraFields ?? false);
  updater.SetTransferGroups(options.transferGroups ?? false);
  updater.UpdateNetlist(netlist);

  return {
    reporter,
    kb,
    result: {
      board: boardFromBOARD(kb, board.fileName),
      addedFootprints: updater.GetAddedFootprints().map((fp) => kb.Footprints().indexOf(fp)),
      errorCount: updater.GetErrorCount(),
      warningCount: updater.GetWarningCount(),
      newFootprintCount: reporter.lines.filter((l) =>
        /^(Add|Added) \S+ \(footprint|^(Change|Changed) \S+ footprint from/.test(l.message),
      ).length,
    },
  };
}
