// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The KiCad (s-expression) netlist. Counterparts:
 *  - `eeschema/netlist_exporters/netlist_exporter_kicad.cpp`
 *    (NETLIST_EXPORTER_KICAD, `Format( out, GNL_ALL | GNL_OPT_KICAD )`),
 *  - `eeschema/netlist_exporters/netlist_exporter_xml.cpp`
 *    (NETLIST_EXPORTER_XML::makeRoot and its section builders),
 *  - `common/xnode.cpp` (XNODE::Format, in `common/xnode.ts`, which prints the
 *    node tree as s-expressions: an element becomes `(name (attr "value") …
 *    children)` and a text node a bare `"string"`).
 *
 * This is the schematic side of "Update PCB from Schematic": pcbnew reads what
 * this writes with KICAD_NETLIST_PARSER. Because both ends of the handoff are a
 * file format rather than a shared object graph, the board never has to reach into
 * the schematic model, exactly the separation upstream gets from kiway mail.
 *
 * Unlike {@link netlistKicadXml} in ./netlist.ts (the generic XML netlist for
 * external tools, still single-sheet), this exporter walks the whole hierarchy:
 * one `(comp …)` per board-bound symbol instance of every sheet instance, and nets
 * named by the hierarchy-wide connection graph.
 *
 * Not emitted, because the schematic model has no counterpart yet: design
 * variants (`(variants …)`), component classes (`(component_classes …)`) and
 * sheet-level DNP / exclude-from-board attributes.
 */

import { PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { XNODE, wxXmlNodeType } from '@ziroeda/common/xnode.js';
import { arg, childrenNamed } from '@ziroeda/sexpr/query.js';
import { computeHierarchyNetlist, type HierSheet } from '../connectivity/hierarchy.js';
import { enumeratePins, type Netlist, type PinNode } from '../connectivity/nets.js';
import { resolvePadNumbers } from '../sch_pin.js';
import { refId } from '../tools/hittest.js';
import type { LibSymbol, Schematic, SchSymbol } from '../types.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { GetUnitPinInfo } from '../lib_symbol.js';

// ----- NETLIST_EXPORTER_XML::node --------------------------------------------

/**
 * `NETLIST_EXPORTER_XML::node`: a new element, with a text child only when
 * `aTextualContent` is not empty - so an empty title prints `(title)`, not
 * `(title "")`.
 */
function node(aName: string, aTextualContent = ''): XNODE {
  const n = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, aName);

  if (aTextualContent.length > 0) {
    // excludes wxEmptyString, the parameter's default value
    n.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', aTextualContent));
  }

  return n;
}

// ----- inputs -----------------------------------------------------------------

/** One sheet instance of the hierarchy, with the two path spellings the netlist needs. */
export interface NetlistSheet extends HierSheet {
  /** SCH_SHEET_PATH::PathHumanReadable, "/" or "/Power/Filter/". */
  namePath: string;
}

export interface KicadNetlistInput {
  /** SCH_SHEET_LIST: every sheet instance, in hierarchy (depth-first) order. */
  sheets: readonly NetlistSheet[];
  /** The lib_symbols cache of a sheet's document. */
  libsFor: (sheet: NetlistSheet) => Map<string, LibSymbol>;
  /** The root schematic's file name, the `(design (source …))` header. */
  source: string;
  /** Bus alias definitions, so bus members expand as the editor sees them. */
  busAliases?: ReadonlyMap<string, readonly string[]>;
  /** Project text variables, the `(design (textvar …))` entries. */
  textVars?: ReadonlyMap<string, string>;
  /** The effective netclass of a net name, for `(net … (class …))`. */
  netClassFor?: (netName: string) => string;
  /**
   * The pad numbers a footprint carries, keyed by its LIB_ID, the footprintPads
   * cache NETLIST_EXPORTER_BASE::resolvePadNumbers consults so a remapped symbol
   * pin lands on the right pad. Omit it and pin numbers are used as pad numbers.
   */
  footprintPads?: ReadonlyMap<string, ReadonlySet<string>>;
  /** `(design (date …))`; defaults to now, like GetISO8601CurrentDateTime. */
  date?: string;
  /** `(design (tool …))`. */
  tool?: string;
  /**
   * The top-level sheet's name, which its `Sheetname` property carries: the
   * project's `schematic.top_level_sheets` entry for the root file, else
   * `_( "Root" )` - the name KiCad gives a root sheet with none
   * (eeschema_helpers.cpp:131, files-io.cpp:359). Defaults to "Root".
   */
  rootSheetName?: string;
}

// ----- small helpers ----------------------------------------------------------

const fieldOf = (sym: SchSymbol, key: string): string =>
  sym.fields.find((f) => f.key === key)?.value ?? '';

/** The mandatory symbol fields, which are emitted as their own elements. */
const MANDATORY_FIELDS = new Set(['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']);

/**
 * A pin name of "~" means "unnamed": every schematic file this build reads is
 * older than 20250318, and the parser normalises "~" to empty for those
 * (sch_io_kicad_sexpr_parser.cpp, T_name).
 */
const shownName = (name: string): string => (name === '~' ? '' : name);

/** LIB_ID -> its nickname and item name ("Device:R" -> "Device", "R"). */
function splitLibId(libId: string): { lib: string; part: string } {
  const i = libId.indexOf(':');
  return i === -1 ? { lib: '', part: libId } : { lib: libId.slice(0, i), part: libId.slice(i + 1) };
}

/** A symbol's reference designator, "?" when it has none. */
const refOf = (sym: SchSymbol): string => fieldOf(sym, 'Reference') || '?';

/**
 * The primary and extra units of one reference on one sheet, as makeSymbols works
 * them out: the unit with the lowest UUID is the primary `(comp …)`, every other
 * unit of the same reference contributes only its UUID to `(tstamps …)`.
 */
interface SymbolInstance {
  sym: SchSymbol;
  index: number;
  ref: string;
  extraUnits: { sym: SchSymbol; index: number }[];
}

function orderedSymbols(doc: Schematic): SymbolInstance[] {
  const byRef = new Map<string, { sym: SchSymbol; index: number }[]>();
  doc.symbols.forEach((sym, index) => {
    const ref = refOf(sym);
    const arr = byRef.get(ref) ?? [];
    arr.push({ sym, index });
    byRef.set(ref, arr);
  });

  const out: SymbolInstance[] = [];
  for (const [ref, units] of byRef) {
    // "( *( test.first ) )->m_Uuid > symbol->m_Uuid", the lowest UUID wins the
    // ordered_symbols slot, the rest become extra_units.
    const sorted = [...units].sort((a, b) => (a.sym.uuid ?? '').localeCompare(b.sym.uuid ?? ''));
    const primary = sorted[0]!;
    out.push({ sym: primary.sym, index: primary.index, ref, extraUnits: sorted.slice(1) });
  }

  // std::set<SCH_SYMBOL*, cmp> ordering: StrNumCmp( ref, ref, true ).
  return out.sort((a, b) => strNumCmp(a.ref, b.ref, true));
}

// ----- sections ---------------------------------------------------------------

/** NETLIST_EXPORTER_XML::makeDesignHeader. */
function makeDesignHeader(input: KicadNetlistInput): XNODE {
  const xdesign = node('design');
  xdesign.AddChild(node('source', input.source));
  xdesign.AddChild(node('date', input.date ?? new Date().toISOString()));
  xdesign.AddChild(node('tool', input.tool ?? 'Eeschema'));

  for (const [name, value] of input.textVars ?? new Map<string, string>()) {
    const xtextvar = node('textvar', value);
    xdesign.AddChild(xtextvar);
    xtextvar.AddAttribute('name', name);
  }

  let sheetIndex = 1; // Human readable index
  for (const sheet of input.sheets) {
    const xsheet = node('sheet');
    xdesign.AddChild(xsheet);
    xsheet.AddAttribute('number', String(sheetIndex++));
    xsheet.AddAttribute('name', sheet.namePath);
    xsheet.AddAttribute('tstamps', sheet.path);

    const tb = sheet.doc.titleBlock;
    const xtitleBlock = node('title_block');
    xsheet.AddChild(xtitleBlock);
    xtitleBlock.AddChild(node('title', tb?.title ?? ''));
    xtitleBlock.AddChild(node('company', tb?.company ?? ''));
    xtitleBlock.AddChild(node('rev', tb?.rev ?? ''));
    xtitleBlock.AddChild(node('date', tb?.date ?? ''));
    xtitleBlock.AddChild(node('source', sheet.file));
    // TITLE_BLOCK::GetComment( 0..8 ), the typed model does not carry the nine
    // comment lines, so they are read from the block's own `(comment N "…")`.
    const comments = tb ? childrenNamed(tb.source, 'comment') : [];
    for (let i = 0; i < 9; i++) {
      const comment = comments.find((c) => arg(c, 0) === String(i + 1));
      const xcomment = node('comment');
      xtitleBlock.AddChild(xcomment);
      xcomment.AddAttribute('number', String(i + 1));
      xcomment.AddAttribute('value', comment ? (arg(comment, 1) ?? '') : '');
    }
  }

  return xdesign;
}

/**
 * NETLIST_EXPORTER_XML::addSymbolFields, the value / footprint / datasheet /
 * description elements and the `(fields …)` block. For a multi-unit symbol each
 * unit may carry its own field values, so the lowest-numbered unit with a
 * non-blank value wins for each field name (upstream's "scavenger algorithm").
 */
function addSymbolFields(
  xcomp: XNODE,
  instance: SymbolInstance,
  libById: Map<string, LibSymbol>,
): void {
  const fields = new Map<string, string>();
  let value = '';
  let footprint = '';
  let datasheet = '';
  let description = '';

  const unitCount = libById.get(schSymbolLibraryName(instance.sym))?.units.length ?? 1;

  if (unitCount > 1) {
    let minUnit = instance.sym.unit;
    const candidates = [{ sym: instance.sym, index: instance.index }, ...instance.extraUnits];

    for (const { sym } of candidates) {
      const unit = sym.unit;
      const take = (current: string, candidate: string): string =>
        candidate !== '' && (unit < minUnit || current === '') ? candidate : current;

      value = take(value, fieldOf(sym, 'Value'));
      footprint = take(footprint, fieldOf(sym, 'Footprint'));
      datasheet = take(datasheet, fieldOf(sym, 'Datasheet'));
      description = take(description, fieldOf(sym, 'Description'));

      for (const field of sym.fields) {
        if (MANDATORY_FIELDS.has(field.key)) continue;
        if (unit < minUnit || !fields.has(field.key)) fields.set(field.key, field.value);
      }

      minUnit = Math.min(unit, minUnit);
    }
  } else {
    value = fieldOf(instance.sym, 'Value');
    footprint = fieldOf(instance.sym, 'Footprint');
    datasheet = fieldOf(instance.sym, 'Datasheet');
    description = fieldOf(instance.sym, 'Description');

    for (const field of instance.sym.fields) {
      if (MANDATORY_FIELDS.has(field.key)) continue;
      fields.set(field.key, field.value);
    }
  }

  fields.set('Footprint', footprint);
  fields.set('Datasheet', datasheet);
  fields.set('Description', description);

  // Do not output field values blank in netlist, except Value, which is always
  // written (as "~" when empty).
  xcomp.AddChild(node('value', value !== '' ? value : '~'));
  if (footprint !== '') xcomp.AddChild(node('footprint', footprint));
  if (datasheet !== '') xcomp.AddChild(node('datasheet', datasheet));
  if (description !== '') xcomp.AddChild(node('description', description));

  const xfields = node('fields');
  xcomp.AddChild(xfields);
  for (const [name, fieldValue] of fields) {
    const xfield = node('field', fieldValue);
    xfields.AddChild(xfield);
    xfield.AddAttribute('name', name);
  }
}

/** NETLIST_EXPORTER_XML::makeSymbols, restricted to GNL_OPT_KICAD (board) mode. */
function makeSymbols(input: KicadNetlistInput, usedLibIds: Set<string>): XNODE {
  const xcomps = node('components');

  for (const sheet of input.sheets) {
    const libById = input.libsFor(sheet);

    for (const instance of orderedSymbols(sheet.doc)) {
      const { sym } = instance;

      // findNextSymbol: power symbols and other symbols whose reference starts with
      // "#" are pseudo/virtual and are never in the netlist.
      if (instance.ref.startsWith('#')) continue;

      // forBoard: a symbol excluded from the board contributes nothing to the PCB.
      if (!sym.onBoard) continue;

      const xcomp = node('comp');
      xcomps.AddChild(xcomp);
      xcomp.AddAttribute('ref', instance.ref);
      addSymbolFields(xcomp, instance, libById);

      const lib = libById.get(schSymbolLibraryName(sym));
      const { lib: libName, part: partName } = splitLibId(sym.libId);
      usedLibIds.add(sym.libId);

      const xlibsource = node('libsource');
      xcomp.AddChild(xlibsource);
      xlibsource.AddAttribute('lib', libName);
      xlibsource.AddAttribute('part', partName);
      xlibsource.AddAttribute(
        'description',
        lib?.properties.find((p) => p.key === 'Description')?.value ?? '',
      );

      /** `xcomp->AddChild( xproperty = node( "property" ) )` and its attributes. */
      const addProperty = (aName: string, aValue?: string): void => {
        const xproperty = node('property');
        xcomp.AddChild(xproperty);
        xproperty.AddAttribute('name', aName);
        if (aValue !== undefined) xproperty.AddAttribute('value', aValue);
      };

      // The symbol's own non-mandatory fields, as properties.
      for (const field of sym.fields) {
        if (MANDATORY_FIELDS.has(field.key)) continue;
        addProperty(field.key, field.value);
      }

      // The sheet symbol's fields (Sheetname / Sheetfile / user fields), how the
      // board learns which sheet a footprint belongs to.
      for (const sheetField of parentSheetFields(input, sheet)) {
        addProperty(sheetField.key, sheetField.value);
      }

      // Valueless flag properties (a property with no value is the flag itself).
      if (!sym.inBom) addProperty('exclude_from_bom');
      if (!sym.onBoard) addProperty('exclude_from_board');
      if (sym.excludedFromPosFiles) addProperty('exclude_from_pos_files');
      if (sym.dnp) addProperty('dnp');

      if (lib) {
        const keywords = lib.properties.find((p) => p.key === 'ki_keywords')?.value ?? '';
        if (keywords !== '') addProperty('ki_keywords', keywords);

        const filters = lib.properties.find((p) => p.key === 'ki_fp_filters')?.value ?? '';
        if (filters !== '') addProperty('ki_fp_filters', filters);

        if (lib.duplicatePinNumbersAreJumpers)
          xcomp.AddChild(node('duplicate_pin_numbers_are_jumpers', '1'));

        const jumperGroups = lib.jumperPinGroups ?? [];
        if (jumperGroups.length > 0) {
          const xgroups = node('jumper_pin_groups');
          xcomp.AddChild(xgroups);
          for (const group of jumperGroups) {
            const xgroup = node('group');
            xgroups.AddChild(xgroup);
            for (const pinName of group) xgroup.AddChild(node('pin', pinName));
          }
        }
      }

      const xsheetpath = node('sheetpath');
      xcomp.AddChild(xsheetpath);
      xsheetpath.AddAttribute('names', sheet.namePath);
      xsheetpath.AddAttribute('tstamps', sheet.path);

      // Every UUID that shares this reference: the extra units first, the primary
      // last (BOARD_NETLIST_UPDATER links the footprint to the *first* one, so the
      // ordering matters, upstream emits extras then the primary).
      const xunits = node('tstamps');
      xcomp.AddChild(xunits);
      const addTstamp = (aUuid: string): void =>
        xunits.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', aUuid));
      for (const extra of instance.extraUnits) addTstamp(extra.sym.uuid ?? '');
      addTstamp(sym.uuid ?? '');

      // Per-unit name and pin numbers, for gate-swap metadata on the board side:
      // LIB_SYMBOL::GetUnitPinInfo, one slot per unit of the library symbol
      // (netlist_exporter_xml.cpp:660-690).
      const xunitInfo = node('units');
      xcomp.AddChild(xunitInfo);
      if (lib) {
        for (const unitInfo of GetUnitPinInfo(lib)) {
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

  return xcomps;
}

/**
 * The fields of the sheet symbol that opens `sheet`, Sheetname and Sheetfile, the
 * properties BOARD_NETLIST_UPDATER copies onto the footprint. The root sheet has
 * no parent sheet symbol and so contributes none.
 */
function parentSheetFields(
  input: KicadNetlistInput,
  sheet: NetlistSheet,
): { key: string; value: string }[] {
  // The root has no parent sheet symbol, but `sheet.Last()` is still a SCH_SHEET with
  // the two mandatory fields: its name (see rootSheetName), and the root schematic's
  // own file.
  if (sheet.path === '/') {
    return [
      { key: 'Sheetname', value: input.rootSheetName ?? 'Root' },
      { key: 'Sheetfile', value: sheet.file },
    ];
  }
  const parts = sheet.path.split('/').filter(Boolean);
  const sheetUuid = parts[parts.length - 1]!;
  const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}/` : '/';
  const parent = input.sheets.find((s) => s.path === parentPath);
  if (!parent) return [];
  const sheetSymbol = parent.doc.sheets.find((sh, i) => (sh.uuid || `i${i}`) === sheetUuid);
  return sheetSymbol ? sheetSymbol.fields.map((f) => ({ key: f.key, value: f.value })) : [];
}

/**
 * NETLIST_EXPORTER_XML::makeGroups, the symbol groups whose members should become
 * PCB groups. Group and member UUIDs are prefixed with the sheet instance path, so
 * a group on a shared sheet yields one group per instance; a group name is
 * qualified with the instance path when its sheet is used more than once.
 */
function makeGroups(input: KicadNetlistInput): XNODE {
  const xgroups = node('groups');

  const screenVisits = new Map<string, number>();
  for (const sheet of input.sheets)
    screenVisits.set(sheet.file, (screenVisits.get(sheet.file) ?? 0) + 1);

  for (const sheet of input.sheets) {
    const instancePrefix = sheet.path.endsWith('/') ? sheet.path : `${sheet.path}/`;

    for (const group of sheet.doc.groups) {
      let groupName = group.name;
      if ((screenVisits.get(sheet.file) ?? 0) > 1) groupName = `${groupName} (${sheet.namePath})`;

      const xgroup = node('group');
      xgroups.AddChild(xgroup);
      xgroup.AddAttribute('name', groupName);
      xgroup.AddAttribute('uuid', instancePrefix + (group.uuid ?? ''));
      xgroup.AddAttribute('lib_id', group.libId ?? '');

      const xmembers = node('members');
      xgroup.AddChild(xmembers);
      for (const member of group.members) {
        const xmember = node('member');
        xmembers.AddChild(xmember);
        xmember.AddAttribute('uuid', instancePrefix + member);
      }
    }
  }

  return xgroups;
}

/** NETLIST_EXPORTER_XML::makeLibParts. */
function makeLibParts(
  input: KicadNetlistInput,
  usedLibIds: ReadonlySet<string>,
  libraries: Set<string>,
): XNODE {
  const xlibparts = node('libparts');

  // One entry per distinct library symbol used anywhere in the hierarchy.
  const libSymbols = new Map<string, LibSymbol>();
  for (const sheet of input.sheets) {
    const libById = input.libsFor(sheet);
    for (const libId of usedLibIds) {
      if (libSymbols.has(libId)) continue;
      const lib = libById.get(libId);
      if (lib) libSymbols.set(libId, lib);
    }
  }

  for (const [libId, lib] of libSymbols) {
    const { lib: libNickname, part } = splitLibId(libId);
    if (libNickname !== '') libraries.add(libNickname);

    const xlibpart = node('libpart');
    xlibparts.AddChild(xlibpart);
    xlibpart.AddAttribute('lib', libNickname);
    xlibpart.AddAttribute('part', part);

    const property = (key: string): string =>
      lib.properties.find((p) => p.key === key)?.value ?? '';

    const description = property('Description');
    if (description !== '') xlibpart.AddChild(node('description', description));

    const datasheet = property('Datasheet');
    if (datasheet !== '') xlibpart.AddChild(node('docs', datasheet));

    const filters = property('ki_fp_filters').split(/\s+/).filter(Boolean);
    if (filters.length > 0) {
      const xfootprints = node('footprints');
      xlibpart.AddChild(xfootprints);
      for (const filter of filters) xfootprints.AddChild(node('fp', filter));
    }

    const xfields = node('fields');
    xlibpart.AddChild(xfields);
    for (const field of lib.properties) {
      const xfield = node('field', field.value);
      xfields.AddChild(xfield);
      xfield.AddAttribute('name', field.key);
    }

    // Every pin of the symbol, de-duplicated by number (a multi-unit or DeMorgan
    // symbol repeats VCC/GND pins), sorted by number, and expanded through
    // stacked-pin notation so consumers see the real pad count.
    const pins = lib.units.flatMap((u) => u.pins);
    const byNumber = new Map<string, (typeof pins)[number]>();
    for (const pin of pins) if (!byNumber.has(pin.number)) byNumber.set(pin.number, pin);
    const sorted = [...byNumber.values()].sort((a, b) => strNumCmp(a.number, b.number, true));

    if (sorted.length > 0) {
      const xpins = node('pins');
      xlibpart.AddChild(xpins);
      for (const pin of sorted) {
        const xpin = node('pin');
        xpins.AddChild(xpin);
        xpin.AddAttribute('num', pin.number);
        xpin.AddAttribute('name', shownName(pin.name));
        xpin.AddAttribute('type', pin.electricalType);
      }
    }
  }

  return xlibparts;
}

/** NETLIST_EXPORTER_XML::makeLibraries. */
function makeLibraries(libraries: ReadonlySet<string>): XNODE {
  const xlibs = node('libraries');
  for (const name of [...libraries].sort()) {
    const xlibrary = node('library');
    xlibs.AddChild(xlibrary);
    xlibrary.AddAttribute('logical', name);
    xlibrary.AddChild(node('uri', ''));
  }
  return xlibs;
}

/** One node of one net: the pin, and the sheet instance it sits on. */
interface NetNode {
  sheet: NetlistSheet;
  sym: SchSymbol;
  lib: LibSymbol | undefined;
  pin: PinNode;
}

/** NETLIST_EXPORTER_XML::makeListOfNets. */
function makeListOfNets(input: KicadNetlistInput): XNODE {
  const xnets = node('nets');

  // Build the net map the way CONNECTION_GRAPH::GetNetMap presents it: net name ->
  // every pin on it, across every sheet instance of the hierarchy.
  const hier = computeHierarchyNetlist(input.sheets, (s) => input.libsFor(s as NetlistSheet), {
    ...(input.busAliases ? { busAliases: input.busAliases } : {}),
  });

  const nodesByNet = new Map<string, NetNode[]>();
  const noConnectNets = new Set<string>();

  for (const sheet of input.sheets) {
    const netlist: Netlist | undefined = hier.bySheet.get(sheet.path);
    if (!netlist) continue;
    const libById = input.libsFor(sheet);
    const nameOf = (itemId: string): string | undefined => {
      const code = netlist.netByItem.get(itemId);
      return netlist.nets.find((n) => n.code === code)?.name;
    };

    const symByRefId = new Map<string, SchSymbol>();
    sheet.doc.symbols.forEach((sym, i) => {
      symByRefId.set(refId('symbol', sym.uuid, i), sym);
    });

    for (const pin of enumeratePins(sheet.doc, libById)) {
      const name = nameOf(pin.id);
      if (name === undefined) continue;
      const sym = symByRefId.get(pin.symId);
      if (!sym) continue;
      // forBoard: pins of symbols excluded from the board are not nodes.
      if (!sym.onBoard) continue;
      const arr = nodesByNet.get(name) ?? [];
      arr.push({ sheet, sym, lib: libById.get(schSymbolLibraryName(sym)), pin });
      nodesByNet.set(name, arr);
    }

    sheet.doc.noConnects.forEach((nc, i) => {
      const name = nameOf(refId('noconnect', nc.uuid, i));
      if (name !== undefined) noConnectNets.add(name);
    });
  }

  // Netlist ordering: net name, then ref des, then pin name.
  const netNames = [...nodesByNet.keys()].sort((a, b) => strNumCmp(a, b));

  netNames.forEach((netName, i) => {
    const nodes = nodesByNet.get(netName)!;

    nodes.sort((a, b) => {
      const refA = refOf(a.sym);
      const refB = refOf(b.sym);
      if (refA === refB)
        return a.pin.number < b.pin.number ? -1 : a.pin.number > b.pin.number ? 1 : 0;
      return refA < refB ? -1 : 1;
    });

    // Some duplicates can exist, for example on multi-unit parts with duplicated
    // pins across units: alg::remove_duplicates over (ref, shown number).
    const deduped: NetNode[] = [];
    for (const netNode of nodes) {
      const last = deduped[deduped.length - 1];
      if (last && refOf(last.sym) === refOf(netNode.sym) && last.pin.number === netNode.pin.number)
        continue;
      deduped.push(netNode);
    }

    // Nets with only one pin are implicitly taken to be stacked.
    let allNetPinsStacked = true;
    if (deduped.length > 1) {
      const first = deduped[0]!;
      allNetPinsStacked = deduped
        .slice(1)
        .every(
          (n) =>
            n.pin.symId === first.pin.symId &&
            n.pin.at.x === first.pin.at.x &&
            n.pin.at.y === first.pin.at.y &&
            n.pin.name === first.pin.name,
        );
    }

    const hasNoConnect = noConnectNets.has(netName);
    let xnet: XNODE | null = null;

    for (const netNode of deduped) {
      const refText = refOf(netNode.sym);

      // Skip power symbols and virtual symbols.
      if (refText.startsWith('#')) continue;

      const footprintLibId = fieldOf(netNode.sym, 'Footprint');
      const nums = resolvePadNumbers(
        netNode.pin.number,
        netNode.sym,
        netNode.lib,
        footprintLibId,
        input.footprintPads?.get(footprintLibId),
      );

      // An unmapped pin contributes no pad, so skip it and do not open an empty
      // net for it.
      if (nums.length === 0) continue;

      const baseName = shownName(netNode.pin.name);
      const pinType = netNode.pin.electricalType;

      if (!xnet) {
        xnet = node('net');
        xnets.AddChild(xnet);
        xnet.AddAttribute('code', String(i + 1));
        xnet.AddAttribute('name', netName);
        xnet.AddAttribute('class', input.netClassFor?.(netName) ?? '');
      }

      for (const num of nums) {
        const xnode = node('node');
        xnet.AddChild(xnode);
        xnode.AddAttribute('ref', refText);
        xnode.AddAttribute('pin', num);

        const fullName = baseName === '' ? num : `${baseName}_${num}`;
        if (baseName !== '' || nums.length > 1) xnode.AddAttribute('pinfunction', fullName);

        const typeAttr =
          hasNoConnect && (deduped.length === 1 || allNetPinsStacked)
            ? `${pinType}+no_connect`
            : pinType;
        xnode.AddAttribute('pintype', typeAttr);
      }
    }
  });

  return xnets;
}

// ----- root -------------------------------------------------------------------

/**
 * NETLIST_EXPORTER_XML::makeRoot( GNL_ALL | GNL_OPT_KICAD ), the whole netlist as
 * one S-expression node, in the section order pcbnew's parser expects.
 */
export function makeKicadNetlistNode(input: KicadNetlistInput): XNODE {
  const xroot = node('export');
  xroot.AddAttribute('version', 'E');

  xroot.AddChild(makeDesignHeader(input));

  const usedLibIds = new Set<string>();
  xroot.AddChild(makeSymbols(input, usedLibIds));
  xroot.AddChild(makeGroups(input));

  const libraries = new Set<string>();
  xroot.AddChild(makeLibParts(input, usedLibIds, libraries));
  // Must follow makeLibParts, which collects the library nicknames.
  xroot.AddChild(makeLibraries(libraries));

  xroot.AddChild(makeListOfNets(input));

  return xroot;
}

/**
 * NETLIST_EXPORTER_KICAD::WriteNetlist: `Format` into a
 * PRETTIFIED_FILE_OUTPUTFORMATTER, which is `xroot->Format( aOut )` prettified.
 */
export function netlistKicad(input: KicadNetlistInput): string {
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  makeKicadNetlistNode(input).Format(formatter);
  return formatter.Finish();
}
