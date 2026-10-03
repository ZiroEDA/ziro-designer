// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reconciling a board against a netlist. Counterpart:
 * `pcbnew/netlist_reader/board_netlist_updater.cpp` (BOARD_NETLIST_UPDATER), the
 * engine behind "Update PCB from Schematic" and "Import Netlist".
 *
 * The process, as the upstream class documents it:
 *  - a component in the netlist with no footprint on the board gets one added;
 *  - a component already on the board has its footprint replaced when the assigned
 *    footprint changed, and its reference, value, fields, fabrication attributes,
 *    sheet name/file and symbol link brought up to date;
 *  - every pad's net is then set from the netlist, adding nets the board did not
 *    have and disconnecting pads the schematic no longer connects;
 *  - zones and stitching vias left on a net that no longer exists are moved to the
 *    net their connected pads went to, so a rename does not orphan copper;
 *  - finally, unmatched footprints are removed if asked, and nets that ended up
 *    with nothing on them are dropped.
 *
 * Every step reports what it did (or, in a dry run, what it *would* do) through a
 * {@link Reporter}, in the present tense for a dry run and the past tense for the
 * real thing, the two strings upstream keeps side by side, so the dialog's
 * "Changes to Be Applied" and "Changes Applied to PCB" read correctly.
 *
 * On the live BOARD through one BOARD_COMMIT, "Update Netlist", as upstream.
 * Design variants are not modeled in the netlist yet, so their branches are
 * absent; with no variants they do nothing upstream either.
 *
 * TRANSITIONAL: `placeFootprint` / `exchangeFootprint` at the end are the view
 * board's helpers, kept for their remaining callers.
 */

import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  Reporter,
} from '@ziroeda/common/reporter.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { messageTextFromValue } from '@ziroeda/common/eda_units.js';
import { EscapeHTML, unescapeString as UnescapeString } from '@ziroeda/common/string_utils.js';
import {
  kiidFromName as KIID_FromName,
  kiidPathAsString,
  niluuid,
  type KIID,
} from '@ziroeda/common/kiid.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT, ZONE_FILL_OP } from '../board_commit.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_JUST_ADDED,
  type FOOTPRINT,
  type FP_UNIT_INFO,
} from '../footprint.js';
import { NETINFO_ITEM } from '../netinfo_item.js';
import { NETINFO_LIST } from '../netinfo_list.js';
import type { PAD } from '../pad.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_FIELD } from '../pcb_field.js';
import { PCB_GROUP } from '../pcb_group.js';
import type { ZONE } from '../zone.js';
import type { COMPONENT_CLASS } from '../component_classes/component_class.js';
import { COMPONENT_CLASS_MANAGER } from '../component_classes/component_class_manager.js';
import { kiidFromString, newKiid } from '@ziroeda/common/kiid.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { footprintViewOfBoard } from '../pcb_io/kicad_sexpr/board_view.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { type PcbFootprint } from '../types.js';
import { fpidIsLegacy, fpidItemName, type COMPONENT, type NETLIST } from './pcb_netlist.js';

/**
 * The frame half BOARD_NETLIST_UPDATER asks for. Upstream's `m_frame` is the
 * PCB_EDIT_FRAME; a test can hand any frame that answers these.
 */
export interface NETLIST_UPDATER_FRAME extends PCB_BASE_EDIT_FRAME {
  /**
   * `PCB_EDIT_FRAME::ExchangeFootprint( aExisting, aNew, aCommit )`, with its
   * defaults (every reset on).
   */
  ExchangeFootprint(
    aExisting: FOOTPRINT,
    aNew: FOOTPRINT,
    aCommit: BOARD_COMMIT,
    deleteExtraTexts: boolean,
    resetTextLayers: boolean,
    resetTextEffects: boolean,
    resetTextPositions: boolean,
    resetTextContent: boolean,
    resetFabricationAttrs: boolean,
    resetClearanceOverrides: boolean,
    reset3DModels: boolean,
    updated?: { value: boolean },
  ): void;
}

/**
 * `m_frame->LoadFootprint( aFootprintId )`, answered synchronously: a browser
 * reads its libraries asynchronously, so the caller loads every footprint the
 * netlist names before the update runs, and hands each one out fresh.
 */
export type NETLIST_FOOTPRINT_LOADER = (aFootprintId: LIB_ID) => FOOTPRINT | null;

/**
 * `BOARD_NETLIST_UPDATER` (board_netlist_updater.cpp): update the BOARD with a
 * new netlist, through one BOARD_COMMIT, "Update Netlist".
 *
 * Design variants (`COMPONENT::GetVariants`, the board's variant registry and
 * `applyComponentVariants`) are not modeled in the netlist yet; with no
 * variants every one of those branches is a no-op upstream too.
 */
export class BOARD_NETLIST_UPDATER {
  private m_frame: NETLIST_UPDATER_FRAME;
  private m_commit: BOARD_COMMIT;
  private m_board: BOARD;
  private m_reporter: Reporter = new Reporter();
  private readonly m_loadFootprint: NETLIST_FOOTPRINT_LOADER;

  private m_padNets = new Map<PAD, string>();
  private m_padPinFunctions = new Map<PAD, string>();
  private m_addedFootprints: FOOTPRINT[] = [];
  private m_addedNets = new Map<string, NETINFO_ITEM>();
  private m_addedGroups: PCB_GROUP[] = [];
  private m_oldToNewNets = new Map<string, string>();
  private m_schematicNetNames = new Set<string>();
  private m_zoneConnectionsCache = new Map<ZONE, PAD[]>();

  private m_deleteUnusedFootprints = false;
  private m_isDryRun = false;
  private m_replaceFootprints = true;
  private m_lookupByTimestamp = false;
  private m_transferGroups = false;
  private m_overrideLocks = false;
  private m_updateFields = false;
  private m_removeExtraFields = false;

  private m_warningCount = 0;
  private m_errorCount = 0;
  private m_newFootprintsCount = 0;

  constructor(
    aFrame: NETLIST_UPDATER_FRAME,
    aBoard: BOARD,
    aLoadFootprint: NETLIST_FOOTPRINT_LOADER,
  ) {
    this.m_frame = aFrame;
    this.m_commit = new BOARD_COMMIT(aFrame);
    this.m_board = aBoard;
    this.m_loadFootprint = aLoadFootprint;
  }

  SetReporter(aReporter: Reporter): void {
    this.m_reporter = aReporter;
  }

  /** Enable dry run mode (just report, no changes to PCB). */
  SetIsDryRun(aEnabled: boolean): void {
    this.m_isDryRun = aEnabled;
  }

  SetReplaceFootprints(aEnabled: boolean): void {
    this.m_replaceFootprints = aEnabled;
  }

  SetTransferGroups(aEnabled: boolean): void {
    this.m_transferGroups = aEnabled;
  }

  SetOverrideLocks(aOverride: boolean): void {
    this.m_overrideLocks = aOverride;
  }

  SetUpdateFields(aEnabled: boolean): void {
    this.m_updateFields = aEnabled;
  }

  SetRemoveExtraFields(aEnabled: boolean): void {
    this.m_removeExtraFields = aEnabled;
  }

  SetDeleteUnusedFootprints(aEnabled: boolean): void {
    this.m_deleteUnusedFootprints = aEnabled;
  }

  SetLookupByTimestamp(aEnabled: boolean): void {
    this.m_lookupByTimestamp = aEnabled;
  }

  GetAddedFootprints(): FOOTPRINT[] {
    return this.m_addedFootprints;
  }

  GetErrorCount(): number {
    return this.m_errorCount;
  }

  GetWarningCount(): number {
    return this.m_warningCount;
  }

  // These functions allow inspection of pad nets during dry runs by keeping a cache of
  // current pad netnames indexed by pad.

  private cacheNetname(aPad: PAD, aNetname: string): void {
    this.m_padNets.set(aPad, aNetname);
  }

  private getNetname(aPad: PAD): string {
    if (this.m_isDryRun && this.m_padNets.has(aPad)) return this.m_padNets.get(aPad)!;
    else return aPad.GetNetname();
  }

  private cachePinFunction(aPad: PAD, aPinFunction: string): void {
    this.m_padPinFunctions.set(aPad, aPinFunction);
  }

  private estimateFootprintInsertionPosition(): VECTOR2I {
    const bestPosition = { x: 0, y: 0 };

    if (!this.m_board.IsEmpty()) {
      // Position new components below any existing board features.
      const bbox = this.m_board.GetBoardEdgesBoundingBox();

      if (bbox.GetWidth() || bbox.GetHeight()) {
        bestPosition.x = bbox.Centre().x;
        bestPosition.y = bbox.GetBottom() + pcbIUScale.mmToIU(10);
      }
    } else {
      // Position new components in the center of the page when the board is empty.
      const pageSize = this.m_board.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS);

      bestPosition.x = Math.trunc(pageSize.x / 2);
      bestPosition.y = Math.trunc(pageSize.y / 2);
    }

    return bestPosition;
  }

  private addNewFootprint(aComponent: COMPONENT, aFootprintId: LIB_ID): FOOTPRINT | null {
    let msg: string;

    if (aFootprintId.empty()) {
      msg = `Cannot add ${aComponent.GetReference()} (no footprint assigned).`;
      this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
      ++this.m_errorCount;
      return null;
    }

    let footprint = this.m_loadFootprint(aFootprintId);

    if (footprint === null) {
      msg = `Cannot add ${aComponent.GetReference()} (footprint '${EscapeHTML(aFootprintId.Format())}' not found).`;
      this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
      ++this.m_errorCount;
      return null;
    }

    footprint.SetStaticComponentClass(
      this.m_board.GetComponentClassManager().GetNoneComponentClass(),
    );

    if (this.m_isDryRun) {
      msg = `Add ${aComponent.GetReference()} (footprint '${EscapeHTML(aFootprintId.Format())}').`;

      footprint = null;
    } else {
      for (const pad of footprint.Pads()) {
        // Set the pads ratsnest settings to the global settings
        pad.SetLocalRatsnestVisible(
          this.m_frame.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest,
        );

        // Pads in the library all have orphaned nets.  Replace with Default.
        pad.SetNetCode(0);
      }

      footprint.SetParent(this.m_board as unknown as BOARD_ITEM);
      footprint.SetPosition(this.estimateFootprintInsertionPosition());

      // This flag is used to prevent connectivity from considering the footprint during its
      // initial build after the footprint is committed, because we're going to immediately start
      // a move operation on the footprint and don't want its pads to drive nets onto vias/tracks
      // it happens to land on at the initial position.
      footprint.SetAttributes(footprint.GetAttributes() | FP_JUST_ADDED);

      this.m_addedFootprints.push(footprint);
      this.m_commit.Add(footprint);

      msg = `Added ${aComponent.GetReference()} (footprint '${EscapeHTML(aFootprintId.Format())}').`;
    }

    this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    this.m_newFootprintsCount++;
    return footprint;
  }

  private updateComponentClass(aFootprint: FOOTPRINT, aNewComponent: COMPONENT): boolean {
    let curClassName = '';
    let newClassName: string;
    let newClass: COMPONENT_CLASS | null = null;

    const curClass = aFootprint.GetStaticComponentClass();

    if (curClass) curClassName = curClass.GetName();

    // Calculate the new component class
    if (this.m_isDryRun) {
      newClassName = COMPONENT_CLASS_MANAGER.GetFullClassNameForConstituents(
        aNewComponent.GetComponentClassNames(),
      );
    } else {
      newClass = this.m_board
        .GetComponentClassManager()
        .GetEffectiveStaticComponentClass(aNewComponent.GetComponentClassNames());
      newClassName = newClass!.GetName();
    }

    if (curClassName === newClassName) return false;

    // Create a copy for undo if the footprint has not been added during this update
    let copy: FOOTPRINT | null = null;

    if (!this.m_isDryRun && !this.m_commit.GetStatus(aFootprint)) {
      copy = aFootprint.Clone() as FOOTPRINT;
      copy.SetParentGroup(null);
    }

    let msg: string;
    const ref = aFootprint.GetReference();

    if (this.m_isDryRun) {
      if (curClassName === '' && newClassName !== '')
        msg = `Change ${ref} component class to '${EscapeHTML(newClassName)}'.`;
      else if (curClassName !== '' && newClassName === '')
        msg = `Remove ${ref} component class (currently '${EscapeHTML(curClassName)}').`;
      else
        msg = `Change ${ref} component class from '${EscapeHTML(curClassName)}' to '${EscapeHTML(newClassName)}'.`;
    } else {
      aFootprint.SetStaticComponentClass(newClass);

      if (curClassName === '' && newClassName !== '')
        msg = `Changed ${ref} component class to '${EscapeHTML(newClassName)}'.`;
      else if (curClassName !== '' && newClassName === '')
        msg = `Removed ${ref} component class (was '${EscapeHTML(curClassName)}').`;
      else
        msg = `Changed ${ref} component class from '${EscapeHTML(curClassName)}' to '${EscapeHTML(newClassName)}'.`;
    }

    this.m_reporter.report(msg, RPT_SEVERITY_ACTION);

    if (copy) this.m_commit.Modified(aFootprint, copy);

    return true;
  }

  private replaceFootprint(
    _aNetlist: NETLIST,
    aFootprint: FOOTPRINT,
    aNewComponent: COMPONENT,
  ): FOOTPRINT | null {
    let msg: string;
    const newFpid = componentFpid(aNewComponent);

    if (newFpid.empty()) {
      msg = `Cannot update ${aNewComponent.GetReference()} (no footprint assigned).`;
      this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
      ++this.m_errorCount;
      return null;
    }

    const newFootprint = this.m_loadFootprint(newFpid);

    if (newFootprint === null) {
      msg = `Cannot update ${aNewComponent.GetReference()} (footprint '${EscapeHTML(newFpid.Format())}' not found).`;
      this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
      ++this.m_errorCount;
      return null;
    }

    const ref = aFootprint.GetReference();
    const from = EscapeHTML(aFootprint.GetFPID().Format());
    const to = EscapeHTML(newFpid.Format());

    if (this.m_isDryRun) {
      if (aFootprint.IsLocked() && !this.m_overrideLocks) {
        msg = `Cannot change ${ref} footprint from '${from}' to '${to}' (footprint is locked).`;
        this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
        ++this.m_warningCount;
        return null;
      } else {
        msg = `Change ${ref} footprint from '${from}' to '${to}'.`;
        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
        ++this.m_newFootprintsCount;
        return null;
      }
    } else {
      if (aFootprint.IsLocked() && !this.m_overrideLocks) {
        msg = `Could not change ${ref} footprint from '${from}' to '${to}' (footprint is locked).`;
        this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
        ++this.m_warningCount;
        return null;
      } else {
        // Expand the footprint pad layers
        newFootprint.FixUpPadsForBoard(this.m_board);

        this.m_frame.ExchangeFootprint(
          aFootprint,
          newFootprint,
          this.m_commit,
          true,
          true,
          true,
          true,
          false,
          true,
          true,
          true,
        );

        msg = `Changed ${ref} footprint from '${from}' to '${to}'.`;
        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
        ++this.m_newFootprintsCount;
        return newFootprint;
      }
    }
  }

  private updateFootprintParameters(aFootprint: FOOTPRINT, aNetlistComponent: COMPONENT): boolean {
    let msg: string;

    // `firstAssociatedVariant`: design variants are not modeled (no variant names a footprint).

    // Create a copy only if the footprint has not been added during this update
    let copy: FOOTPRINT | null = null;

    if (!this.m_commit.GetStatus(aFootprint)) {
      copy = aFootprint.Clone() as FOOTPRINT;
      copy.SetParentGroup(null);
    }

    let changed = false;

    // Test for reference designator field change.
    if (aFootprint.GetReference() !== aNetlistComponent.GetReference()) {
      if (this.m_isDryRun) {
        msg = `Change ${aFootprint.GetReference()} reference designator to ${aNetlistComponent.GetReference()}.`;
      } else {
        msg = `Changed ${aFootprint.GetReference()} reference designator to ${aNetlistComponent.GetReference()}.`;

        changed = true;
        aFootprint.SetReference(aNetlistComponent.GetReference());
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    // Test for value field change.
    const netlistValue = aNetlistComponent.GetValue();

    if (aFootprint.GetValue() !== netlistValue) {
      if (this.m_isDryRun) {
        msg = `Change ${aFootprint.GetReference()} value from ${EscapeHTML(aFootprint.GetValue())} to ${EscapeHTML(netlistValue)}.`;
      } else {
        msg = `Changed ${aFootprint.GetReference()} value from ${EscapeHTML(aFootprint.GetValue())} to ${EscapeHTML(netlistValue)}.`;

        changed = true;
        aFootprint.SetValue(netlistValue);
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    // Test for time stamp change.
    const new_path = componentSymbolPath(aNetlistComponent);

    if (!samePath(aFootprint.GetPath(), new_path)) {
      const fromPath = EscapeHTML(kiidPathAsString(aFootprint.GetPath()));
      const toPath = EscapeHTML(kiidPathAsString(new_path));

      if (this.m_isDryRun) {
        msg = `Update ${aFootprint.GetReference()} symbol association from ${fromPath} to ${toPath}.`;
      } else {
        msg = `Updated ${aFootprint.GetReference()} symbol association from ${fromPath} to ${toPath}.`;

        changed = true;
        aFootprint.SetPath(new_path);
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    const fpFieldsAsMap = new Map<string, string>();

    for (const field of aFootprint.GetFields()) {
      if (!field) continue;

      // These fields are individually checked above
      if (field.IsReference() || field.IsValue() || field.IsComponentClass()) continue;

      fpFieldsAsMap.set(field.GetName(), field.GetText());
    }

    // Remove the ref/value/footprint fields that are individually handled
    const compFields = new Map(aNetlistComponent.GetFields());
    compFields.delete(GetCanonicalFieldName(FIELD_T.REFERENCE));
    compFields.delete(GetCanonicalFieldName(FIELD_T.VALUE));
    compFields.delete(GetCanonicalFieldName(FIELD_T.FOOTPRINT));

    // Remove any component class fields - these are not editable in the pcb editor
    compFields.delete('Component Class');

    // Fields are stored as an ordered map, but we don't (yet) support reordering the footprint fields to
    // match the symbol, so we manually check the fields in the order they are stored in the symbol.
    let same = true;
    let remove_only = true;

    for (const [name, value] of compFields) {
      if (!fpFieldsAsMap.has(name) || fpFieldsAsMap.get(name) !== value) {
        same = false;
        remove_only = false;
        break;
      }
    }

    for (const name of fpFieldsAsMap.keys()) {
      if (!compFields.has(name)) {
        same = false;
        break;
      }
    }

    if (!same) {
      if (this.m_isDryRun) {
        if (this.m_updateFields && (!remove_only || this.m_removeExtraFields)) {
          msg = `Update ${aFootprint.GetReference()} fields.`;
          this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
        }

        // Remove fields that aren't present in the symbol
        for (const field of aFootprint.GetFields()) {
          if (!field || field.IsMandatory()) continue;

          if (!compFields.has(field.GetName())) {
            if (this.m_removeExtraFields) {
              msg = `Remove ${aFootprint.GetReference()} footprint fields not in symbol.`;
              this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
            }

            break;
          }
        }
      } else {
        if (this.m_updateFields && (!remove_only || this.m_removeExtraFields)) {
          msg = `Updated ${aFootprint.GetReference()} fields.`;
          this.m_reporter.report(msg, RPT_SEVERITY_ACTION);

          changed = true;

          // Add or change field value
          for (const [name, value] of compFields) {
            if (aFootprint.HasField(name)) {
              aFootprint.GetField(name)!.SetText(value);
            } else {
              const newField = new PCB_FIELD(aFootprint, FIELD_T.USER);
              aFootprint.Add(newField);

              newField.SetName(name);
              newField.SetText(value);
              newField.SetVisible(false);
              newField.SetLayer(
                aFootprint.GetLayer() === PCB_LAYER_ID.F_Cu
                  ? PCB_LAYER_ID.F_Fab
                  : PCB_LAYER_ID.B_Fab,
              );

              // Give the relative position (0,0) in footprint
              newField.SetPosition(aFootprint.GetPosition());
              // Give the footprint orientation
              newField.Rotate(aFootprint.GetPosition(), aFootprint.GetOrientation());

              newField.StyleFromSettings(this.m_frame.GetDesignSettings(), true);
            }
          }
        }

        if (this.m_removeExtraFields) {
          let warned = false;

          const fieldList: PCB_FIELD[] = [];
          aFootprint.GetFields(fieldList, false);

          for (const field of fieldList) {
            if (field.IsMandatory()) continue;

            if (!compFields.has(field.GetName())) {
              if (!warned) {
                warned = true;
                msg = `Removed ${aFootprint.GetReference()} footprint fields not in symbol.`;
                this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
              }

              aFootprint.Remove(field);

              this.m_frame.GetCanvas()?.GetView()?.Remove(field);
            }
          }
        }
      }
    }

    let sheetname = '';
    let sheetfile = '';
    let fpFilters = '';

    const humanSheetPath = aNetlistComponent.GetHumanReadablePath();
    const props = aNetlistComponent.GetProperties();

    if (humanSheetPath !== '') sheetname = humanSheetPath;
    else if (props.has('Sheetname')) sheetname = props.get('Sheetname')!;

    if (props.has('Sheetfile')) sheetfile = props.get('Sheetfile')!;

    if (props.has('ki_fp_filters')) fpFilters = props.get('ki_fp_filters')!;

    if (sheetname !== aFootprint.GetSheetname()) {
      if (this.m_isDryRun) {
        msg = `Update ${aFootprint.GetReference()} sheetname to '${EscapeHTML(sheetname)}'.`;
      } else {
        aFootprint.SetSheetname(sheetname);
        msg = `Updated ${aFootprint.GetReference()} sheetname to '${EscapeHTML(sheetname)}'.`;
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    if (sheetfile !== aFootprint.GetSheetfile()) {
      if (this.m_isDryRun) {
        msg = `Update ${aFootprint.GetReference()} sheetfile to '${EscapeHTML(sheetfile)}'.`;
      } else {
        aFootprint.SetSheetfile(sheetfile);
        msg = `Updated ${aFootprint.GetReference()} sheetfile to '${EscapeHTML(sheetfile)}'.`;
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    if (fpFilters !== aFootprint.GetFilters()) {
      if (this.m_isDryRun) {
        msg = `Update ${aFootprint.GetReference()} footprint filters to '${EscapeHTML(fpFilters)}'.`;
      } else {
        aFootprint.SetFilters(fpFilters);
        msg = `Updated ${aFootprint.GetReference()} footprint filters to '${EscapeHTML(fpFilters)}'.`;
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    const attribute = (aFlag: number, aWanted: boolean, aName: string): void => {
      if (!this.m_updateFields || aWanted === (aFootprint.GetAttributes() & aFlag) > 0) return;

      const ref = aFootprint.GetReference();

      if (this.m_isDryRun) {
        msg = aWanted
          ? `Add ${ref} '${aName}' fabrication attribute.`
          : `Remove ${ref} '${aName}' fabrication attribute.`;
      } else {
        let attributes = aFootprint.GetAttributes();

        if (aWanted) {
          attributes |= aFlag;
          msg = `Added ${ref} '${aName}' fabrication attribute.`;
        } else {
          attributes &= ~aFlag;
          msg = `Removed ${ref} '${aName}' fabrication attribute.`;
        }

        changed = true;
        aFootprint.SetAttributes(attributes);
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    };

    attribute(FP_EXCLUDE_FROM_BOM, props.has('exclude_from_bom'), 'exclude from BOM');
    attribute(FP_DNP, props.has('dnp'), 'Do not place');
    attribute(
      FP_EXCLUDE_FROM_POS_FILES,
      props.has('exclude_from_pos_files'),
      'exclude from position files',
    );

    if (
      this.m_updateFields &&
      aNetlistComponent.GetDuplicatePadNumbersAreJumpers() !==
        aFootprint.GetDuplicatePadNumbersAreJumpers()
    ) {
      const value = aNetlistComponent.GetDuplicatePadNumbersAreJumpers();
      const ref = aFootprint.GetReference();

      if (!this.m_isDryRun) {
        changed = true;
        aFootprint.SetDuplicatePadNumbersAreJumpers(value);

        msg = value
          ? `Added ${ref} 'duplicate pad numbers are jumpers' attribute.`
          : `Removed ${ref} 'duplicate pad numbers are jumpers' attribute.`;
      } else {
        msg = value
          ? `Add ${ref} 'duplicate pad numbers are jumpers' attribute.`
          : `Remove ${ref} 'duplicate pad numbers are jumpers' attribute.`;
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    if (
      this.m_updateFields &&
      !sameJumperGroups(aNetlistComponent.JumperPadGroups(), aFootprint.JumperPadGroups())
    ) {
      if (!this.m_isDryRun) {
        changed = true;
        const groups = aFootprint.JumperPadGroups();
        groups.length = 0;
        for (const g of aNetlistComponent.JumperPadGroups()) groups.push(new Set(g));
        msg = `Updated ${aFootprint.GetReference()} jumper pad groups`;
      } else {
        msg = `Update ${aFootprint.GetReference()} jumper pad groups`;
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    if (changed && copy) this.m_commit.Modified(aFootprint, copy);

    return true;
  }

  private updateFootprintGroup(aPcbFootprint: FOOTPRINT, aNetlistComponent: COMPONENT): boolean {
    if (!this.m_transferGroups) return false;

    let msg: string;

    // Create a copy only if the footprint has not been added during this update
    let copy: FOOTPRINT | null = null;

    if (!this.m_commit.GetStatus(aPcbFootprint)) {
      copy = aPcbFootprint.Clone() as FOOTPRINT;
      copy.SetParentGroup(null);
    }

    let changed = false;

    // These hold the info for group and group KIID coming from the netlist
    // newGroup may point to an existing group on the board if we find an
    // incoming group UUID that matches an existing group
    let newGroup: PCB_GROUP | null = null;
    const netlistGroup = aNetlistComponent.GetGroup();
    const newGroupKIID = netlistGroup ? kiidFromString(netlistGroup.uuid) : niluuid;

    const existingGroup = aPcbFootprint.GetParentGroup() as unknown as PCB_GROUP | null;
    const existingGroupKIID = existingGroup ? existingGroup.m_Uuid : niluuid;

    // Find existing group based on matching UUIDs
    const it = this.m_board.Groups().find((group) => group.m_Uuid === newGroupKIID);

    // If we find a group with the same UUID, use it
    if (it) newGroup = it;

    // No changes, nothing to do
    if (newGroupKIID === existingGroupKIID) return changed;

    // Remove from existing group
    if (existingGroupKIID !== niluuid) {
      if (this.m_isDryRun) {
        msg = `Remove ${aPcbFootprint.GetReference()} from group '${EscapeHTML(existingGroup!.GetName())}'.`;
      } else {
        msg = `Removed ${aPcbFootprint.GetReference()} from group '${EscapeHTML(existingGroup!.GetName())}'.`;

        changed = true;
        this.m_commit.Modify(existingGroup!, null, RECURSE_MODE.NO_RECURSE);
        existingGroup!.RemoveItem(aPcbFootprint);

        if (existingGroup!.GetItems().size < 2) {
          existingGroup!.RemoveAll();
          this.m_commit.Remove(existingGroup!);
        }
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    // Add to new group
    if (newGroupKIID !== niluuid) {
      if (this.m_isDryRun) {
        msg = `Add ${aPcbFootprint.GetReference()} to group '${EscapeHTML(netlistGroup!.name)}'.`;
      } else {
        msg = `Added ${aPcbFootprint.GetReference()} to group '${EscapeHTML(netlistGroup!.name)}'.`;

        changed = true;

        if (newGroup === null) {
          newGroup = new PCB_GROUP(this.m_board as unknown as BOARD_ITEM);
          newGroup.SetUuidDirect(newGroupKIID);
          newGroup.SetName(netlistGroup!.name);

          // Add the group to the board manually so we can find it by checking
          // board groups for later footprints that are checking for existing groups
          this.m_board.Add(newGroup);
          this.m_commit.Added(newGroup);
          this.m_addedGroups.push(newGroup);
        } else {
          this.m_commit.Modify(newGroup, null, RECURSE_MODE.NO_RECURSE);
        }

        newGroup.AddItem(aPcbFootprint);
      }

      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
    }

    if (changed && copy) this.m_commit.Modified(aPcbFootprint, copy);

    return changed;
  }

  private updateComponentPadConnections(aFootprint: FOOTPRINT, aNewComponent: COMPONENT): boolean {
    let msg: string;

    // Create a copy only if the footprint has not been added during this update
    let copy: FOOTPRINT | null = null;

    if (!this.m_isDryRun && !this.m_commit.GetStatus(aFootprint)) {
      copy = aFootprint.Clone() as FOOTPRINT;
      copy.SetParentGroup(null);
    }

    let changed = false;

    // At this point, the component footprint is updated.  Now update the nets.
    const pads = [...aFootprint.Pads()];
    const padNetnames = new Set<string>();

    pads.sort((a, b) => (a.m_Uuid < b.m_Uuid ? -1 : a.m_Uuid > b.m_Uuid ? 1 : 0));

    const ref = aFootprint.GetReference();

    for (const pad of pads) {
      const net = aNewComponent.GetNet(pad.GetNumber());

      let pinFunction = '';
      let pinType = '';

      if (net.IsValid()) {
        // i.e. the pad has a name
        pinFunction = net.GetPinFunction();
        pinType = net.GetPinType();
      }

      if (!this.m_isDryRun) {
        if (pad.GetPinFunction() !== pinFunction) {
          changed = true;
          pad.SetPinFunction(pinFunction);
        }

        if (pad.GetPinType() !== pinType) {
          changed = true;
          pad.SetPinType(pinType);
        }
      } else {
        this.cachePinFunction(pad, pinFunction);
      }

      // Test if new footprint pad has no net (pads not on copper layers have no net).
      if (!net.IsValid() || !pad.IsOnCopperLayer()) {
        if (pad.GetNetname() !== '') {
          if (this.m_isDryRun) msg = `Disconnect ${ref} pin ${EscapeHTML(pad.GetNumber())}.`;
          else msg = `Disconnected ${ref} pin ${EscapeHTML(pad.GetNumber())}.`;

          this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
        } else if (pad.IsOnCopperLayer() && pad.GetNumber() !== '') {
          // pad is connectable but has no net found in netlist
          msg = `No net found for component ${ref} pad ${EscapeHTML(pad.GetNumber())} (no pin ${EscapeHTML(pad.GetNumber())} in symbol).`;
          this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
          ++this.m_warningCount;
        }

        if (!this.m_isDryRun) {
          changed = true;
          pad.SetNetCode(NETINFO_LIST.UNCONNECTED);

          // If the pad has no net from netlist (i.e. not in netlist
          // it cannot have a pin function
          if (pad.GetNetname() === '') pad.SetPinFunction('');
        } else {
          this.cacheNetname(pad, '');
        }
      } else {
        // New footprint pad has a net.
        let netName = net.GetNetName();

        if (pad.IsNoConnectPad()) {
          netName = net.GetNetName();

          for (
            let jj = 1;
            padNetnames.has(netName) ||
            (netName !== net.GetNetName() && this.m_schematicNetNames.has(netName));
            jj++
          ) {
            netName = `${net.GetNetName()}_${jj}`;
          }

          padNetnames.add(netName);
        }

        let netinfo = this.m_board.FindNet(netName);

        if (netinfo && !this.m_isDryRun) netinfo.SetIsCurrent(true);

        if (pad.GetNetname() !== netName) {
          if (netinfo === null) {
            // It might be a new net that has not been added to the board yet
            if (this.m_addedNets.has(netName)) netinfo = this.m_addedNets.get(netName)!;
          }

          if (netinfo === null) {
            netinfo = new NETINFO_ITEM(this.m_board, netName);

            // It is a new net, we have to add it
            if (!this.m_isDryRun) {
              changed = true;
              this.m_commit.Add(netinfo);
            }

            this.m_addedNets.set(netName, netinfo);
            msg = `Add net ${EscapeHTML(UnescapeString(netName))}.`;
            this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
          }

          const pin = EscapeHTML(pad.GetNumber());
          const to = EscapeHTML(UnescapeString(netName));

          if (pad.GetNetname() !== '') {
            this.m_oldToNewNets.set(pad.GetNetname(), netName);

            const from = EscapeHTML(UnescapeString(pad.GetNetname()));

            if (this.m_isDryRun) msg = `Reconnect ${ref} pin ${pin} from ${from} to ${to}.`;
            else msg = `Reconnected ${ref} pin ${pin} from ${from} to ${to}.`;
          } else {
            if (this.m_isDryRun) msg = `Connect ${ref} pin ${pin} to ${to}.`;
            else msg = `Connected ${ref} pin ${pin} to ${to}.`;
          }

          this.m_reporter.report(msg, RPT_SEVERITY_ACTION);

          if (!this.m_isDryRun) {
            changed = true;
            pad.SetNet(netinfo);
          } else {
            this.cacheNetname(pad, netName);
          }
        }
      }
    }

    if (changed && copy) this.m_commit.Modified(aFootprint, copy);

    return true;
  }

  private updateComponentUnits(aFootprint: FOOTPRINT, aNewComponent: COMPONENT): boolean {
    // Build the footprint-side representation from the netlist component
    const newUnits: FP_UNIT_INFO[] = aNewComponent
      .GetUnitInfo()
      .map((u) => ({ m_unitName: u.unitName, m_pins: [...u.pins] }));

    const curUnits = aFootprint.GetUnitInfo();

    const unitsEqual = (a: readonly FP_UNIT_INFO[], b: readonly FP_UNIT_INFO[]): boolean => {
      if (a.length !== b.length) return false;

      for (let i = 0; i < a.length; ++i) {
        if (a[i]!.m_unitName !== b[i]!.m_unitName) return false;

        const ap = a[i]!.m_pins;
        const bp = b[i]!.m_pins;

        if (ap.length !== bp.length || ap.some((p, j) => p !== bp[j])) return false;
      }

      return true;
    };

    if (unitsEqual(curUnits, newUnits)) return false;

    let msg: string;

    if (this.m_isDryRun) {
      msg = `Update ${aFootprint.GetReference()} unit metadata.`;
      this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
      return false; // no actual change on board during dry run
    }

    // Create a copy only if the footprint has not been added during this update
    let copy: FOOTPRINT | null = null;

    if (!this.m_commit.GetStatus(aFootprint)) {
      copy = aFootprint.Clone() as FOOTPRINT;
      copy.SetParentGroup(null);
    }

    aFootprint.SetUnitInfo(newUnits);

    msg = `Updated ${aFootprint.GetReference()} unit metadata.`;
    this.m_reporter.report(msg, RPT_SEVERITY_ACTION);

    if (copy) this.m_commit.Modified(aFootprint, copy);

    return true;
  }

  private cacheCopperZoneConnections(): void {
    for (const zone of this.m_board.Zones()) {
      if (!zone.IsOnCopperLayer() || zone.GetIsRuleArea()) continue;

      this.m_zoneConnectionsCache.set(
        zone,
        this.m_board.GetConnectivity().GetConnectedPads(zone) as PAD[],
      );
    }
  }

  private updateCopperZoneNets(aNetlist: NETLIST): boolean {
    let msg: string;
    const netlistNetnames = new Set<string>();

    for (let ii = 0; ii < aNetlist.GetCount(); ii++) {
      const component = aNetlist.GetComponent(ii)!;

      for (let jj = 0; jj < component.GetNetCount(); jj++) {
        const net = component.GetNetAt(jj);
        netlistNetnames.add(net.GetNetName());
      }
    }

    for (const via of this.m_board.Tracks()) {
      if (via.Type() !== KICAD_T.PCB_VIA_T) continue;

      if (!netlistNetnames.has(via.GetNetname())) {
        let updatedNetname = '';

        // Take via name from name change map if it didn't match to a new pad
        // (this is useful for stitching vias that don't connect to tracks)
        if (this.m_oldToNewNets.has(via.GetNetname()))
          updatedNetname = this.m_oldToNewNets.get(via.GetNetname())!;

        if (updatedNetname !== '') {
          if (this.m_isDryRun) {
            const originalNetname = via.GetNetname();

            msg = `Reconnect via from ${EscapeHTML(UnescapeString(originalNetname))} to ${EscapeHTML(UnescapeString(updatedNetname))}.`;

            this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
          } else {
            const netinfo =
              this.m_board.FindNet(updatedNetname) ?? this.m_addedNets.get(updatedNetname) ?? null;

            if (netinfo) {
              const originalNetname = via.GetNetname();

              this.m_commit.Modify(via);
              via.SetNet(netinfo);

              msg = `Reconnected via from ${EscapeHTML(UnescapeString(originalNetname))} to ${EscapeHTML(UnescapeString(updatedNetname))}.`;

              this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
            }
          }
        } else {
          msg = `Via connected to unknown net (${EscapeHTML(UnescapeString(via.GetNetname()))}).`;
          this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
          ++this.m_warningCount;
        }
      }
    }

    // Board connectivity net names are not the same as schematic connectivity net names.
    // Footprints that contain multiple overlapping pads with the same number are suffixed
    // with "_N" for internal use.  Somewhere along the line, these pseudo net names were
    // exposed in the zone net name list.
    const isInNetlist = (aNetName: string): boolean => {
      if (netlistNetnames.has(aNetName)) return true;

      // If the zone net name is a pseudo net name, check if the root net name is in the net
      // list.  If so, then this is a valid net.
      for (const netName of netlistNetnames) {
        if (aNetName.startsWith(netName)) return true;
      }

      return false;
    };

    // Test copper zones to detect "dead" nets (nets without any pad):
    for (const zone of this.m_board.Zones()) {
      if (!zone.IsOnCopperLayer() || zone.GetIsRuleArea()) continue;

      if (!isInNetlist(zone.GetNetname())) {
        // Look for a pad in the zone's connected-pad-cache which has been updated to
        // a new net and use that. While this won't always be the right net, the dead
        // net is guaranteed to be wrong.
        let updatedNetname = '';

        for (const pad of this.m_zoneConnectionsCache.get(zone) ?? []) {
          if (this.getNetname(pad) !== zone.GetNetname()) {
            updatedNetname = this.getNetname(pad);
            break;
          }
        }

        // Take zone name from name change map if it didn't match to a new pad
        // (this is useful for zones on internal layers)
        if (updatedNetname === '' && this.m_oldToNewNets.has(zone.GetNetname()))
          updatedNetname = this.m_oldToNewNets.get(zone.GetNetname())!;

        if (updatedNetname !== '') {
          const from = EscapeHTML(UnescapeString(zone.GetNetname()));
          const to = EscapeHTML(UnescapeString(updatedNetname));

          if (this.m_isDryRun) {
            if (zone.GetZoneName() !== '')
              msg = `Reconnect copper zone '${zone.GetZoneName()}' from ${from} to ${to}.`;
            else msg = `Reconnect copper zone from ${from} to ${to}.`;

            this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
          } else {
            const netinfo =
              this.m_board.FindNet(updatedNetname) ?? this.m_addedNets.get(updatedNetname) ?? null;

            if (netinfo) {
              this.m_commit.Modify(zone);
              zone.SetNet(netinfo);

              if (zone.GetZoneName() !== '')
                msg = `Reconnected copper zone '${EscapeHTML(zone.GetZoneName())}' from ${from} to ${to}.`;
              else msg = `Reconnected copper zone from ${from} to ${to}.`;

              this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
            }
          }
        } else {
          if (zone.GetZoneName() !== '') {
            msg = `Copper zone '${EscapeHTML(zone.GetZoneName())}' has no pads connected.`;
          } else {
            const layerNames = zone.LayerMaskDescribe();
            const pt = { ...zone.GetPosition() };
            const display = this.m_frame.GetPcbNewSettings().m_Display;

            if (display.m_DisplayInvertXAxis) pt.x *= -1;

            if (display.m_DisplayInvertYAxis) pt.y *= -1;

            // `m_frame->MessageTextFromValue( … )`, in the frame's units.
            const text = (v: number): string =>
              messageTextFromValue(pcbIUScale, this.m_frame.GetUserUnits(), v);

            msg = `Copper zone on ${EscapeHTML(layerNames)} at (${text(pt.x)}, ${text(pt.y)}) has no pads connected to net "${zone.GetNetname()}".`;
          }

          this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
          ++this.m_warningCount;
        }
      }
    }

    return true;
  }

  private updateGroups(aNetlist: NETLIST): boolean {
    if (!this.m_transferGroups) return false;

    let msg: string;

    for (const pcbGroup of this.m_board.Groups()) {
      const netlistGroup = aNetlist.GetGroupByUuid(pcbGroup.m_Uuid);

      if (netlistGroup === null) continue;

      if (netlistGroup.name !== pcbGroup.GetName()) {
        if (this.m_isDryRun) {
          msg = `Change group name from '${EscapeHTML(pcbGroup.GetName())}' to '${EscapeHTML(netlistGroup.name)}'.`;
        } else {
          msg = `Changed group name from '${EscapeHTML(pcbGroup.GetName())}' to '${EscapeHTML(netlistGroup.name)}'.`;
          this.m_commit.Modify(pcbGroup, null, RECURSE_MODE.NO_RECURSE);
          pcbGroup.SetName(netlistGroup.name);
        }

        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
      }

      const libId = new LIB_ID();
      libId.Parse(netlistGroup.libId);

      if (libId.Format() !== pcbGroup.GetDesignBlockLibId().Format()) {
        if (this.m_isDryRun) {
          msg = `Change group library link from '${EscapeHTML(pcbGroup.GetDesignBlockLibId().GetUniStringLibId())}' to '${EscapeHTML(libId.GetUniStringLibId())}'.`;
        } else {
          msg = `Changed group library link from '${EscapeHTML(pcbGroup.GetDesignBlockLibId().GetUniStringLibId())}' to '${EscapeHTML(libId.GetUniStringLibId())}'.`;
          this.m_commit.Modify(pcbGroup, null, RECURSE_MODE.NO_RECURSE);
          pcbGroup.SetDesignBlockLibId(libId);
        }

        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
      }

      // A group member may be another group's uuid (a nested group).  Restore that
      // parent/child relationship on the board.
      for (const member of netlistGroup.members) {
        const steps = member.split('/').filter((s) => s !== '');

        if (steps.length === 0) continue;

        const memberGroupUuid =
          steps.length === 1 ? kiidFromString(steps[0]!) : KIID_FromName(kiidPathAsString(steps));

        const childGroup = this.m_board.Groups().find((c) => c.m_Uuid === memberGroupUuid) ?? null;

        if (
          !childGroup ||
          childGroup === pcbGroup ||
          (childGroup.GetParentGroup() as unknown) === pcbGroup
        )
          continue;

        if (this.m_isDryRun) {
          msg = `Add group '${EscapeHTML(childGroup.GetName())}' to group '${EscapeHTML(pcbGroup.GetName())}'.`;
        } else {
          msg = `Added group '${EscapeHTML(childGroup.GetName())}' to group '${EscapeHTML(pcbGroup.GetName())}'.`;
          this.m_commit.Modify(pcbGroup, null, RECURSE_MODE.NO_RECURSE);
          this.m_commit.Modify(childGroup, null, RECURSE_MODE.NO_RECURSE);
          pcbGroup.AddItem(childGroup);
        }

        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
      }
    }

    return true;
  }

  private testConnectivity(aNetlist: NETLIST, aFootprintMap: Map<COMPONENT, FOOTPRINT>): boolean {
    // Verify that board contains all pads in netlist: if it doesn't then footprints are
    // wrong or missing.

    let msg: string;

    for (let i = 0; i < aNetlist.GetCount(); i++) {
      const component = aNetlist.GetComponent(i)!;
      const footprint = aFootprintMap.get(component);

      if (!footprint)
        // It can be missing in partial designs
        continue;

      // Explore all pins/pads in component
      for (let jj = 0; jj < component.GetNetCount(); jj++) {
        const padNumber = component.GetNetAt(jj).GetPinName();

        if (padNumber === '') {
          // bad symbol, report error
          msg = `Symbol ${component.GetReference()} has pins with no number.  These pins can not be matched to pads in ${EscapeHTML(footprint.GetFPID().Format())}.`;
          this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
          ++this.m_errorCount;
        } else if (!footprint.FindPadByNumber(padNumber)) {
          // not found: bad footprint, report error
          msg = `${component.GetReference()} pad ${EscapeHTML(padNumber)} not found in ${EscapeHTML(footprint.GetFPID().Format())}.`;
          this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
          ++this.m_errorCount;
        }
      }
    }

    return true;
  }

  /**
   * Update the board's components according to the new netlist.
   * See BOARD_NETLIST_UPDATER class description for the details of the process.
   *
   * @param aNetlist the new netlist
   * @return true if process was completed successfully
   */
  UpdateNetlist(aNetlist: NETLIST): boolean {
    let lastPreexistingFootprint: FOOTPRINT | null = null;
    let component: COMPONENT | null = null;
    let msg: string;
    const sheetPaths = new Set<string>();
    const usedFootprints = new Set<FOOTPRINT>();

    this.m_errorCount = 0;
    this.m_warningCount = 0;
    this.m_newFootprintsCount = 0;

    const footprintMap = new Map<COMPONENT, FOOTPRINT>();

    if (this.m_board.Footprints().length > 0)
      lastPreexistingFootprint = this.m_board.Footprints().at(-1)!;

    this.cacheCopperZoneConnections();

    // First mark all nets (except <no net>) as stale; we'll update those which are current
    // in the following two loops. Also prepare the component class manager for updates.
    //
    if (!this.m_isDryRun) {
      for (const net of this.m_board.GetNetInfo()) net.SetIsCurrent(net.GetNetCode() === 0);

      this.m_board.GetComponentClassManager().InitNetlistUpdate();
    }

    // Collect all schematic net names so NC pad deduplication can avoid collisions
    for (let ii = 0; ii < aNetlist.GetCount(); ii++) {
      const comp = aNetlist.GetComponent(ii)!;

      for (let jj = 0; jj < comp.GetNetCount(); jj++)
        this.m_schematicNetNames.add(comp.GetNetAt(jj).GetNetName());
    }

    // Next go through the netlist updating all board footprints which have matching component
    // entries and adding new footprints for those that don't.
    //
    for (let i = 0; i < aNetlist.GetCount(); i++) {
      component = aNetlist.GetComponent(i)!;

      if (component.GetProperties().has('exclude_from_board')) continue;

      const baseFpid = componentFpid(component);

      msg = `Processing symbol '${component.GetReference()}:${EscapeHTML(baseFpid.Format())}'.`;
      this.m_reporter.report(msg, RPT_SEVERITY_INFO);

      const hasBaseFpid = !baseFpid.empty();

      if (baseFpid.IsLegacy()) {
        msg = `Warning: ${component.GetReference()} footprint '${EscapeHTML(baseFpid.Format())}' is missing a library name. Use the full 'Library:Footprint' format to avoid repeated update notifications.`;
        this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
        ++this.m_warningCount;
      }

      const matchingFootprints: FOOTPRINT[] = [];

      for (const footprint of this.m_board.Footprints()) {
        let match = false;

        if (this.m_lookupByTimestamp) {
          for (const uuid of component.kiids) {
            const base = [...componentSheetPath(component), uuid];

            if (samePath(footprint.GetPath(), base)) {
              match = true;
              break;
            }
          }
        } else {
          // `CmpNoCase( … ) == 0`
          match = footprint.GetReference().toLowerCase() === component.GetReference().toLowerCase();
        }

        if (match) matchingFootprints.push(footprint);

        if (footprint === lastPreexistingFootprint) {
          // No sense going through the newly-created footprints: end of loop
          break;
        }
      }

      const expectedFpids: LIB_ID[] = [];
      const expectedFpidKeys = new Set<string>();

      const addExpectedFpid = (aFpid: LIB_ID): void => {
        if (aFpid.empty()) return;

        const key = aFpid.Format();

        if (!expectedFpidKeys.has(key)) {
          expectedFpidKeys.add(key);
          expectedFpids.push(aFpid);
        }
      };

      addExpectedFpid(baseFpid);

      // `component->GetVariants()`: not modeled, so no variant names another footprint.

      const isExpectedFpid = (aFpid: LIB_ID): boolean => {
        if (aFpid.empty()) return false;

        if (expectedFpidKeys.has(aFpid.Format())) return true;

        for (const expected of expectedFpids) {
          if (fpidsEquivalentLib(aFpid, expected)) return true;
        }

        return false;
      };

      const takeMatchingFootprint = (aFpid: LIB_ID): FOOTPRINT | null => {
        for (const footprint of matchingFootprints) {
          if (usedFootprints.has(footprint)) continue;

          if (fpidsEquivalentLib(footprint.GetFPID(), aFpid)) return footprint;
        }

        return null;
      };

      const componentFootprints: FOOTPRINT[] = [];
      let baseFootprint: FOOTPRINT | null = null;

      if (hasBaseFpid) baseFootprint = takeMatchingFootprint(baseFpid);
      else if (matchingFootprints.length > 0) baseFootprint = matchingFootprints[0]!;

      if (!baseFootprint && this.m_replaceFootprints && matchingFootprints.length > 0) {
        let replaceCandidate: FOOTPRINT | null = null;

        for (const footprint of matchingFootprints) {
          if (usedFootprints.has(footprint)) continue;

          if (isExpectedFpid(footprint.GetFPID())) continue;

          replaceCandidate = footprint;
          break;
        }

        if (replaceCandidate) {
          const replaced = this.replaceFootprint(aNetlist, replaceCandidate, component);

          if (replaced) baseFootprint = replaced;
          else baseFootprint = replaceCandidate;
        }
      }

      if (!baseFootprint && !this.m_replaceFootprints) {
        for (const footprint of matchingFootprints) {
          if (usedFootprints.has(footprint)) continue;

          if (isExpectedFpid(footprint.GetFPID())) continue;

          baseFootprint = footprint;
          break;
        }
      }

      if (!baseFootprint && (hasBaseFpid || expectedFpids.length === 0))
        baseFootprint = this.addNewFootprint(component, baseFpid);

      if (baseFootprint) {
        componentFootprints.push(baseFootprint);
        usedFootprints.add(baseFootprint);
        footprintMap.set(component, baseFootprint);
      }

      for (const fpid of expectedFpids) {
        // Both IDs are schematic-derived, so either side may be legacy; compare in both
        // directions so a bare base name and a qualified variant name for the same
        // footprint are not split into a duplicate.
        if (fpidsEquivalentLib(fpid, baseFpid) || fpidsEquivalentLib(baseFpid, fpid)) continue;

        const footprint = takeMatchingFootprint(fpid) ?? this.addNewFootprint(component, fpid);

        if (footprint) {
          componentFootprints.push(footprint);
          usedFootprints.add(footprint);
        }
      }

      for (const footprint of componentFootprints) {
        this.updateFootprintParameters(footprint, component);
        this.updateFootprintGroup(footprint, component);
        this.updateComponentPadConnections(footprint, component);
        this.updateComponentClass(footprint, component);
        this.updateComponentUnits(footprint, component);

        sheetPaths.add(footprint.GetSheetname());
      }

      // `applyComponentVariants( component, componentFootprints, baseFpid )`: no variants.
    }

    this.updateCopperZoneNets(aNetlist);
    this.updateGroups(aNetlist);

    // Finally go through the board footprints and update all those that *don't* have matching
    // component entries.
    //
    for (const footprint of this.m_board.Footprints()) {
      let matched = false;
      let doDelete = this.m_deleteUnusedFootprints;

      if ((footprint.GetAttributes() & FP_BOARD_ONLY) > 0) doDelete = false;

      if (usedFootprints.has(footprint)) {
        matched = true;
      } else {
        if (this.m_lookupByTimestamp)
          component = aNetlist.GetComponentByPath(kiidPathAsString(footprint.GetPath()));
        else component = aNetlist.GetComponentByReference(footprint.GetReference());

        // `m_replaceFootprints && !component->GetVariants().empty()`: no variants, so a
        // footprint matched by its component is never a stale variant footprint.
        if (component && !component.GetProperties().has('exclude_from_board')) matched = true;
      }

      if (doDelete && !matched && footprint.IsLocked() && !this.m_overrideLocks) {
        if (this.m_isDryRun)
          msg = `Cannot remove unused footprint ${footprint.GetReference()} (footprint is locked).`;
        else
          msg = `Could not remove unused footprint ${footprint.GetReference()} (footprint is locked).`;

        this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
        this.m_warningCount++;
        doDelete = false;
      }

      if (doDelete && !matched) {
        if (this.m_isDryRun) {
          msg = `Remove unused footprint ${footprint.GetReference()}.`;
        } else {
          this.m_commit.Remove(footprint);
          msg = `Removed unused footprint ${footprint.GetReference()}.`;
        }

        this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
      } else if (!this.m_isDryRun) {
        if (!matched) footprint.SetPath([]);

        for (const pad of footprint.Pads()) {
          if (pad.GetNet()) pad.GetNet()!.SetIsCurrent(true);
        }
      }
    }

    if (!this.m_isDryRun) {
      // Finalise the component class manager
      this.m_board.GetComponentClassManager().FinishNetlistUpdate();
      this.m_board.SynchronizeComponentClasses(sheetPaths);

      this.m_board.BuildConnectivity();
      this.testConnectivity(aNetlist, footprintMap);

      for (const net of this.m_board.GetNetInfo()) {
        if (!net.IsCurrent()) {
          msg = `Removed unused net ${EscapeHTML(net.GetNetname())}.`;
          this.m_reporter.report(msg, RPT_SEVERITY_ACTION);
        }
      }

      this.m_board.RemoveUnusedNets(this.m_commit);

      // The board's variant registry from the netlist: not modeled (no netlist variants).

      // When new footprints are added, the automatic zone refill is disabled because:
      // * it creates crashes when calculating dynamic ratsnests if auto refill is enabled.
      // (the auto refills rebuild the connectivity with incomplete data)
      // * it is useless because zones will be refilled after placing new footprints
      this.m_commit.Push('Update Netlist', this.m_newFootprintsCount ? ZONE_FILL_OP : 0);

      // Update net, netcode and netclass data after commiting the netlist
      this.m_board.SynchronizeNetsAndNetClasses(true);
      this.m_board.GetConnectivity().RefreshNetcodeMap(this.m_board);

      // Although m_commit will probably also set this, it's not guaranteed, and we need to make
      // sure any modification to netclasses gets persisted to project settings through a save.
      this.m_frame.OnModify();
    }

    if (this.m_isDryRun) this.m_addedNets.clear();

    // Update the ratsnest
    this.m_reporter.reportTail('', RPT_SEVERITY_ACTION);
    this.m_reporter.reportTail('', RPT_SEVERITY_ACTION);

    msg = `Total warnings: ${this.m_warningCount}, errors: ${this.m_errorCount}.`;
    this.m_reporter.reportTail(msg, RPT_SEVERITY_INFO);

    return true;
  }
}

/** `BOARD_NETLIST_UPDATER::fpidsEquivalent` (board_netlist_updater.cpp:1324-1330). */
function fpidsEquivalentLib(aBoardFpid: LIB_ID, aSchematicFpid: LIB_ID): boolean {
  if (aSchematicFpid.IsLegacy())
    return aBoardFpid.GetLibItemName() === aSchematicFpid.GetLibItemName();

  return aBoardFpid.Format() === aSchematicFpid.Format();
}

/** `COMPONENT::GetFPID()` as the LIB_ID it is upstream. */
function componentFpid(aComponent: COMPONENT): LIB_ID {
  const fpid = new LIB_ID();
  if (aComponent.GetFPID() !== '') fpid.Parse(aComponent.GetFPID(), true);
  return fpid;
}

/** `COMPONENT::GetPath()`: the sheet path, as KIIDs. */
function componentSheetPath(aComponent: COMPONENT): KIID[] {
  return aComponent.path
    .split('/')
    .filter((s) => s !== '')
    .map(kiidFromString);
}

/** `GetPath()` plus the first of `GetKIIDs()`: the footprint's symbol association. */
function componentSymbolPath(aComponent: COMPONENT): KIID[] {
  const path = componentSheetPath(aComponent);
  if (aComponent.kiids.length > 0) path.push(kiidFromString(aComponent.kiids[0]!));
  return path;
}

function samePath(a: readonly KIID[], b: readonly KIID[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

function sameJumperGroups(a: readonly Set<string>[], b: readonly Set<string>[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((g, i) => {
    const h = b[i]!;
    return g.size === h.size && [...g].every((p) => h.has(p));
  });
}

// ----- free functions ---------------------------------------------------------

/**
 * BOARD_NETLIST_UPDATER::fpidsEquivalent, compare a board footprint id against a
 * schematic-derived one, ignoring the library nickname when the schematic side uses
 * a legacy bare footprint name. A board footprint always carries a nickname, so a
 * strict equality test would never match a legacy schematic FPID.
 */
export function fpidsEquivalent(boardFpid: string, schematicFpid: string): boolean {
  if (fpidIsLegacy(schematicFpid)) return fpidItemName(boardFpid) === fpidItemName(schematicFpid);
  return boardFpid === schematicFpid;
}

/** The full KIID_PATH of a component: its sheet path plus its primary symbol UUID. */

/** KIID_PATH::push_back, append a UUID to a "/a/b/" style path. */

/** std::set::insert's "was it new?" result. */

/** ZONE::IsOnCopperLayer, and not a rule area. */

/** Set (or drop) a footprint's `(property ki_fp_filters "…")`. */

/** `PCB_GROUP`'s member list. */

// ----- placing and exchanging a footprint ------------------------------------
//
// Formerly `pcb_netlist_utils.ts`, which had no KiCad file of that name. Its two
// functions are `LoadFootprintFromProject` + the placement half of
// `PCB_EDIT_FRAME::ExchangeFootprint` (`pcb_edit_frame.cpp:2591`), whose only
// caller upstream is BOARD_NETLIST_UPDATER (board_netlist_updater.cpp:382). They
// stay here until BOARD_NETLIST_UPDATER takes a frame the way upstream's does.

export interface PlaceFootprintOptions {
  /** The full LIB_ID the board footprint should carry ("Library:Footprint"). */
  fpid: string;
  /** Board position of the footprint anchor. */
  at: VECTOR2I;
  /** Orientation in degrees. */
  angle?: number;
  /** 'F.Cu' or 'B.Cu'. */
  layer?: string;
  uuid?: string;
  /** `(path …)`, the linked symbol's KIID_PATH. */
  path?: string;
  sheetname?: string;
  sheetfile?: string;
  locked?: boolean;
}

/**
 * Turn a library footprint into a board footprint at a given place.
 * `LoadFootprintFromProject` + the placement: `FOOTPRINT( *lib )`, its nets
 * cleared (a library footprint's pads carry orphaned net codes), then
 * `SetPosition` / `SetOrientation`, which carry every child with the anchor,
 * and `Flip` for the back side, the way `ExchangeFootprint` puts a new
 * footprint on the side of the old one (pcb_edit_frame.cpp:2671).
 */
export function placeFootprint(
  libFootprint: PcbFootprint,
  opts: PlaceFootprintOptions,
): PcbFootprint | null {
  const lib = libFootprint.k;
  if (!lib) return null;

  // `FOOTPRINT( *lib )`: a copy of the library footprint, then the board's own
  // placement written over it — CTL_OMIT_FOOTPRINT_VERSION drops the library
  // header's version and generator, which live on the board instead.
  const k = lib.Clone();
  k.SetInitialComments(null);
  k.SetFPIDAsString(opts.fpid);
  k.SetLocked(opts.locked ?? false);
  (k as { m_Uuid: string }).m_Uuid = opts.uuid ?? newKiid();
  const path = opts.path ?? '';
  k.SetPath(
    path === ''
      ? []
      : path
          .split('/')
          .filter((s) => s !== '')
          .map(kiidFromString),
  );
  k.SetSheetname(opts.sheetname ?? '');
  k.SetSheetfile(opts.sheetfile ?? '');

  // `FOOTPRINT::ClearAllNets`: a library pad's net, pin function and type are
  // the symbol's business, and the netlist fills them in.
  k.ClearAllNets();
  for (const pad of k.Pads()) {
    pad.SetPinFunction('');
    pad.SetPinType('');
  }

  // A library footprint sits at the origin, unrotated; the children ride the anchor.
  k.SetPosition({ x: opts.at.x, y: opts.at.y });
  k.SetOrientation(new EDA_ANGLE(opts.angle ?? 0));
  if (LSET_NameToLayer(opts.layer ?? 'F.Cu') !== k.GetLayer())
    k.Flip(k.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

  return footprintViewOfBoard(k);
}

/**
 * PCB_EDIT_FRAME::ExchangeFootprint with the netlist updater's arguments (every
 * reset flag at its default, board_netlist_updater.cpp:382): the replacement
 * comes from the library, and only the board-owned state listed in this module's
 * header is carried over.
 *
 * The one thing this does not reproduce is per-item UUID preservation for graphics,
 * zones and fields, KiCad matches those by geometric similarity, which the typed
 * model has no counterpart for. Pads, whose UUIDs and nets do matter, are matched
 * by number.
 */
export function exchangeFootprint(
  existing: PcbFootprint,
  libFootprint: PcbFootprint,
  newFpid: string,
): PcbFootprint | null {
  // `PlaceFootprint( aNew, false, aExisting->GetPosition() )`, then the old
  // orientation (pcb_edit_frame.cpp:2669-2675): the replacement goes exactly
  // where the old one was, with no pad matching - 10.0.5 has none.
  const position = existing.at;
  const orientation = existing.angle;

  const placed = placeFootprint(libFootprint, {
    fpid: newFpid,
    at: position,
    angle: orientation,
    layer: existing.layer,
    ...(existing.uuid ? { uuid: existing.uuid } : {}),
    ...(existing.path ? { path: existing.path } : {}),
    ...(existing.sheetname ? { sheetname: existing.sheetname } : {}),
    ...(existing.sheetfile ? { sheetfile: existing.sheetfile } : {}),
    ...(existing.locked ? { locked: true } : {}),
  });
  if (!placed) return null;

  // Pads: net, pin function and pin type belong to the board, matched by number.
  // An unmatched pad on the replacement starts unconnected.
  const oldPadsByNumber = new Map<string, (typeof existing.pads)[number][]>();
  for (const pad of existing.pads) {
    const arr = oldPadsByNumber.get(pad.number) ?? [];
    arr.push(pad);
    oldPadsByNumber.set(pad.number, arr);
  }
  const takenPads = new Map<string, number>();

  placed.pads = placed.pads.map((pad) => {
    const candidates = oldPadsByNumber.get(pad.number) ?? [];
    const taken = takenPads.get(pad.number) ?? 0;
    const oldPad = candidates[taken];
    if (!oldPad) return pad;
    takenPads.set(pad.number, taken + 1);
    return {
      ...pad,
      ...(oldPad.uuid ? { uuid: oldPad.uuid } : {}),
      ...(oldPad.net !== undefined ? { net: oldPad.net } : {}),
      ...(oldPad.pinFunction !== undefined ? { pinFunction: oldPad.pinFunction } : {}),
      ...(oldPad.pinType !== undefined ? { pinType: oldPad.pinType } : {}),
    };
  });

  // Reference: the initial text is always used, never reset.
  const reference = existing.reference ?? '';
  // Value: reset only when it was a proxy for the footprint ID (replacing
  // "MountingHole-2.5mm" with "MountingHole-4.0mm").
  const valueWasFpidProxy = existing.value === fpidItemName(existing.lib);
  const value = valueWasFpidProxy ? (placed.value ?? '') : (existing.value ?? '');

  placed.reference = reference;
  placed.value = value;
  placed.texts = placed.texts.map((t) => {
    if (t.kind === 'reference') return { ...t, text: reference };
    if (t.kind === 'value') return { ...t, text: value };
    return t;
  });

  // Fields the board has but the library copy does not are kept (deleteExtraTexts
  // applies to *texts*; fields fall through to the "clone the old one" branch).
  const placedFieldNames = new Set((placed.fields ?? []).map((f) => f.name));
  for (const field of existing.fields ?? []) {
    if (placedFieldNames.has(field.name)) continue;
    placed.fields = [...(placed.fields ?? []), field];
  }

  return placed;
}
