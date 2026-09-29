// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/netlist_exporters/netlist_exporter_allegro.cpp` (`NETLIST_EXPORTER_ALLEGRO`):
 * the Cadence Allegro / Telesis netlist. Unlike every other format this is **not a single
 * file**: the netlist plus a `devices/` directory holding one `<device>.txt` package
 * definition per device type, so {@link NETLIST_EXPORTER_ALLEGRO.WriteFiles} returns the
 * set and the caller decides where they land.
 *
 * The netlist is three sections between `(NETLIST)` and `$END`: `$PACKAGES` (one line per
 * device type, then its references), `$A_PROPERTIES` (a `ROOM` per sheet path, then its
 * references) and `$NETS` (each net upper-cased, then its `REF.PIN`s). Symbols are grouped
 * first - same Value, same Footprint, same reference prefix - and a group is one device
 * type, named `value_footprint` sanitised.
 *
 * Upstream quirks kept, because a diff against a KiCad-written file is the point:
 *  - two groups can collapse to one `$PACKAGES` entry (`std::map::insert` keeps the
 *    first), while the later group's device file overwrites the earlier one's;
 *  - the device type is trimmed of trailing underscores before it is sanitised;
 *  - a quoted value is unquoted again in `$PACKAGES`;
 *  - the sanitising regexes run over UTF-8 bytes, so a non-ASCII character becomes one
 *    replacement per byte.
 *
 * Ported from 10.0.6, the installed kicad-cli, where it differs from 10.0.5: the `ROOM`
 * names (`formatRoom`) and the grouping loop's iterator fix.
 *
 * Held to `kicad-cli sch export netlist --format allegro` (devices included) by
 * `designer/netlist_formats_oracle.test.ts`.
 */

import { GetISO8601CurrentDateTime, strNumCmp } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { NETLIST_EXPORTER_BASE } from './netlist_exporter_base.js';

/** `wxString` `operator<`: code-point order. */
function wxStringLess(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const symbolsOn = (aSheet: SCH_SHEET_PATH): SCH_SYMBOL[] =>
  (aSheet.LastScreen()?.Items().OfType(KICAD_T.SCH_SYMBOL_T) ?? []) as unknown as SCH_SYMBOL[];

/** `std::regex_replace` over the UTF-8 bytes of `aText`, as upstream runs it on a std::string. */
function replaceBytes(aText: string, aKeep: (aByte: number) => boolean, aWith: string): string {
  let out = '';

  for (const byte of new TextEncoder().encode(aText))
    out += aKeep(byte) ? String.fromCharCode(byte) : aWith;

  return out;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** `removeTailDigits`. */
export function removeTailDigits(aString: string): string {
  let s = aString;

  while (isDigit(s[s.length - 1])) s = s.slice(0, -1);

  return s;
}

/** `extractTailNumber`: the trailing digits as a number (0 when there are none). */
export function extractTailNumber(aString: string): number {
  let numString = '';
  let s = aString;

  while (isDigit(s[s.length - 1])) {
    numString = s[s.length - 1]! + numString;
    s = s.slice(0, -1);
  }

  return numString === '' ? 0 : Number(numString) >>> 0;
}

/** `wxString::ToULong`: the whole string a base-10 unsigned number, or undefined. */
function toULong(aString: string): number | undefined {
  return /^\s*\+?\d+$/.test(aString) ? Number(aString) : undefined;
}

/** `CompareSymbolRef`. */
export function CompareSymbolRef(aRefText1: string, aRefText2: string): boolean {
  if (removeTailDigits(aRefText1) === removeTailDigits(aRefText2))
    return extractTailNumber(aRefText1) < extractTailNumber(aRefText2);

  return aRefText1 < aRefText2;
}

/** `CompareLibPin`. */
function CompareLibPin(aPin1: SCH_PIN, aPin2: SCH_PIN): boolean {
  // return "lhs < rhs"
  return strNumCmp(aPin1.GetShownNumber(), aPin2.GetShownNumber(), true) < 0;
}

/** `std::stable_sort` with a "less". */
function stableSortLess<T>(a: T[], less: (x: T, y: T) => boolean): void {
  a.sort((x, y) => (less(x, y) ? -1 : less(y, x) ? 1 : 0));
}

interface ALLEGRO_NET_NODE {
  m_Pin: SCH_PIN;
  m_Sheet: SCH_SHEET_PATH;
  m_NoConnect: boolean;
}

interface SYMBOL_SHEETPATH {
  symbol: SCH_SYMBOL;
  sheet: SCH_SHEET_PATH;
}

/** One file an export writes, named relative to the netlist's folder. */
export interface NETLIST_OUTPUT_FILE {
  path: string;
  text: string;
}

/** `NETLIST_EXPORTER_ALLEGRO`: the Telesis netlist plus a `devices/` file per package. */
export class NETLIST_EXPORTER_ALLEGRO extends NETLIST_EXPORTER_BASE {
  /** `GetISO8601CurrentDateTime()`, settable so a test can pin it. */
  m_date: () => string = GetISO8601CurrentDateTime;

  private m_out = '';
  private m_devices = new Map<string, string>();
  /** `std::multimap<wxString, wxString>`: sheet path -> reference. */
  private m_packageProperties: [string, string][] = [];
  /** `std::multimap<int, …>`: group index -> symbol, in insertion order within a group. */
  private m_componentGroups = new Map<number, SYMBOL_SHEETPATH[]>();
  private m_orderedSymbolsSheetpath: SYMBOL_SHEETPATH[] = [];
  /** `std::multimap<wxString, NET_NODE>`: net name -> node. */
  private m_netNameNodes: [string, ALLEGRO_NET_NODE][] = [];

  /**
   * `WriteNetlist`: the netlist (`aFileName`) first, then each `devices/<type>.txt`,
   * in the order upstream last wrote them.
   */
  WriteFiles(aFileName: string): NETLIST_OUTPUT_FILE[] {
    this.m_out = '(NETLIST)\n';
    this.m_out += `(Source: ${this.m_schematic.GetFileName()})\n`;
    this.m_out += `(Date: ${this.m_date()})\n`;

    this.m_packageProperties = [];
    this.m_componentGroups.clear();
    this.m_orderedSymbolsSheetpath = [];
    this.m_netNameNodes = [];
    this.m_devices.clear();

    this.extractComponentsInfo();

    // Start with package definitions, which we create from component groups.
    this.toAllegroPackages();

    // Write out package properties. NOTE: Allegro doesn't recognize much...
    this.toAllegroPackageProperties();

    // Write out nets
    this.toAllegroNets();

    this.m_out += '$END\n';

    return [
      { path: aFileName, text: this.m_out },
      ...[...this.m_devices].map(([name, text]) => ({ path: `devices/${name}.txt`, text })),
    ];
  }

  /** `CompareSymbolSheetpath`. */
  private static CompareSymbolSheetpath(
    aItem1: SYMBOL_SHEETPATH,
    aItem2: SYMBOL_SHEETPATH,
  ): boolean {
    const refText1 = aItem1.symbol.GetRef(aItem1.sheet);
    const refText2 = aItem2.symbol.GetRef(aItem2.sheet);

    if (refText1 === refText2)
      return aItem1.sheet.PathHumanReadable() < aItem2.sheet.PathHumanReadable();

    return CompareSymbolRef(refText1, refText2);
  }

  /** `NET_NODE::operator<`. */
  private static netNodeLess(a: ALLEGRO_NET_NODE, b: ALLEGRO_NET_NODE): boolean {
    const refText1 = a.m_Pin.GetParentSymbol()!.GetRef(a.m_Sheet);
    const refText2 = b.m_Pin.GetParentSymbol()!.GetRef(b.m_Sheet);

    if (refText1 === refText2) {
      const val1 = toULong(a.m_Pin.GetShownNumber());
      const val2 = toULong(b.m_Pin.GetShownNumber());

      if (val1 !== undefined && val2 !== undefined) return val1 < val2;

      return a.m_Pin.GetShownNumber() < b.m_Pin.GetShownNumber();
    }

    return CompareSymbolRef(refText1, refText2);
  }

  /** `extractComponentsInfo`. */
  private extractComponentsInfo(): void {
    this.m_referencesAlreadyFound.Clear();
    this.m_libParts.clear();

    for (const sheet of this.m_schematic.Hierarchy()) {
      this.m_schematic.SetCurrentSheet(sheet);

      // std::set keyed by StrNumCmp on the reference: one symbol per reference, the
      // lowest UUID (the extra units are not written here).
      const keyOf = (s: SCH_SYMBOL): string => s.GetRef(sheet, false);
      const ordered_symbols: SCH_SYMBOL[] = [];

      for (const symbol of symbolsOn(sheet)) {
        const existing = ordered_symbols.findIndex(
          (s) => strNumCmp(keyOf(s), keyOf(symbol), true) === 0,
        );

        if (existing < 0) ordered_symbols.push(symbol);
        else if (ordered_symbols[existing]!.m_Uuid > symbol.m_Uuid)
          ordered_symbols[existing] = symbol;
      }

      stdSort(ordered_symbols, (a, b) => strNumCmp(keyOf(a), keyOf(b), true) < 0);

      for (const item of ordered_symbols) {
        const symbol = this.findNextSymbol(item, sheet);

        if (!symbol || symbol.GetExcludedFromBoard()) continue;

        if (symbol.GetLibPins().length === 0) continue;

        this.m_packageProperties.push([formatRoom(sheet), symbol.GetRef(sheet)]);
        this.m_orderedSymbolsSheetpath.push({ symbol, sheet });
      }
    }

    interface NET_RECORD {
      m_Name: string;
      m_Nodes: ALLEGRO_NET_NODE[];
    }

    const nets: NET_RECORD[] = [];

    for (const [key, subgraphs] of this.m_schematic.ConnectionGraph().GetNetMap()) {
      if (subgraphs.length === 0) continue;

      const net_record: NET_RECORD = { m_Name: key.Name, m_Nodes: [] };
      nets.push(net_record);

      for (const subgraph of subgraphs) {
        const noConnect = subgraph.GetNoConnect();
        const nc = noConnect !== null && noConnect.Type() === KICAD_T.SCH_NO_CONNECT_T;
        const sheet = subgraph.GetSheet();

        for (const item of subgraph.GetItems()) {
          if (item.Type() === KICAD_T.SCH_PIN_T) {
            const pin = item as SCH_PIN;
            const symbol = pin.GetParentSymbol();

            if (!symbol || symbol.GetExcludedFromBoard()) continue;

            net_record.m_Nodes.push({ m_Pin: pin, m_Sheet: sheet, m_NoConnect: nc });
          }
        }
      }
    }

    // Netlist ordering: Net name, then ref des, then pin name
    stdSort(nets, (a, b) => strNumCmp(a.m_Name, b.m_Name) < 0);

    const refOf = (n: ALLEGRO_NET_NODE): string => n.m_Pin.GetParentSymbol()!.GetRef(n.m_Sheet);

    for (const net_record of nets) {
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

      for (const netNode of net_record.m_Nodes) {
        // Skip power symbols and virtual symbols
        if (refOf(netNode)[0] === '#') continue;

        this.m_netNameNodes.push([net_record.m_Name, netNode]);
      }
    }
  }

  /** `toAllegroPackages`. */
  private toAllegroPackages(): void {
    let groupCount = 1;

    //Group the components......
    while (this.m_orderedSymbolsSheetpath.length > 0) {
      const first_ele = this.m_orderedSymbolsSheetpath.shift()!;
      const group: SYMBOL_SHEETPATH[] = [first_ele];
      this.m_componentGroups.set(groupCount, group);

      const value = first_ele.symbol.GetValue(false, first_ele.sheet, false);
      const footprint = first_ele.symbol.GetFootprintFieldText(false, first_ele.sheet, false);
      const ref2 = first_ele.symbol.GetRef(first_ele.sheet);

      this.m_orderedSymbolsSheetpath = this.m_orderedSymbolsSheetpath.filter((it) => {
        if (it.symbol.GetValue(false, it.sheet, false) !== value) return true;

        if (it.symbol.GetFootprintFieldText(false, it.sheet, false) !== footprint) return true;

        if (removeTailDigits(it.symbol.GetRef(it.sheet)) === removeTailDigits(ref2)) {
          group.push(it);
          return false;
        }

        return true;
      });

      groupCount++;
    }

    interface COMP_PACKAGE_STRUCT {
      m_value: string;
      m_tolerance: string;
      m_symbolSheetpaths: SYMBOL_SHEETPATH[];
    }

    // std::map<wxString, …>: ordered by key, and insert() keeps the first entry for a key.
    const compPackageMap = new Map<string, COMP_PACKAGE_STRUCT>();

    for (let groupIndex = 1; groupIndex < groupCount; groupIndex++) {
      const members = this.m_componentGroups.get(groupIndex)!;
      const { symbol: sym, sheet: sheetPath } = members[0]!;

      const valueText = sym.GetValue(false, sheetPath, false);
      let footprintText = sym.GetFootprintFieldText(false, sheetPath, false);
      let deviceType = `${valueText}_${footprintText}`;

      while (deviceType[deviceType.length - 1] === '_') deviceType = deviceType.slice(0, -1);

      deviceType = formatDevice(deviceType);

      const value = this.getGroupField(groupIndex, ['Spice_Model', 'VALUE']);
      const tol = this.getGroupField(groupIndex, ['TOLERANCE', 'TOL']);

      const symbolSheetpaths = [...members];

      stableSortLess(symbolSheetpaths, NETLIST_EXPORTER_ALLEGRO.CompareSymbolSheetpath);

      if (!compPackageMap.has(deviceType))
        compPackageMap.set(deviceType, {
          m_value: value,
          m_tolerance: tol,
          m_symbolSheetpaths: symbolSheetpaths,
        });

      // Write out the corresponding device file
      footprintText = footprintText.slice(footprintText.lastIndexOf(':') + 1);

      const footprintAlt: string[] = [];

      for (const fp of sym.GetLibSymbolRef()!.GetFPFilters()) {
        if (fp.includes('*') || fp.includes('?')) continue;

        footprintAlt.push(fp.slice(fp.lastIndexOf(':') + 1));
      }

      if (footprintText === '') {
        if (footprintAlt.length > 0) footprintText = footprintAlt.shift()!;
        else footprintText = deviceType;
      }

      let d = `PACKAGE '${formatDevice(footprintText)}'\n`;
      d += 'CLASS IC\n';

      const pinList = sym.GetLibSymbolRef()!.GetPins();

      // We must erase redundant Pins references in pinList (multiple units, DeMorgan).
      stdSort(pinList, CompareLibPin);

      for (let ii = 0; ii < pinList.length - 1; ii++) {
        if (pinList[ii]!.GetNumber() === pinList[ii + 1]!.GetNumber()) {
          // 2 pins have the same number, remove the redundant pin at index i+1
          pinList.splice(ii + 1, 1);
          ii--;
        }
      }

      const pinCount = pinList.length;
      d += `PINCOUNT ${pinCount}\n`;

      if (pinCount > 0) d += formatFunction('main', pinList);

      if (value !== '') d += `PACKAGEPROP VALUE ${value}\n`;

      if (tol !== '') d += `PACKAGEPROP TOL ${tol}\n`;

      if (footprintAlt.length > 0) d += `PACKAGEPROP ALT_SYMBOLS '(${footprintAlt.join(',')})'\n`;

      const partNumber = this.getGroupField(groupIndex, ['PART_NUMBER', 'mpn', 'mfr_pn']);

      if (partNumber !== '') d += `PACKAGEPROP PART_NUMBER ${partNumber}\n`;

      const height = this.getGroupField(groupIndex, ['HEIGHT']);

      if (height !== '') d += `PACKAGEPROP HEIGHT ${height}\n`;

      d += 'END\n';

      // A later group of the same device type writes the same file again.
      this.m_devices.delete(deviceType);
      this.m_devices.set(deviceType, d);
    }

    this.m_out += '$PACKAGES\n';

    for (const deviceType of [...compPackageMap.keys()].sort(wxStringLess)) {
      const pkg = compPackageMap.get(deviceType)!;
      let value = pkg.m_value;
      const tolerance = pkg.m_tolerance;

      // Remove quotes in value (can be added by formatText), if any.
      // (they are already in print format string)
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

      if (value === '' && tolerance === '') this.m_out += `! '${deviceType}' ; `;
      else if (tolerance === '') this.m_out += `! '${deviceType}' ! '${value}' ; `;
      else this.m_out += `! '${deviceType}' ! '${value}' ! ${tolerance} ; `;

      this.m_out += pkg.m_symbolSheetpaths.map((s) => s.symbol.GetRef(s.sheet)).join(',\n\t');
      this.m_out += '\n';
    }
  }

  /** `getGroupField`: the first non-empty field of the group, placed symbols first. */
  private getGroupField(
    aGroupIndex: number,
    aFieldArray: readonly string[],
    aSanitize = true,
  ): string {
    const members = this.m_componentGroups.get(aGroupIndex) ?? [];

    for (const { symbol: sym, sheet: sheetPath } of members) {
      for (const field of aFieldArray) {
        const fld = sym.FindFieldCaseInsensitive(field);

        if (fld) {
          const fieldText = fld.GetShownText(sheetPath, true);

          if (fieldText !== '') return aSanitize ? formatText(fieldText) : fieldText;
        }
      }
    }

    for (const { symbol: sym } of members) {
      for (const field of aFieldArray) {
        const fld = sym.GetLibSymbolRef()!.FindFieldCaseInsensitive(field);

        if (fld) {
          const fieldText = fld.GetShownText(false, 0);

          if (fieldText !== '') return aSanitize ? formatText(fieldText) : fieldText;
        }
      }
    }

    return '';
  }

  /** `toAllegroPackageProperties` (10.0.6: keyed by {@link formatRoom}). */
  private toAllegroPackageProperties(): void {
    this.m_out += '$A_PROPERTIES\n';

    // std::multimap: by key, then insertion order.
    const keys = [...new Set(this.m_packageProperties.map(([k]) => k))].sort(wxStringLess);

    for (const roomName of keys) {
      const refTexts = this.m_packageProperties.filter(([k]) => k === roomName).map(([, r]) => r);

      // Nothing to name the room after (a schematic with no file name yet); leave these
      // symbols without a ROOM rather than writing out an empty property.
      if (roomName === '') continue;

      // formatRoom() already restricted this to characters that need no quoting or escaping.
      this.m_out += `'ROOM' '${roomName}' ; `;

      stableSortLess(refTexts, CompareSymbolRef);

      this.m_out += refTexts.join(',\n\t');
      this.m_out += '\n';
    }
  }

  /** `toAllegroNets`. */
  private toAllegroNets(): void {
    this.m_out += '$NETS\n';

    const keys = [...new Set(this.m_netNameNodes.map(([k]) => k))].sort(wxStringLess);

    for (const netName of keys) {
      this.m_out += `${formatText(netName).toUpperCase()}; `;

      const netNodes = this.m_netNameNodes.filter(([k]) => k === netName).map(([, n]) => n);

      stableSortLess(netNodes, NETLIST_EXPORTER_ALLEGRO.netNodeLess);

      this.m_out += netNodes
        .map((n) => `${n.m_Pin.GetParentSymbol()!.GetRef(n.m_Sheet)}.${n.m_Pin.GetShownNumber()}`)
        .join(',\n\t');
      this.m_out += '\n';
    }
  }
}

/**
 * `formatRoom` (10.0.6): a sheet's `ROOM` name - its human-readable path (the root file's
 * name for the root), outer separators dropped, inner ones dashes, anything outside
 * `[A-Za-z0-9_-]` an underscore.
 */
export function formatRoom(aSheetPath: SCH_SHEET_PATH): string {
  let path = aSheetPath.PathHumanReadable();

  // Use root schematic file name for root
  if (path === '/') path = aSheetPath.PathHumanReadable(false);

  // The leading and trailing separators carry no information; the ones in between become
  // dashes below.
  while (path.startsWith('/')) path = path.slice(1);

  while (path.endsWith('/')) path = path.slice(0, -1);

  let roomName = '';

  for (const c of path) {
    if (/^[a-zA-Z0-9_-]$/.test(c)) roomName += c;
    // Use dash to represent our hierarchy breaks
    else if (c === '/') roomName += '-';
    else roomName += '_';
  }

  return roomName;
}

/** `formatText`: ASCII-7, quoted when anything beyond `[a-zA-Z0-9_/]` is left. */
export function formatText(aString: string): string {
  if (aString === '') return '';

  // Replace 'µ' ("µ") by 'u' to keep ASCII7 constraint, and the Greek mu too.
  const s = aString.replaceAll('µ', 'u').replaceAll('μ', 'u');

  // std::regex "[!']|[^ -~]" over the UTF-8 bytes: each byte of a non-ASCII character
  // becomes its own "?".
  const processedString = replaceBytes(
    s,
    (b) => b >= 0x20 && b <= 0x7e && b !== 0x21 && b !== 0x27,
    '?',
  );

  if (/[^a-zA-Z0-9_/]/.test(processedString)) return `'${processedString}'`;

  return processedString;
}

/** `formatPin`: `<name>__<number>`, anything outside `[A-Za-z0-9_+?/-]` a "?". */
export function formatPin(aPin: SCH_PIN): string {
  const pinName4Telesis = `${aPin.GetName()}__${aPin.GetNumber()}`;
  return replaceBytes(pinName4Telesis, (b) => /[A-Za-z0-9_+?/-]/.test(String.fromCharCode(b)), '?');
}

/** `formatFunction`. */
function formatFunction(aName: string, aPinList: SCH_PIN[]): string {
  const name = aName.toUpperCase();
  const pins = [...aPinList];

  stableSortLess(pins, CompareLibPin);

  let out_str = `PINORDER ${name} `;

  for (const pin of pins) out_str += `,\n\t${formatPin(pin)}`;

  out_str += '\n';
  out_str += `FUNCTION ${name} ${name} `;

  // (upstream walks aPinList, which the stable_sort above sorted in place)
  for (const pin of pins) out_str += `,\n\t${pin.GetNumber()}`;

  out_str += '\n';

  return out_str;
}

/** `formatDevice`: lower case, anything outside `[a-z0-9_-]` an underscore (per byte). */
export function formatDevice(aString: string): string {
  return replaceBytes(aString.toLowerCase(), (b) => /[a-z0-9_-]/.test(String.fromCharCode(b)), '_');
}
