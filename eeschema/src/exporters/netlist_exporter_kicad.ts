// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The KiCad (s-expression) netlist. Counterparts:
 *  - `eeschema/netlist_exporters/netlist_exporter_kicad.cpp`
 *    (NETLIST_EXPORTER_KICAD, `Format( out, GNL_ALL | GNL_OPT_KICAD )`),
 *  - `eeschema/netlist_exporters/netlist_exporter_xml.cpp`
 *    (NETLIST_EXPORTER_XML::makeRoot and its section builders),
 *  - `common/xnode.cpp` (XNODE::Format, which prints the very same node tree as
 *    s-expressions: an element becomes `(name (attr "value") … children)` and a
 *    text node becomes a bare `"string"`).
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

import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import { atom, list, str, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { arg, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { computeHierarchyNetlist, type HierSheet } from '../connectivity/hierarchy.js';
import { enumeratePins, type Netlist, type PinNode } from '../connectivity/nets.js';
import { resolvePadNumbers } from '../sch_pin.js';
import { refId } from '../tools/hittest.js';
import type { LibSymbol, Schematic, SchSymbol } from '../types.js';

// ----- XNODE (common/xnode.cpp), as an S-expression tree ----------------------

/**
 * One element of the netlist tree. `attrs` are XNODE attributes, which
 * XNODE::FormatContents prints first as `(name "value")` children; `text` is the
 * element's text content, printed as a bare quoted string.
 */
class XNODE {
  readonly attrs: [string, string][] = [];
  readonly children: XNODE[] = [];
  /** Bare text children, in order (`(tstamps "uuid" "uuid")`). */
  readonly texts: string[] = [];

  constructor(
    readonly name: string,
    text?: string,
  ) {
    if (text !== undefined) this.texts.push(text);
  }

  /** XNODE::AddAttribute. */
  attr(name: string, value: string): this {
    this.attrs.push([name, value]);
    return this;
  }

  /** XNODE::AddChild, returning the child so it can be filled in. */
  child(child: XNODE): XNODE {
    this.children.push(child);
    return child;
  }

  /** AddChild( node( name, text ) ), the common leaf case. */
  leaf(name: string, text: string): XNODE {
    return this.child(new XNODE(name, text));
  }

  /** XNODE::Format, attributes, then text, then element children. */
  toSList(): SList {
    const items: SNode[] = [atom(this.name)];
    for (const [name, value] of this.attrs) items.push(list(atom(name), str(value)));
    for (const text of this.texts) items.push(str(text));
    for (const child of this.children) items.push(child.toSList());
    return { kind: 'list', items };
  }
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
  const xdesign = new XNODE('design');
  xdesign.leaf('source', input.source);
  xdesign.leaf('date', input.date ?? new Date().toISOString());
  xdesign.leaf('tool', input.tool ?? 'Eeschema');

  for (const [name, value] of input.textVars ?? new Map())
    xdesign.leaf('textvar', value).attr('name', name);

  let sheetIndex = 1; // Human readable index
  for (const sheet of input.sheets) {
    const xsheet = xdesign.child(new XNODE('sheet'));
    xsheet.attr('number', String(sheetIndex++));
    xsheet.attr('name', sheet.namePath);
    xsheet.attr('tstamps', sheet.path);

    const tb = sheet.doc.titleBlock;
    const xtitleBlock = xsheet.child(new XNODE('title_block'));
    xtitleBlock.leaf('title', tb?.title ?? '');
    xtitleBlock.leaf('company', tb?.company ?? '');
    xtitleBlock.leaf('rev', tb?.rev ?? '');
    xtitleBlock.leaf('date', tb?.date ?? '');
    xtitleBlock.leaf('source', sheet.file);
    // TITLE_BLOCK::GetComment( 0..8 ), the typed model does not carry the nine
    // comment lines, so they are read from the block's own `(comment N "…")`.
    const comments = tb ? childrenNamed(tb.source, 'comment') : [];
    for (let i = 0; i < 9; i++) {
      const comment = comments.find((c) => arg(c, 0) === String(i + 1));
      xtitleBlock
        .child(new XNODE('comment'))
        .attr('number', String(i + 1))
        .attr('value', comment ? (arg(comment, 1) ?? '') : '');
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

  const unitCount = libById.get(instance.sym.libId)?.units.length ?? 1;

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
  xcomp.leaf('value', value !== '' ? value : '~');
  if (footprint !== '') xcomp.leaf('footprint', footprint);
  if (datasheet !== '') xcomp.leaf('datasheet', datasheet);
  if (description !== '') xcomp.leaf('description', description);

  const xfields = xcomp.child(new XNODE('fields'));
  for (const [name, fieldValue] of fields)
    xfields.child(new XNODE('field', fieldValue)).attr('name', name);
}

/** NETLIST_EXPORTER_XML::makeSymbols, restricted to GNL_OPT_KICAD (board) mode. */
function makeSymbols(input: KicadNetlistInput, usedLibIds: Set<string>): XNODE {
  const xcomps = new XNODE('components');

  for (const sheet of input.sheets) {
    const libById = input.libsFor(sheet);

    for (const instance of orderedSymbols(sheet.doc)) {
      const { sym } = instance;

      // findNextSymbol: power symbols and other symbols whose reference starts with
      // "#" are pseudo/virtual and are never in the netlist.
      if (instance.ref.startsWith('#')) continue;

      // forBoard: a symbol excluded from the board contributes nothing to the PCB.
      if (!sym.onBoard) continue;

      const xcomp = xcomps.child(new XNODE('comp'));
      xcomp.attr('ref', instance.ref);
      addSymbolFields(xcomp, instance, libById);

      const lib = libById.get(sym.libId);
      const { lib: libName, part: partName } = splitLibId(sym.libId);
      usedLibIds.add(sym.libId);

      xcomp
        .child(new XNODE('libsource'))
        .attr('lib', libName)
        .attr('part', partName)
        .attr('description', lib?.properties.find((p) => p.key === 'Description')?.value ?? '');

      // The symbol's own non-mandatory fields, as properties.
      for (const field of sym.fields) {
        if (MANDATORY_FIELDS.has(field.key)) continue;
        xcomp.child(new XNODE('property')).attr('name', field.key).attr('value', field.value);
      }

      // The sheet symbol's fields (Sheetname / Sheetfile / user fields), how the
      // board learns which sheet a footprint belongs to.
      for (const sheetField of parentSheetFields(input, sheet)) {
        xcomp
          .child(new XNODE('property'))
          .attr('name', sheetField.key)
          .attr('value', sheetField.value);
      }

      // Valueless flag properties (a property with no value is the flag itself).
      if (!sym.inBom) xcomp.child(new XNODE('property')).attr('name', 'exclude_from_bom');
      if (!sym.onBoard) xcomp.child(new XNODE('property')).attr('name', 'exclude_from_board');
      if (sym.excludedFromPosFiles)
        xcomp.child(new XNODE('property')).attr('name', 'exclude_from_pos_files');
      if (sym.dnp) xcomp.child(new XNODE('property')).attr('name', 'dnp');

      if (lib) {
        const keywords = lib.properties.find((p) => p.key === 'ki_keywords')?.value ?? '';
        if (keywords !== '')
          xcomp.child(new XNODE('property')).attr('name', 'ki_keywords').attr('value', keywords);

        const filters = lib.properties.find((p) => p.key === 'ki_fp_filters')?.value ?? '';
        if (filters !== '')
          xcomp.child(new XNODE('property')).attr('name', 'ki_fp_filters').attr('value', filters);

        if (lib.duplicatePinNumbersAreJumpers) xcomp.leaf('duplicate_pin_numbers_are_jumpers', '1');

        const jumperGroups = lib.jumperPinGroups ?? [];
        if (jumperGroups.length > 0) {
          const xgroups = xcomp.child(new XNODE('jumper_pin_groups'));
          for (const group of jumperGroups) {
            const xgroup = xgroups.child(new XNODE('group'));
            for (const pinName of group) xgroup.leaf('pin', pinName);
          }
        }
      }

      xcomp.child(new XNODE('sheetpath')).attr('names', sheet.namePath).attr('tstamps', sheet.path);

      // Every UUID that shares this reference: the extra units first, the primary
      // last (BOARD_NETLIST_UPDATER links the footprint to the *first* one, so the
      // ordering matters, upstream emits extras then the primary).
      const xunits = xcomp.child(new XNODE('tstamps'));
      for (const extra of instance.extraUnits) xunits.texts.push(extra.sym.uuid ?? '');
      xunits.texts.push(sym.uuid ?? '');

      // Per-unit name and pin numbers, for gate-swap metadata on the board side.
      const xunitInfo = xcomp.child(new XNODE('units'));
      if (lib) {
        for (const unit of lib.units) {
          if (unit.unit === 0) continue; // the shared "all units" body
          const xunit = xunitInfo.child(new XNODE('unit')).attr('name', unit.name);
          const xpins = xunit.child(new XNODE('pins'));
          for (const pin of unit.pins) xpins.child(new XNODE('pin')).attr('num', pin.number);
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
  // the two mandatory fields: an empty name, and the root schematic's own file.
  if (sheet.path === '/') {
    return [
      { key: 'Sheetname', value: '' },
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
  const xgroups = new XNODE('groups');

  const screenVisits = new Map<string, number>();
  for (const sheet of input.sheets)
    screenVisits.set(sheet.file, (screenVisits.get(sheet.file) ?? 0) + 1);

  for (const sheet of input.sheets) {
    const instancePrefix = sheet.path.endsWith('/') ? sheet.path : `${sheet.path}/`;

    for (const group of sheet.doc.groups) {
      let groupName = group.name;
      if ((screenVisits.get(sheet.file) ?? 0) > 1) groupName = `${groupName} (${sheet.namePath})`;

      const xgroup = xgroups.child(new XNODE('group'));
      xgroup.attr('name', groupName);
      xgroup.attr('uuid', instancePrefix + (group.uuid ?? ''));
      xgroup.attr('lib_id', group.libId ?? '');

      const xmembers = xgroup.child(new XNODE('members'));
      for (const member of group.members)
        xmembers.child(new XNODE('member')).attr('uuid', instancePrefix + member);
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
  const xlibparts = new XNODE('libparts');

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

    const xlibpart = xlibparts.child(new XNODE('libpart'));
    xlibpart.attr('lib', libNickname).attr('part', part);

    const property = (key: string): string =>
      lib.properties.find((p) => p.key === key)?.value ?? '';

    const description = property('Description');
    if (description !== '') xlibpart.leaf('description', description);

    const datasheet = property('Datasheet');
    if (datasheet !== '') xlibpart.leaf('docs', datasheet);

    const filters = property('ki_fp_filters').split(/\s+/).filter(Boolean);
    if (filters.length > 0) {
      const xfootprints = xlibpart.child(new XNODE('footprints'));
      for (const filter of filters) xfootprints.leaf('fp', filter);
    }

    const xfields = xlibpart.child(new XNODE('fields'));
    for (const field of lib.properties)
      xfields.child(new XNODE('field', field.value)).attr('name', field.key);

    // Every pin of the symbol, de-duplicated by number (a multi-unit or DeMorgan
    // symbol repeats VCC/GND pins), sorted by number, and expanded through
    // stacked-pin notation so consumers see the real pad count.
    const pins = lib.units.flatMap((u) => u.pins);
    const byNumber = new Map<string, (typeof pins)[number]>();
    for (const pin of pins) if (!byNumber.has(pin.number)) byNumber.set(pin.number, pin);
    const sorted = [...byNumber.values()].sort((a, b) => strNumCmp(a.number, b.number, true));

    if (sorted.length > 0) {
      const xpins = xlibpart.child(new XNODE('pins'));
      for (const pin of sorted) {
        xpins
          .child(new XNODE('pin'))
          .attr('num', pin.number)
          .attr('name', shownName(pin.name))
          .attr('type', pin.electricalType);
      }
    }
  }

  return xlibparts;
}

/** NETLIST_EXPORTER_XML::makeLibraries. */
function makeLibraries(libraries: ReadonlySet<string>): XNODE {
  const xlibs = new XNODE('libraries');
  for (const name of [...libraries].sort())
    xlibs.child(new XNODE('library').attr('logical', name)).leaf('uri', '');
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
  const xnets = new XNODE('nets');

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
      arr.push({ sheet, sym, lib: libById.get(sym.libId), pin });
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
    for (const node of nodes) {
      const last = deduped[deduped.length - 1];
      if (last && refOf(last.sym) === refOf(node.sym) && last.pin.number === node.pin.number)
        continue;
      deduped.push(node);
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

    for (const node of deduped) {
      const refText = refOf(node.sym);

      // Skip power symbols and virtual symbols.
      if (refText.startsWith('#')) continue;

      const footprintLibId = fieldOf(node.sym, 'Footprint');
      const nums = resolvePadNumbers(
        node.pin.number,
        node.sym,
        node.lib,
        footprintLibId,
        input.footprintPads?.get(footprintLibId),
      );

      // An unmapped pin contributes no pad, so skip it and do not open an empty
      // net for it.
      if (nums.length === 0) continue;

      const baseName = shownName(node.pin.name);
      const pinType = node.pin.electricalType;

      if (!xnet) {
        xnet = xnets.child(new XNODE('net'));
        xnet.attr('code', String(i + 1));
        xnet.attr('name', netName);
        xnet.attr('class', input.netClassFor?.(netName) ?? '');
      }

      for (const num of nums) {
        const xnode = xnet.child(new XNODE('node'));
        xnode.attr('ref', refText).attr('pin', num);

        const fullName = baseName === '' ? num : `${baseName}_${num}`;
        if (baseName !== '' || nums.length > 1) xnode.attr('pinfunction', fullName);

        const typeAttr =
          hasNoConnect && (deduped.length === 1 || allNetPinsStacked)
            ? `${pinType}+no_connect`
            : pinType;
        xnode.attr('pintype', typeAttr);
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
export function makeKicadNetlistNode(input: KicadNetlistInput): SList {
  const xroot = new XNODE('export');
  xroot.attr('version', 'E');

  xroot.child(makeDesignHeader(input));

  const usedLibIds = new Set<string>();
  xroot.child(makeSymbols(input, usedLibIds));
  xroot.child(makeGroups(input));

  const libraries = new Set<string>();
  xroot.child(makeLibParts(input, usedLibIds, libraries));
  // Must follow makeLibParts, which collects the library nicknames.
  xroot.child(makeLibraries(libraries));

  xroot.child(makeListOfNets(input));

  return xroot.toSList();
}

/** NETLIST_EXPORTER_KICAD::Format, the netlist as `.net` text. */
export function netlistKicad(input: KicadNetlistInput): string {
  return serialize(makeKicadNetlistNode(input));
}
