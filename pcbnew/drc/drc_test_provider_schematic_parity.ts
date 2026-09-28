// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_schematic_parity.cpp`.
 *
 * Schematic parity test.
 *
 * Errors generated:
 * - DRCE_MISSING_FOOTPRINT
 * - DRCE_DUPLICATE_FOOTPRINT
 * - DRCE_EXTRA_FOOTPRINT
 * - DRCE_SCHEMATIC_PARITY
 * - DRCE_FOOTPRINT_FILTERS
 *
 * TODO:
 * - cross-check PCB netlist against SCH netlist
 * - cross-check PCB fields against SCH fields
 */
import { UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { FOOTPRINT_ATTR_T, type FOOTPRINT } from '../footprint.js';
import type { NETLIST } from '../netlist_reader/pcb_netlist.js';
import { wxMatches } from '../pcbexpr_evaluator.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

/** `LIB_ID::GetUniStringLibId()` of a netlist component's "Library:Footprint" string. */
const uniStringLibId = (aFpid: string): string => {
  const id = new LIB_ID();
  id.Parse(aFpid);
  return id.GetUniStringLibId();
};

export class DRC_TEST_PROVIDER_SCHEMATIC_PARITY extends DRC_TEST_PROVIDER {
  constructor() {
    super();
    this.m_isRuleDriven = false;
  }

  override GetName(): string {
    return 'schematic_parity';
  }

  private testNetlist(aNetlist: NETLIST): void {
    const board = this.m_drcEngine!.GetBoard()!;

    // `std::set<FOOTPRINT*, compare>` with `compare` = `CmpNoCase` on the
    // reference: one footprint per case-folded reference, the first inserted wins.
    const footprints = new Map<string, FOOTPRINT>();

    // Search for duplicate footprints on the board
    for (const footprint of board.Footprints()) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT)) break;

      const key = footprint.GetReference().toLowerCase();
      const existing = footprints.get(key);

      if (existing === undefined) footprints.set(key, footprint);

      if (existing !== undefined && !(footprint.GetAttributes() & FOOTPRINT_ATTR_T.FP_BOARD_ONLY)) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT)!;
        drcItem.SetItems(footprint, existing);

        this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
      }
    }

    // Search for component footprints in the netlist but not on the board.
    for (let ii = 0; ii < aNetlist.GetCount(); ii++) {
      const component = aNetlist.GetComponent(ii)!;
      const footprint = board.FindFootprintByReference(component.GetReference());

      if (footprint === null) {
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT)) {
          const msg = `Missing footprint ${component.GetReference()} (${component.GetValue()})`;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT)!;

          drcItem.SetErrorMessage(msg);
          this.reportViolation(drcItem, { x: 0, y: 0 }, UNDEFINED_LAYER);
        }
      } else {
        if (
          component.GetValue() !== footprint.GetValue() &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)
        ) {
          // wxString::Format( _( "Value (%s) doesn't match symbol value (%s)" ), reference, value, symbolValue ):
          // the reference is the extra argument the format string never consumes.
          const msg = `Value (${footprint.GetReference()}) doesn't match symbol value (${footprint.GetValue()})`;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)!;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
        }

        if (
          uniStringLibId(component.GetFPID()) !== footprint.GetFPID().GetUniStringLibId() &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)
        ) {
          const msg = `${footprint.GetFPID().GetUniStringLibId()} doesn't match footprint given by symbol (${uniStringLibId(component.GetFPID())})`;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)!;
          drcItem.SetErrorMessage(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
        }

        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS)) {
          const libIdLower = footprint.GetFPID().GetUniStringLibId().toLowerCase();
          const fpNameLower = footprint.GetFPID().GetUniStringLibItemName().toLowerCase();
          const filtercount = component.GetFootprintFilters().length;
          let found = 0 === filtercount; // if no entries, do not filter

          for (let jj = 0; jj < filtercount && !found; jj++) {
            const filterLower = component.GetFootprintFilters()[jj]!.toLowerCase();

            if (filterLower.indexOf(':') === -1) found = wxMatches(fpNameLower, filterLower);
            else found = wxMatches(libIdLower, filterLower);
          }

          if (!found) {
            const msg = `${footprint.GetFPID().GetUniStringLibId()} doesn't match symbol's footprint filters (${component.GetFootprintFilters().join(' ')})`;

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS)!;
            drcItem.SetErrorMessage(msg);
            drcItem.SetItems(footprint);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          }
        }

        if (
          component.GetProperties().has('dnp') !==
            (footprint.GetAttributes() & FOOTPRINT_ATTR_T.FP_DNP) > 0 &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)
        ) {
          const msg = `'Do not populate' settings differ`;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)!;
          drcItem.SetErrorMessage(`${drcItem.GetErrorMessage(true)}: ${msg}`);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
        }

        if (
          component.GetProperties().has('exclude_from_bom') !==
            (footprint.GetAttributes() & FOOTPRINT_ATTR_T.FP_EXCLUDE_FROM_BOM) > 0 &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)
        ) {
          const msg = `'Exclude from bill of materials' settings differ`;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY)!;
          drcItem.SetErrorMessage(`${drcItem.GetErrorMessage(true)}: ${msg}`);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
        }

        // Compare custom fields between schematic component and PCB footprint
        if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY)) {
          const fpFieldsAsMap = new Map<string, string>();

          for (const field of footprint.GetFields()) {
            if (!field) continue;

            if (field.IsReference() || field.IsValue() || field.IsComponentClass()) continue;

            fpFieldsAsMap.set(field.GetName(), field.GetText());
          }

          // Remove the extra component fields we don't want to evaluate here
          const compFields = new Map(component.GetFields());
          compFields.delete(GetCanonicalFieldName(FIELD_T.REFERENCE));
          compFields.delete(GetCanonicalFieldName(FIELD_T.VALUE));
          compFields.delete(GetCanonicalFieldName(FIELD_T.FOOTPRINT));
          compFields.delete('Component Class');

          let fieldsMatch = true;
          let mismatchDetail = '';

          for (const [name, value] of compFields) {
            const it = fpFieldsAsMap.get(name);

            if (it === undefined) {
              fieldsMatch = false;
              mismatchDetail = `Missing symbol field '${name}' in footprint`;
              break;
            }

            if (it !== value) {
              fieldsMatch = false;
              mismatchDetail = `Field '${name}' differs (PCB: '${it}', Schematic: '${value}')`;
              break;
            }
          }

          if (!fieldsMatch && mismatchDetail !== '') {
            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY)!;

            drcItem.SetErrorMessage(mismatchDetail);
            drcItem.SetItems(footprint);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          }
        }

        for (const pad of footprint.Pads()) {
          if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NET_CONFLICT)) break;

          if (!pad.CanHaveNumber()) continue;

          const sch_net = component.GetNet(pad.GetNumber());
          const pcb_netname = pad.GetNetname();

          if (pcb_netname !== '' && sch_net.pinName === '') {
            const msg = 'No corresponding pin found in schematic';

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_NET_CONFLICT)!;
            drcItem.SetErrorMessage(msg);
            drcItem.SetItems(pad);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          } else if (pcb_netname === '' && sch_net.netName !== '') {
            const msg = `Pad missing net given by schematic (${sch_net.netName})`;

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_NET_CONFLICT)!;
            drcItem.SetErrorMessage(msg);
            drcItem.SetItems(pad);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          } else if (
            pcb_netname !== sch_net.netName &&
            !(pcb_netname.startsWith('unconnected-') && pcb_netname.startsWith(sch_net.netName)) &&
            !(pad.IsNoConnectPad() && pcb_netname.startsWith(`${sch_net.netName}_`))
          ) {
            const msg = `Pad net (${pcb_netname}) doesn't match net given by schematic (${sch_net.netName})`;

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_NET_CONFLICT)!;
            drcItem.SetErrorMessage(msg);
            drcItem.SetItems(pad);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          }
        }

        for (let jj = 0; jj < component.GetNetCount(); ++jj) {
          if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NET_CONFLICT)) break;

          const sch_net = component.GetNetAt(jj);

          if (!footprint.FindPadByNumber(sch_net.pinName)) {
            let msg: string;

            if (sch_net.netName.startsWith('unconnected-')) {
              msg = sch_net.pinName;
            } else {
              msg = `${sch_net.pinName} (${sch_net.netName})`;
            }

            msg = `No pad found for pin ${msg} in schematic`;

            const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_NET_CONFLICT)!;
            drcItem.SetErrorMessage(msg);
            drcItem.SetItems(footprint);
            this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
          }
        }
      }
    }

    // Search for component footprints found on board but not in netlist.
    for (const footprint of board.Footprints()) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT)) break;

      if (footprint.GetAttributes() & FOOTPRINT_ATTR_T.FP_BOARD_ONLY) continue;

      if (!aNetlist.GetComponentByReference(footprint.GetReference())) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT)!;

        drcItem.SetItems(footprint);
        this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
      }
    }
  }

  Run(): boolean {
    if (this.m_drcEngine!.GetTestFootprints()) {
      if (!this.reportPhase('Checking PCB to schematic parity...')) return false;

      const netlist = this.m_drcEngine!.GetSchematicNetlist();

      if (!netlist) {
        this.REPORT_AUX('No netlist provided, skipping schematic parity tests.');
        return true;
      }

      this.testNetlist(netlist);
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_SCHEMATIC_PARITY);
