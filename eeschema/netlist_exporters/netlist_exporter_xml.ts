// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_xml.cpp` (`NETLIST_EXPORTER_XML`,
 * `<export version="E">`): `makeRoot` and its section builders over a live `SCHEMATIC`
 * and its `CONNECTION_GRAPH`. The same tree is the KiCad generic XML netlist, for
 * external tools (XSLT, BOM scripts) - `WriteNetlistText`, saved as a
 * `wxXmlDocument` (common/wx/xml.ts) - and, printed as s-expressions with
 * `GNL_OPT_KICAD`, the netlist pcbnew reads (netlist_exporter_kicad.ts). Both walk the
 * whole hierarchy.
 */

import { ExpandTextVars } from '@ziroeda/common/common.js';
import type { OutStr } from '@ziroeda/common/font/font.js';
import {
  GetISO8601CurrentDateTime,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { XNODE, wxXmlNodeType } from '@ziroeda/common/xnode.js';
import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_RULE_AREA } from '../sch_rule_area.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_GROUP } from '../sch_group.js';
import {
  type SCH_SHEET_LIST,
  type SCH_SHEET_PATH,
  SCH_SYMBOL_INSTANCE,
} from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { NETLIST_EXPORTER_BASE } from './netlist_exporter_base.js';
import { wxXmlDocumentSave } from '@ziroeda/common/wx/xml.js';

/** GNL_T: the bits that control the totality of the tree makeRoot() builds. */
export enum GNL_T {
  GNL_LIBRARIES = 1 << 0,
  GNL_SYMBOLS = 1 << 1,
  GNL_PARTS = 1 << 2,
  GNL_HEADER = 1 << 3,
  GNL_NETS = 1 << 4,
  GNL_OPT_KICAD = 1 << 5,
  GNL_OPT_BOM = 1 << 6,
}

export const GNL_ALL =
  GNL_T.GNL_LIBRARIES | GNL_T.GNL_SYMBOLS | GNL_T.GNL_PARTS | GNL_T.GNL_HEADER | GNL_T.GNL_NETS;

function node(aName: string, aTextualContent = ''): XNODE {
  const n = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, aName);

  if (aTextualContent.length > 0)
    // excludes wxEmptyString, the parameter's default value
    n.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', aTextualContent));

  return n;
}

/** `ExpandTextVars( aSource, const PROJECT* )`. */
function expandProjectTextVars(aSource: string, aProject: PROJECT): string {
  return ExpandTextVars(aSource, (token: OutStr) => aProject.TextVarResolver(token));
}

const symbolsOn = (aSheet: SCH_SHEET_PATH): SCH_SYMBOL[] =>
  (aSheet.LastScreen()?.Items().OfType(KICAD_T.SCH_SYMBOL_T) ?? []) as unknown as SCH_SYMBOL[];

export type NETLIST_LIBRARY_URI = (aNickname: string) => string | undefined;

export class NETLIST_EXPORTER_XML extends NETLIST_EXPORTER_BASE {
  protected m_resolveTextVars = true;
  protected m_libraries = new Set<string>();
  protected m_sheetComponentClasses = new Map<SCH_SHEET_PATH, Set<string>>();

  /** `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`. */
  m_libraryUri: NETLIST_LIBRARY_URI = () => undefined;
  /** `GetISO8601CurrentDateTime()`, settable so a test can pin it. */
  m_date: () => string = GetISO8601CurrentDateTime;

  /**
   * `WriteNetlist`'s document: `makeRoot( GNL_ALL | aNetlistOptions )` saved the way
   * `wxXmlDocument::Save( stream, 2 )` writes it (common/wx/xml.ts).
   */
  WriteNetlistText(aNetlistOptions = 0): string {
    return wxXmlDocumentSave(this.makeRoot(GNL_ALL | aNetlistOptions), 2);
  }

  /** `makeRoot`. */
  makeRoot(aCtl: number): XNODE {
    const xroot = node('export');

    xroot.AddAttribute('version', 'E');

    if (aCtl & GNL_T.GNL_HEADER)
      // add the "design" header
      xroot.AddChild(this.makeDesignHeader());

    if (aCtl & GNL_T.GNL_SYMBOLS) {
      xroot.AddChild(this.makeSymbols(aCtl));

      if (aCtl & GNL_T.GNL_OPT_KICAD) {
        xroot.AddChild(this.makeGroups());
        xroot.AddChild(this.makeVariants());
      }
    }

    if (aCtl & GNL_T.GNL_PARTS) xroot.AddChild(this.makeLibParts());

    if (aCtl & GNL_T.GNL_LIBRARIES)
      // must follow makeGenericLibParts()
      xroot.AddChild(this.makeLibraries());

    if (aCtl & GNL_T.GNL_NETS) xroot.AddChild(this.makeListOfNets(aCtl));

    return xroot;
  }

  /** `addSymbolFields`. */
  protected addSymbolFields(
    aNode: XNODE,
    aSymbol: SCH_SYMBOL,
    aSheet: SCH_SHEET_PATH,
    aSheetList: SCH_SHEET_LIST,
  ): void {
    let value = '';
    let footprint = '';
    let datasheet = '';
    let description = '';
    let candidate = '';
    // nlohmann::ordered_map: insertion order, and a re-set keeps the first position.
    const fields = new Map<string, string>();

    const fieldText = (aField: SCH_FIELD | null, aPath: SCH_SHEET_PATH): string =>
      this.m_resolveTextVars
        ? (aField?.GetShownText(aPath, false) ?? '')
        : (aField?.GetText() ?? '');

    if (aSymbol.GetUnitCount() > 1) {
      // Sadly, each unit of a symbol can have its own unique fields. This
      // block finds the unit with the lowest number having a non blank field
      // value and records it.  Therefore user is best off setting fields
      // into only the first unit.  But this scavenger algorithm will find
      // any non blank fields in all units and use the first non-blank field
      // for each unique field name.

      const ref = aSymbol.GetRef(aSheet);

      let minUnit = aSymbol.GetUnitSelection(aSheet);

      for (const sheet of aSheetList) {
        for (const symbol2 of symbolsOn(sheet)) {
          const ref2 = symbol2.GetRef(sheet);

          if (ref2.toLowerCase() !== ref.toLowerCase()) continue;

          const unit = symbol2.GetUnitSelection(aSheet);

          // The lowest unit number wins.  User should only set fields in any one unit.

          // Value
          candidate = symbol2.GetValue(this.m_resolveTextVars, sheet, false);

          if (candidate !== '' && (unit < minUnit || value === '')) value = candidate;

          // Footprint
          candidate = symbol2.GetFootprintFieldText(this.m_resolveTextVars, sheet, false);

          if (candidate !== '' && (unit < minUnit || footprint === '')) footprint = candidate;

          // Datasheet
          candidate = fieldText(symbol2.GetField(FIELD_T.DATASHEET), sheet);

          if (candidate !== '' && (unit < minUnit || datasheet === '')) datasheet = candidate;

          // Description
          candidate = fieldText(symbol2.GetField(FIELD_T.DESCRIPTION), sheet);

          if (candidate !== '' && (unit < minUnit || description === '')) description = candidate;

          // All non-mandatory fields
          for (const field of symbol2.GetFields()) {
            if (field.IsMandatory() || field.IsPrivate()) continue;

            if (unit < minUnit || !fields.has(field.GetName()))
              fields.set(field.GetName(), fieldText(field, aSheet));
          }

          minUnit = Math.min(unit, minUnit);
        }
      }
    } else {
      value = aSymbol.GetValue(this.m_resolveTextVars, aSheet, false);
      footprint = aSymbol.GetFootprintFieldText(this.m_resolveTextVars, aSheet, false);

      // Datasheet
      datasheet = fieldText(aSymbol.GetField(FIELD_T.DATASHEET), aSheet);

      // Description
      description = fieldText(aSymbol.GetField(FIELD_T.DESCRIPTION), aSheet);

      for (const field of aSymbol.GetFields()) {
        if (field.IsMandatory() || field.IsPrivate()) continue;

        fields.set(field.GetName(), fieldText(field, aSheet));
      }
    }

    fields.set(GetCanonicalFieldName(FIELD_T.FOOTPRINT), footprint);
    fields.set(GetCanonicalFieldName(FIELD_T.DATASHEET), datasheet);
    fields.set(GetCanonicalFieldName(FIELD_T.DESCRIPTION), description);

    // Do not output field values blank in netlist:
    if (value.length) aNode.AddChild(node('value', unescapeString(value)));
    // value field always written in netlist
    else aNode.AddChild(node('value', '~'));

    if (footprint.length) aNode.AddChild(node('footprint', unescapeString(footprint)));

    if (datasheet.length) aNode.AddChild(node('datasheet', unescapeString(datasheet)));

    if (description.length) aNode.AddChild(node('description', unescapeString(description)));

    const xfields = node('fields');
    aNode.AddChild(xfields);

    for (const [fieldName, fieldValue] of fields) {
      const xfield = node('field', unescapeString(fieldValue));
      xfield.AddAttribute('name', unescapeString(fieldName));
      xfields.AddChild(xfield);
    }
  }

  /** `makeSymbols`. */
  protected makeSymbols(aCtl: number): XNODE {
    const xcomps = node('components');

    this.m_referencesAlreadyFound.Clear();
    this.m_libParts.clear();
    this.getSheetComponentClasses();

    const currentSheet = this.m_schematic.CurrentSheet();
    const sheetList = this.m_schematic.Hierarchy();

    // Output is xml, so there is no reason to remove spaces from the field values.
    // And XML element names need not be translated to various languages.

    for (const sheet of sheetList) {
      // Change schematic CurrentSheet in each iteration to allow hierarchical
      // resolution of text variables in sheet fields.
      this.m_schematic.SetCurrentSheet(sheet);

      // std::set<SCH_SYMBOL*, cmp> keyed by StrNumCmp( GetRef( &sheet, false ), …, true ),
      // and the std::multiset of the units that lost their slot to a lower UUID.
      const keyOf = (s: SCH_SYMBOL): string => s.GetRef(sheet, false);
      const ordered_symbols: SCH_SYMBOL[] = [];
      const extra_units: SCH_SYMBOL[] = [];

      // Upstream walks Items() in its R-tree's node order.  Our EE_RTREE keeps insertion
      // order instead, so walk by UUID: the primary (the lowest UUID) comes out the same
      // either way, but the order of the extra units - three or more units of one
      // reference on one sheet - is the tree's, and can differ from kicad-cli's
      // (netlist_oracle_graph/test_multiunit_reannotate*).
      const items = [...symbolsOn(sheet)].sort((a, b) =>
        a.m_Uuid < b.m_Uuid ? -1 : a.m_Uuid > b.m_Uuid ? 1 : 0,
      );

      for (const symbol of items) {
        const existing = ordered_symbols.findIndex(
          (s) => strNumCmp(keyOf(s), keyOf(symbol), true) === 0,
        );

        if (existing < 0) {
          ordered_symbols.push(symbol);
        } else if (ordered_symbols[existing]!.m_Uuid > symbol.m_Uuid) {
          extra_units.push(ordered_symbols[existing]!);
          ordered_symbols[existing] = symbol;
        } else {
          extra_units.push(symbol);
        }
      }

      ordered_symbols.sort((a, b) => strNumCmp(keyOf(a), keyOf(b), true));

      const unitsOf = (aSymbol: SCH_SYMBOL): SCH_SYMBOL[] =>
        extra_units.filter((s) => strNumCmp(keyOf(s), keyOf(aSymbol), true) === 0);

      for (const item of ordered_symbols) {
        const symbol = this.findNextSymbol(item, sheet);
        const forBOM = (aCtl & GNL_T.GNL_OPT_BOM) !== 0;
        const forBoard = (aCtl & GNL_T.GNL_OPT_KICAD) !== 0;

        if (!symbol) continue;

        if (forBOM && (sheet.GetExcludedFromBOM() || symbol.ResolveExcludedFromBOM())) continue;

        if (forBoard && (sheet.GetExcludedFromBoard() || symbol.ResolveExcludedFromBoard()))
          continue;

        // Output the symbol's elements in order of expected access frequency. This may
        // not always look best, but it will allow faster execution under XSL processing
        // systems which do sequential searching within an element.

        const xcomp = node('comp');
        xcomps.AddChild(xcomp);

        xcomp.AddAttribute('ref', symbol.GetRef(sheet));
        this.addSymbolFields(xcomp, symbol, sheet, sheetList);

        const xlibsource = node('libsource');
        xcomp.AddChild(xlibsource);

        // "logical" library name, which is in anticipation of a better search algorithm
        // for parts based on "logical_lib.part" and where logical_lib is merely the library
        // name minus path and extension.
        let libName = '';
        let partName = '';

        if (symbol.UseLibIdLookup()) {
          libName = symbol.GetLibId().GetUniStringLibNickname();
          partName = symbol.GetLibId().GetUniStringLibItemName();
        } else {
          partName = symbol.GetSchSymbolLibraryName();
        }

        xlibsource.AddAttribute('lib', libName);

        // We only want the symbol name, not the full LIB_ID.
        xlibsource.AddAttribute('part', partName);

        if (this.m_resolveTextVars)
          xlibsource.AddAttribute('description', symbol.GetShownDescription());
        else xlibsource.AddAttribute('description', symbol.GetDescription());

        /* Add the symbol properties. */
        const property = (aName: string, aValue?: string): void => {
          const xproperty = node('property');
          xcomp.AddChild(xproperty);
          xproperty.AddAttribute('name', aName);

          if (aValue !== undefined) xproperty.AddAttribute('value', aValue);
        };

        for (const field of symbol.GetFields()) {
          if (field.IsMandatory() || field.IsPrivate()) continue;

          property(
            field.GetCanonicalName(),
            this.m_resolveTextVars ? field.GetShownText(sheet, false) : field.GetText(),
          );
        }

        for (const sheetField of sheet.Last()!.GetFields()) {
          // do not allow GetShownText() to add any prefix useful only when displaying
          // the field on screen
          property(
            sheetField.GetCanonicalName(),
            this.m_resolveTextVars ? sheetField.GetShownText(sheet, false) : sheetField.GetText(),
          );
        }

        if (symbol.ResolveExcludedFromBOM(sheet) || sheet.GetExcludedFromBOM())
          property('exclude_from_bom');

        if (symbol.ResolveExcludedFromBoard(sheet) || sheet.GetExcludedFromBoard())
          property('exclude_from_board');

        if (symbol.ResolveExcludedFromPosFiles(sheet)) property('exclude_from_pos_files');

        if (symbol.ResolveDNP(sheet) || sheet.GetDNP()) property('dnp');

        // Iterate all variants in the schematic, not just those in the symbol instance,
        // because a sheet can have variant-specific attributes even if the symbol does not.
        const variantNames = this.m_schematic.GetVariantNames();

        if (variantNames.length > 0) {
          const baseDnp = symbol.GetDNP(sheet);
          const baseExcludedFromBOM = symbol.GetExcludedFromBOM(sheet);
          const baseExcludedFromSim = symbol.GetExcludedFromSim(sheet);
          const baseExcludedFromPosFiles = symbol.GetExcludedFromPosFiles(sheet);
          let xvariants: XNODE | null = null;

          for (const variantName of variantNames) {
            const xvariant = node('variant');
            let hasVariantData = false;

            xvariant.AddAttribute('name', variantName);

            const varprop = (aName: string, aValue: boolean): void => {
              const xvarprop = node('property');
              xvarprop.AddAttribute('name', aName);
              xvarprop.AddAttribute('value', aValue ? '1' : '0');
              xvariant.AddChild(xvarprop);
              hasVariantData = true;
            };

            const effectiveDnp = symbol.ResolveDNP(sheet, variantName) || sheet.GetDNP(variantName);

            if (effectiveDnp !== baseDnp) varprop('dnp', effectiveDnp);

            const effectiveExcludedFromBOM =
              symbol.ResolveExcludedFromBOM(sheet, variantName) ||
              sheet.GetExcludedFromBOM(variantName);

            if (effectiveExcludedFromBOM !== baseExcludedFromBOM)
              varprop('exclude_from_bom', effectiveExcludedFromBOM);

            const effectiveExcludedFromSim =
              symbol.ResolveExcludedFromSim(sheet, variantName) ||
              sheet.GetExcludedFromSim(variantName);

            if (effectiveExcludedFromSim !== baseExcludedFromSim)
              varprop('exclude_from_sim', effectiveExcludedFromSim);

            const effectiveExcludedFromPosFiles = symbol.ResolveExcludedFromPosFiles(
              sheet,
              variantName,
            );

            if (effectiveExcludedFromPosFiles !== baseExcludedFromPosFiles)
              varprop('exclude_from_pos_files', effectiveExcludedFromPosFiles);

            const instance = new SCH_SYMBOL_INSTANCE();
            const variant =
              symbol.GetInstance(instance, sheet.Path()) && instance.m_Variants.has(variantName)
                ? instance.m_Variants.get(variantName)!
                : null;

            if (variant && variant.m_Fields.size > 0) {
              let xfields: XNODE | null = null;

              for (const [fieldName, fieldValue] of variant.m_Fields) {
                const baseValue = symbol.GetFieldText(fieldName, sheet, '');

                if (fieldValue === baseValue) continue;

                if (!xfields) xfields = node('fields');

                let resolvedValue = fieldValue;

                if (this.m_resolveTextVars) resolvedValue = symbol.ResolveText(fieldValue, sheet);

                const xfield = node('field', unescapeString(resolvedValue));
                xfield.AddAttribute('name', unescapeString(fieldName));
                xfields.AddChild(xfield);
                hasVariantData = true;
              }

              if (xfields) xvariant.AddChild(xfields);
            }

            if (hasVariantData) {
              if (!xvariants) xvariants = node('variants');

              xvariants.AddChild(xvariant);
            }
          }

          if (xvariants) xcomp.AddChild(xvariants);
        }

        const part = symbol.GetLibSymbolRef();

        if (part) {
          if (part.GetKeyWords().length) property('ki_keywords', part.GetKeyWords());

          if (part.GetFPFilters().length > 0) {
            let filters = '';

            for (const filter of part.GetFPFilters()) filters += ` ${filter}`;

            property('ki_fp_filters', filters.trimStart());
          }

          if (part.GetDuplicatePinNumbersAreJumpers())
            xcomp.AddChild(node('duplicate_pin_numbers_are_jumpers', '1'));

          const jumperGroups = part.JumperPinGroups();

          if (jumperGroups.length > 0) {
            const xproperty = node('jumper_pin_groups');
            xcomp.AddChild(xproperty);

            for (const group of jumperGroups) {
              const groupNode = node('group');
              xproperty.AddChild(groupNode);

              // std::set<wxString>: ordered.
              for (const pinName of [...group].sort(wxStringLess))
                groupNode.AddChild(node('pin', pinName));
            }
          }
        }

        const xsheetpath = node('sheetpath');
        xcomp.AddChild(xsheetpath);

        xsheetpath.AddAttribute('names', sheet.PathHumanReadable());
        xsheetpath.AddAttribute('tstamps', sheet.PathAsString());

        // Node for component class
        const compClassNames = this.getComponentClassNamesForAllSymbolUnits(
          symbol,
          sheet,
          sheetList,
        );

        if (compClassNames.length > 0) {
          const xcompclasslist = node('component_classes');
          xcomp.AddChild(xcompclasslist);

          for (const compClass of compClassNames)
            xcompclasslist.AddChild(node('class', unescapeString(compClass)));
        }

        const xunits = node('tstamps'); // Node for extra units
        xcomp.AddChild(xunits);

        const range = unitsOf(symbol);

        // Output a series of children with all UUIDs associated with the REFDES
        for (const extra of range) {
          let uuid = extra.m_Uuid;

          // Add a space between UUIDs, if not in KICAD mode (i.e.
          // using wxXmlDocument::Save()).  KICAD MODE has its own XNODE::Format function.
          if (!(aCtl & GNL_T.GNL_OPT_KICAD))
            // i.e. for .xml format
            uuid += ' ';

          xunits.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', uuid));
        }

        // Output the primary UUID
        xunits.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', symbol.m_Uuid));

        // Emit unit information (per-unit name and pins) after tstamps
        const xunitInfo = node('units');
        xcomp.AddChild(xunitInfo);

        const libSym = symbol.GetLibSymbolRef();

        if (libSym) {
          // A multi-unit symbol can resolve to a different lib symbol per placed unit
          // after unit-specific edits.  Export the unit metadata from the actual unit
          // instances's lib symbols; keep a fallback default unit info.
          const defaultUnitInfo = libSym.GetUnitPinInfo();
          const symbolByUnit = new Map<number, SCH_SYMBOL>();

          const addUnitSymbol = (aUnitSymbol: SCH_SYMBOL | null): void => {
            if (!aUnitSymbol) return;

            const unit = aUnitSymbol.GetUnitSelection(sheet);

            if (unit > 0 && !symbolByUnit.has(unit)) symbolByUnit.set(unit, aUnitSymbol);
          };

          addUnitSymbol(symbol);

          // Collect the other placed units that share this reference so each unit number
          // can be resolved back to the specific SCH_SYMBOL instance on the sheet.
          for (const extra of range) addUnitSymbol(extra);

          // Emit every unit slot from the default library symbol, but override that slot's
          // metadata with the placed unit's resolved library symbol when one exists.
          for (let unitIdx = 0; unitIdx < defaultUnitInfo.length; ++unitIdx) {
            let unitInfo = defaultUnitInfo[unitIdx]!;
            const unitSymbol = symbolByUnit.get(unitIdx + 1);

            if (unitSymbol) {
              const unitLibSym = unitSymbol.GetLibSymbolRef();

              if (unitLibSym) {
                const unitSpecificInfo = unitLibSym.GetUnitPinInfo();

                if (unitIdx < unitSpecificInfo.length) unitInfo = unitSpecificInfo[unitIdx]!;
              }
            }

            const xunit = node('unit');
            xunitInfo.AddChild(xunit);
            xunit.AddAttribute('name', unitInfo.m_unitName);

            const xpins = node('pins');
            xunit.AddChild(xpins);

            for (const number of unitInfo.m_pinNumbers) {
              const xpin = node('pin');
              xpins.AddChild(xpin);
              xpin.AddAttribute('num', number);
            }
          }
        }
      }
    }

    this.m_schematic.SetCurrentSheet(currentSheet);

    return xcomps;
  }

  /** `makeGroups`, as 10.0.6 writes it: instance-prefixed UUIDs, per-instance names. */
  protected makeGroups(): XNODE {
    const xcomps = node('groups');

    this.m_referencesAlreadyFound.Clear();
    // Do not clear m_libParts here: it is populated in makeSymbols() and used later by
    // makeLibParts() to emit the libparts section for CvPcb and other consumers.

    const currentSheet = this.m_schematic.CurrentSheet();
    const sheetList = this.m_schematic.Hierarchy();

    // 10.0.6: a screen used by several sheet instances names each instance's group apart.
    const screenVisits = new Map<unknown, number>();

    for (const sheet of sheetList)
      screenVisits.set(sheet.LastScreen(), (screenVisits.get(sheet.LastScreen()) ?? 0) + 1);

    for (const sheet of sheetList) {
      // Change schematic CurrentSheet in each iteration to allow hierarchical
      // resolution of text variables in sheet fields.
      this.m_schematic.SetCurrentSheet(sheet);

      const instancePrefix = sheet.PathAsString();

      for (const item of sheet.LastScreen()?.Items().OfType(KICAD_T.SCH_GROUP_T) ?? []) {
        const group = item as unknown as SCH_GROUP;
        let groupName = group.GetName();

        if ((screenVisits.get(sheet.LastScreen()) ?? 0) > 1)
          groupName = `${groupName} (${sheet.PathHumanReadable()})`;

        const xgroup = node('group');
        xcomps.AddChild(xgroup);

        xgroup.AddAttribute('name', groupName);
        xgroup.AddAttribute('uuid', instancePrefix + group.m_Uuid);
        xgroup.AddAttribute('lib_id', group.GetDesignBlockLibId().Format());

        const xmembers = node('members');
        xgroup.AddChild(xmembers);

        const member = (aUuid: string): void => {
          const xmember = node('member');
          xmembers.AddChild(xmember);
          xmember.AddAttribute('uuid', aUuid);
        };

        for (const m of group.GetItems()) {
          if (m.Type() === KICAD_T.SCH_SYMBOL_T) {
            member(instancePrefix + m.m_Uuid);
          } else if (m.Type() === KICAD_T.SCH_GROUP_T) {
            // Emit nested groups so the board side can rebuild the nesting.
            member(instancePrefix + m.m_Uuid);
          } else if (m.Type() === KICAD_T.SCH_SHEET_T) {
            const subSheetPath = sheet.Clone();
            const descendantSheets: SCH_SHEET_PATH[] = [];

            subSheetPath.push_back(m as unknown as SCH_SHEET);
            sheetList.GetSheetsWithinPath(descendantSheets, subSheetPath);

            for (const descendantSheet of descendantSheets) {
              for (const descendantItem of symbolsOn(descendantSheet))
                member(descendantSheet.PathAsString() + descendantItem.m_Uuid);
            }
          }
        }
      }
    }

    this.m_schematic.SetCurrentSheet(currentSheet);

    return xcomps;
  }

  /** `makeVariants`. */
  protected makeVariants(): XNODE {
    const xvariants = node('variants');

    for (const variantName of this.m_schematic.GetVariantNames()) {
      const xvariant = node('variant');
      xvariants.AddChild(xvariant);
      xvariant.AddAttribute('name', variantName);

      const description = this.m_schematic.GetVariantDescription(variantName);

      if (description !== '') xvariant.AddAttribute('description', description);
    }

    return xvariants;
  }

  /** `getComponentClassNamesForAllSymbolUnits`. */
  protected getComponentClassNamesForAllSymbolUnits(
    aSymbol: SCH_SYMBOL,
    aSymbolSheet: SCH_SHEET_PATH,
    aSheetList: SCH_SHEET_LIST,
  ): string[] {
    const symbolSheets: SCH_SHEET_PATH[] = [aSymbolSheet];

    const compClassNames = new Set(aSymbol.GetComponentClassNames(aSymbolSheet));
    const primaryUnit = aSymbol.GetUnitSelection(aSymbolSheet);

    if (aSymbol.GetUnitCount() > 1) {
      const ref = aSymbol.GetRef(aSymbolSheet);

      for (const sheet of aSheetList) {
        for (const symbol2 of symbolsOn(sheet)) {
          const ref2 = symbol2.GetRef(sheet);
          const otherUnit = symbol2.GetUnitSelection(sheet);

          if (ref2.toLowerCase() !== ref.toLowerCase()) continue;

          if (otherUnit === primaryUnit) continue;

          symbolSheets.push(sheet);

          for (const name of symbol2.GetComponentClassNames(sheet)) compClassNames.add(name);
        }
      }
    }

    // Add sheet-level component classes
    for (const [sheetPath, sheetCompClasses] of this.m_sheetComponentClasses) {
      for (const symbolSheetPath of symbolSheets) {
        if (symbolSheetPath.IsContainedWithin(sheetPath)) {
          for (const name of sheetCompClasses) compClassNames.add(name);
        }
      }
    }

    return [...compClassNames].sort(wxStringLess);
  }

  /** `makeDesignHeader`. */
  protected makeDesignHeader(): XNODE {
    const xdesign = node('design');

    // the root sheet is a special sheet, call it source
    xdesign.AddChild(node('source', this.m_schematic.GetFileName()));

    xdesign.AddChild(node('date', this.m_date()));

    // which Eeschema tool
    xdesign.AddChild(node('tool', `Eeschema ${GetBuildVersion()}`));

    const prj = this.m_schematic.Project();

    // std::map<wxString, wxString>: ordered by name.
    const properties = [...prj.GetTextVars()].sort(([a], [b]) => wxStringLess(a, b));

    for (const [name, value] of properties) {
      const xtextvar = node('textvar', value);
      xdesign.AddChild(xtextvar);
      xtextvar.AddAttribute('name', name);
    }

    /*
     *  Export the sheets information
     */
    let sheetIndex = 1; // Human readable index

    for (const sheet of this.m_schematic.Hierarchy()) {
      const screen = sheet.LastScreen()!;

      const xsheet = node('sheet');
      xdesign.AddChild(xsheet);

      // get the string representation of the sheet index number.
      xsheet.AddAttribute('number', String(sheetIndex++));
      xsheet.AddAttribute('name', sheet.PathHumanReadable());
      xsheet.AddAttribute('tstamps', sheet.PathAsString());

      const tb = screen.GetTitleBlock();

      const xtitleBlock = node('title_block');
      xsheet.AddChild(xtitleBlock);

      xtitleBlock.AddChild(node('title', expandProjectTextVars(tb.GetTitle(), prj)));
      xtitleBlock.AddChild(node('company', expandProjectTextVars(tb.GetCompany(), prj)));
      xtitleBlock.AddChild(node('rev', expandProjectTextVars(tb.GetRevision(), prj)));
      xtitleBlock.AddChild(node('date', expandProjectTextVars(tb.GetDate(), prj)));

      // We are going to remove the fileName directories.
      const fileName = screen.GetFileName();
      xtitleBlock.AddChild(node('source', fileName.slice(fileName.lastIndexOf('/') + 1)));

      for (let i = 0; i < 9; i++) {
        const xcomment = node('comment');
        xtitleBlock.AddChild(xcomment);
        xcomment.AddAttribute('number', String(i + 1));
        xcomment.AddAttribute('value', expandProjectTextVars(tb.GetComment(i), prj));
      }
    }

    return xdesign;
  }

  /** `makeLibraries`. */
  protected makeLibraries(): XNODE {
    const xlibs = node('libraries');

    // std::set<wxString>: ordered.
    for (const libNickname of [...this.m_libraries].sort(wxStringLess)) {
      const uri = this.m_libraryUri(libNickname);

      if (uri !== undefined) {
        const xlibrary = node('library');
        xlibs.AddChild(xlibrary);
        xlibrary.AddAttribute('logical', libNickname);
        xlibrary.AddChild(node('uri', uri));
      }

      // @todo: add more fun stuff here
    }

    return xlibs;
  }

  /** `makeLibParts`. */
  protected makeLibParts(): XNODE {
    const xlibparts = node('libparts');

    this.m_libraries.clear();

    for (const lcomp of this.m_libParts) {
      const libNickname = lcomp.GetLibId().GetLibNickname();

      // The library nickname will be empty if the cache library is used.
      if (libNickname !== '') this.m_libraries.add(libNickname); // inserts symbol's library if unique

      const xlibpart = node('libpart');
      xlibparts.AddChild(xlibpart);
      xlibpart.AddAttribute('lib', libNickname);
      xlibpart.AddAttribute('part', lcomp.GetName());

      //----- show the important properties -------------------------
      if (lcomp.GetDescription() !== '')
        xlibpart.AddChild(node('description', lcomp.GetDescription()));

      if (lcomp.GetDatasheetField().GetText() !== '')
        xlibpart.AddChild(node('docs', lcomp.GetDatasheetField().GetText()));

      // Write the footprint list
      if (lcomp.GetFPFilters().length) {
        const xfootprints = node('footprints');
        xlibpart.AddChild(xfootprints);

        for (const filter of lcomp.GetFPFilters()) {
          if (filter !== '') xfootprints.AddChild(node('fp', filter));
        }
      }

      //----- show the fields here ----------------------------------
      const fieldList: SCH_FIELD[] = [];
      lcomp.GetFields(fieldList);

      const xfields = node('fields');
      xlibpart.AddChild(xfields);

      for (const field of fieldList) {
        const xfield = node('field', field.GetText());
        xfields.AddChild(xfield);
        xfield.AddAttribute('name', field.GetCanonicalName());
      }

      //----- show the pins here ------------------------------------
      // NOTE: Expand stacked-pin notation into individual pins so downstream
      // tools (e.g. CvPcb) see the actual number of footprint pins.
      const pinList = lcomp.GetGraphicalPins(0, 0);

      /*
       * We must erase redundant Pins references in pinList
       * These redundant pins exist because some pins are found more than one time when a
       * symbol has multiple parts per package or has 2 representations (DeMorgan conversion).
       * For instance, a 74ls00 has DeMorgan conversion, with different pin shapes, and
       * therefore each pin  appears 2 times in the list. Common pins (VCC, GND) can also be
       * found more than once.
       */
      stdSort(pinList, sortPinsByNumber);

      for (let ii = 0; ii < pinList.length - 1; ii++) {
        if (pinList[ii]!.GetNumber() === pinList[ii + 1]!.GetNumber()) {
          // 2 pins have the same number, remove the redundant pin at index i+1
          pinList.splice(ii + 1, 1);
          ii--;
        }
      }

      if (pinList.length) {
        const pins = node('pins');
        xlibpart.AddChild(pins);

        for (const basePin of pinList) {
          const stackedValid = { value: false };
          const expandedNums = basePin.GetStackedPinNumbers(stackedValid);

          const addPin = (aNum: string): void => {
            const pin = node('pin');
            pins.AddChild(pin);
            pin.AddAttribute('num', aNum);
            pin.AddAttribute('name', basePin.GetShownName());
            pin.AddAttribute('type', basePin.GetCanonicalElectricalTypeName());
          };

          // If stacked notation detected and valid, emit one libparts pin per expanded number.
          if (stackedValid.value && expandedNums.length > 0) {
            for (const num of expandedNums) addPin(num);
          } else {
            addPin(basePin.GetShownNumber());
          }
        }
      }
    }

    return xlibparts;
  }

  /** `makeListOfNets`. */
  protected makeListOfNets(aCtl: number): XNODE {
    const xnets = node('nets');

    interface NET_NODE {
      m_Pin: SCH_PIN;
      m_Sheet: SCH_SHEET_PATH;
    }

    interface NET_RECORD {
      m_Name: string;
      m_Class: string;
      m_HasNoConnect: boolean;
      m_Nodes: NET_NODE[];
    }

    const nets: NET_RECORD[] = [];

    const netSettings = this.m_schematic.Project().GetProjectFile().NetSettings();

    for (const [key, subgraphs] of this.m_schematic.ConnectionGraph().GetNetMap()) {
      let net_name = key.Name;

      if (!(aCtl & GNL_T.GNL_OPT_KICAD)) net_name = unescapeString(net_name);

      if (subgraphs.length === 0) continue;

      const net_record: NET_RECORD = {
        m_Name: net_name,
        m_Class: '',
        m_HasNoConnect: false,
        m_Nodes: [],
      };
      nets.push(net_record);

      // Resolve the effective netclass by net name through NET_SETTINGS.
      if (netSettings) {
        const nc = netSettings.GetEffectiveNetClass(key.Name);

        if (nc) net_record.m_Class = unescapeString(nc.GetName());
      }

      for (const subgraph of subgraphs) {
        const noConnect = subgraph.GetNoConnect();
        const nc = noConnect !== null && noConnect.Type() === KICAD_T.SCH_NO_CONNECT_T;
        const sheet = subgraph.GetSheet();

        if (nc) net_record.m_HasNoConnect = true;

        for (const item of subgraph.GetItems()) {
          if (item.Type() === KICAD_T.SCH_PIN_T) {
            const pin = item as SCH_PIN;
            const parent = pin.GetParentSymbol();
            const symbol =
              parent && parent.Type() === KICAD_T.SCH_SYMBOL_T
                ? (parent as unknown as SCH_SYMBOL)
                : null;
            const forBOM = (aCtl & GNL_T.GNL_OPT_BOM) !== 0;
            const forBoard = (aCtl & GNL_T.GNL_OPT_KICAD) !== 0;

            if (!symbol) continue;

            if (forBOM && (sheet.GetExcludedFromBOM() || symbol.ResolveExcludedFromBOM())) continue;

            if (forBoard && (sheet.GetExcludedFromBoard() || symbol.ResolveExcludedFromBoard()))
              continue;

            net_record.m_Nodes.push({ m_Pin: pin, m_Sheet: sheet });
          }
        }
      }
    }

    const refOf = (n: NET_NODE): string => n.m_Pin.GetParentSymbol()!.GetRef(n.m_Sheet);

    // Netlist ordering: Net name, then ref des, then pin name
    stdSort(nets, (a, b) => strNumCmp(a.m_Name, b.m_Name) < 0);

    for (let i = 0; i < nets.length; ++i) {
      const net_record = nets[i]!;
      let added = false;
      let xnet: XNODE | null = null;

      // Netlist ordering: Net name, then ref des, then pin name
      stdSort(net_record.m_Nodes, (a, b) => {
        const refA = refOf(a);
        const refB = refOf(b);

        if (refA === refB) return a.m_Pin.GetShownNumber() < b.m_Pin.GetShownNumber();

        return refA < refB;
      });

      // Some duplicates can exist, for example on multi-unit parts with duplicated pins across
      // units.  If the user connects the pins on each unit, they will appear on separate
      // subgraphs.  Remove those here:
      net_record.m_Nodes = net_record.m_Nodes.filter(
        (n, k, all) =>
          k === 0 ||
          !(
            refOf(all[k - 1]!) === refOf(n) &&
            all[k - 1]!.m_Pin.GetShownNumber() === n.m_Pin.GetShownNumber()
          ),
      );

      // Determine if all pins in the net are stacked (nets with only one pin are implicitly
      // taken to be stacked)
      let allNetPinsStacked = true;

      if (net_record.m_Nodes.length > 1) {
        const firstPin = net_record.m_Nodes[0]!.m_Pin;
        allNetPinsStacked = net_record.m_Nodes
          .slice(1)
          .every(
            (n) =>
              firstPin.GetParent() === n.m_Pin.GetParent() &&
              firstPin.GetPosition().x === n.m_Pin.GetPosition().x &&
              firstPin.GetPosition().y === n.m_Pin.GetPosition().y &&
              firstPin.GetName() === n.m_Pin.GetName(),
          );
      }

      for (const netNode of net_record.m_Nodes) {
        const refText = refOf(netNode);

        // Skip power symbols and virtual symbols
        if (refText[0] === '#') continue;

        if (!added) {
          xnet = node('net');
          xnets.AddChild(xnet);
          xnet.AddAttribute('code', String(i + 1));
          xnet.AddAttribute('name', net_record.m_Name);
          xnet.AddAttribute('class', net_record.m_Class);

          added = true;
        }

        const nums = netNode.m_Pin.GetStackedPinNumbers();
        const baseName = netNode.m_Pin.GetShownName();
        const pinType = netNode.m_Pin.GetCanonicalElectricalTypeName();

        for (const num of nums) {
          const xnode = node('node');
          xnet!.AddChild(xnode);
          xnode.AddAttribute('ref', refText);
          xnode.AddAttribute('pin', num);

          const fullName = baseName === '' ? num : `${baseName}_${num}`;

          if (baseName !== '' || nums.length > 1) xnode.AddAttribute('pinfunction', fullName);

          let typeAttr = pinType;

          if (net_record.m_HasNoConnect && (net_record.m_Nodes.length === 1 || allNetPinsStacked))
            typeAttr += '+no_connect';

          xnode.AddAttribute('pintype', typeAttr);
        }
      }
    }

    return xnets;
  }

  /** `getSheetComponentClasses`. */
  private getSheetComponentClasses(): void {
    this.m_sheetComponentClasses.clear();

    const sheetList = this.m_schematic.Hierarchy();

    const getComponentClassFields = (
      fields: readonly SCH_FIELD[],
      sheetPath: SCH_SHEET_PATH,
    ): Set<string> => {
      const componentClasses = new Set<string>();

      for (const field of fields) {
        if (field.GetCanonicalName() === 'Component Class') {
          if (field.GetShownText(sheetPath, false) !== '')
            componentClasses.add(field.GetShownText(sheetPath, false));
        }
      }

      return componentClasses;
    };

    for (const sheet of sheetList) {
      for (const item of sheet.LastScreen()?.Items().OfType(KICAD_T.SCH_SHEET_T) ?? []) {
        const sheetItem = item as unknown as SCH_SHEET;
        const sheetComponentClasses = new Set<string>();
        const sheetRuleAreas: ReadonlySet<SCH_RULE_AREA> = sheetItem.GetRuleAreaCache();

        for (const ruleArea of sheetRuleAreas) {
          for (const label of ruleArea.GetDirectives()) {
            for (const name of getComponentClassFields(label.GetFields(), sheet))
              sheetComponentClasses.add(name);
          }
        }

        const newPath = sheet.Clone();
        newPath.push_back(sheetItem);

        this.m_sheetComponentClasses.set(newPath, sheetComponentClasses);
      }
    }
  }
}

/** `wxString::Cmp`: code-point order. */
function wxStringLess(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `sortPinsByNumber`. */
function sortPinsByNumber(aPin1: SCH_PIN, aPin2: SCH_PIN): boolean {
  // return "lhs < rhs"
  return strNumCmp(aPin1.GetShownNumber(), aPin2.GetShownNumber(), true) < 0;
}
