// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `pcbnew/netlist_reader/netlist.cpp`, which is three
 * `PCB_EDIT_FRAME` methods: `ReadNetlistFromFile`, `OnNetlistChanged` and
 * `LoadFootprints`. They read the frame's board and library table, so each is a
 * function over a small `NETLIST_FRAME` host (what the frame is asked for), and
 * the frame in `pcb_edit_frame_ui.tsx` supplies the host.
 */
import { KIID_PATH, type KIID } from '@ziroeda/common/kiid.js';
import type { NETLIST, COMPONENT } from '@ziroeda/common/netlist_reader/netlist.js';
import { fpidIsLegacy, fpidItemName } from '@ziroeda/common/netlist_reader/netlist.js';
import { loadNetlist } from '@ziroeda/common/netlist_reader/netlist_reader.js';
import {
  type Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { FOOTPRINT } from '../footprint.js';
import { PCB_COMPONENT } from './pcb_component.js';

/** What netlist.cpp asks its PCB_EDIT_FRAME for. */
export interface NETLIST_FRAME {
  /** `m_pcb->FindFootprintByPath`. */
  FindFootprintByPath(aPath: readonly KIID[]): FOOTPRINT | null;
  /** `m_pcb->FindFootprintByReference`. */
  FindFootprintByReference(aReference: string): FOOTPRINT | null;
  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )->Rows().empty()`, negated. */
  HasFootprintLibraries(): boolean;
  /** `PCB_BASE_FRAME::loadFootprint( LIB_ID )`; the nickname may be blank. */
  loadFootprint(aFPID: string): FOOTPRINT | null;
  /** `DisplayErrorMessage( this, msg )`. */
  DisplayErrorMessage(aMessage: string): void;
  /** `SetLastPath( LAST_PATH_NETLIST, aFilename )`. */
  SetLastPath(aFilename: string): void;
}

/**
 * `PCB_EDIT_FRAME::ReadNetlistFromFile`. The browser has the file's text, not a
 * path, so the caller passes both; the path only feeds LAST_PATH_NETLIST.
 */
export function ReadNetlistFromFile(
  aFrame: NETLIST_FRAME,
  aFilename: string,
  aText: string,
  aNetlist: NETLIST,
  aReporter: Reporter,
): boolean {
  try {
    const loaded = loadNetlist(aText);

    if (!loaded) {
      aFrame.DisplayErrorMessage(`Cannot open netlist file '${aFilename}'.`);
      return false;
    }

    aFrame.SetLastPath(aFilename);

    for (const component of loaded.netlist.Components()) aNetlist.AddComponent(component);

    for (const group of loaded.netlist.Groups()) aNetlist.AddGroup(group);

    LoadFootprints(aFrame, aNetlist, aReporter);
  } catch (ioe) {
    aFrame.DisplayErrorMessage(`Error loading netlist.\n${(ioe as Error).message}`);
    return false;
  }

  aFrame.SetLastPath(aFilename);
  return true;
}

/** `PCB_EDIT_FRAME::LoadFootprints`. */
export function LoadFootprints(
  aFrame: NETLIST_FRAME,
  aNetlist: NETLIST,
  aReporter: Reporter,
): void {
  let lastFPID = '';
  let footprint: FOOTPRINT | null = null;
  let fpOnBoard: FOOTPRINT | null = null;

  if (aNetlist.IsEmpty() || !aFrame.HasFootprintLibraries()) return;

  aNetlist.SortByFPID();

  for (let ii = 0; ii < aNetlist.GetCount(); ii++) {
    const component: COMPONENT = aNetlist.GetComponent(ii)!;
    const fpid = component.GetFPID();

    // The FPID is ok as long as there is a footprint portion coming from eeschema.
    if (!fpidItemName(fpid).length) {
      aReporter.report(
        `No footprint defined for symbol ${component.GetReference()}.`,
        RPT_SEVERITY_ERROR,
      );
      continue;
    }

    // Check if component footprint is already on BOARD and only load the footprint from
    // the library if it's needed.  Nickname can be blank.
    if (aNetlist.IsFindByTimeStamp()) {
      for (const uuid of component.kiids) {
        const path = new KIID_PATH(component.path);
        path.push_back(uuid);

        fpOnBoard = aFrame.FindFootprintByPath(path.steps());

        if (fpOnBoard) break;
      }
    } else {
      fpOnBoard = aFrame.FindFootprintByReference(component.GetReference());
    }

    // When the schematic-side FPID has no library nickname (legacy format), match
    // only by item name so we don't flag a mismatch against a fully qualified board FPID.
    let footprintMisMatch = false;

    if (fpOnBoard) {
      footprintMisMatch = fpidIsLegacy(fpid)
        ? fpOnBoard.GetFPID().GetLibItemName() !== fpidItemName(fpid)
        : fpOnBoard.GetFPIDAsString() !== fpid;
    }

    if (footprintMisMatch && !aNetlist.GetReplaceFootprints()) {
      aReporter.report(
        `Footprint of ${component.GetReference()} changed: board footprint ` +
          `'${fpOnBoard!.GetFPIDAsString()}', netlist footprint '${fpid}'.`,
        RPT_SEVERITY_WARNING,
      );
      continue;
    }

    if (!aNetlist.GetReplaceFootprints()) footprintMisMatch = false;

    if (fpOnBoard && !footprintMisMatch) continue; // nothing else to do here

    if (fpid !== lastFPID) {
      footprint = null;

      // loadFootprint() can find a footprint with an empty nickname in fpid.
      footprint = aFrame.loadFootprint(fpid);

      if (footprint) {
        lastFPID = fpid;
      } else {
        aReporter.report(
          `${component.GetReference()} footprint '${fpidItemName(fpid)}' not found in any ` +
            'libraries in the footprint library table.',
          RPT_SEVERITY_ERROR,
        );
        continue;
      }
    } else {
      // Footprint already loaded from a library, duplicate it (faster)
      if (!footprint) continue; // Footprint does not exist in any library.

      footprint = FOOTPRINT.copyOfFootprint(footprint);
      footprint.ResetUuidDirect();
    }

    if (footprint && component instanceof PCB_COMPONENT) component.SetFootprint(footprint);
  }
}

/** What `PCB_EDIT_FRAME::OnNetlistChanged` does to the frame, in order. */
export interface NETLIST_CHANGED_FRAME {
  /** `SetMsgPanel( board )`. */
  SetMsgPanel(): void;
  /** `board->SynchronizeNetsAndNetClasses( false )`. */
  SynchronizeNetsAndNetClasses(): void;
  /** Invalidate + `RebuildRequiredCaches` on the component class manager. */
  RebuildComponentClasses(): void;
  /** `drcTool->GetDRCEngine()->InitEngine( GetDesignRulesPath() )`; parse errors swallowed by the caller. */
  InitDrcEngine(): void;
  /** `UpdateAllItemsConditionally` over net names and text variables. */
  RepaintNetLabelsAndTextVars(): void;
  /** `ACTIONS::selectionClear`. */
  ClearSelection(): void;
  /** `SpreadFootprints( &newFootprints, { 0, 0 }, true )`. */
  SpreadFootprints(aFootprints: FOOTPRINT[]): void;
  /** `ACTIONS::selectItems`. */
  SelectItems(aItems: FOOTPRINT[]): void;
  /** `Compile_Ratsnest( true )`. */
  Compile_Ratsnest(): void;
  /** `UpdateVariantSelectionCtrl()`. */
  UpdateVariantSelectionCtrl(): void;
  /** `GetCanvas()->Refresh()`. */
  Refresh(): void;
}

/**
 * `PCB_EDIT_FRAME::OnNetlistChanged`.
 * @returns `*aRunDragCommand`: true when there are new footprints to drag.
 */
export function OnNetlistChanged(
  aFrame: NETLIST_CHANGED_FRAME,
  aAddedFootprints: FOOTPRINT[],
): boolean {
  aFrame.SetMsgPanel();
  aFrame.SynchronizeNetsAndNetClasses();
  aFrame.RebuildComponentClasses();

  try {
    aFrame.InitDrcEngine();
  } catch {
    // PARSE_ERROR: the rules file is bad; upstream ignores it here.
  }

  aFrame.RepaintNetLabelsAndTextVars();
  aFrame.ClearSelection();
  aFrame.SpreadFootprints(aAddedFootprints);

  let runDragCommand = false;

  if (aAddedFootprints.length > 0) {
    aFrame.SelectItems(aAddedFootprints);
    runDragCommand = true;
  }

  aFrame.Compile_Ratsnest();
  aFrame.UpdateVariantSelectionCtrl();
  aFrame.Refresh();
  return runDragCommand;
}
