// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Cadence Allegro / Telesis netlist. Counterpart:
 * `eeschema/netlist_exporters/netlist_exporter_allegro.cpp`.
 *
 * Unlike every other netlist we export, this one is **not a single file**. It
 * writes the netlist plus a `devices/` directory holding one `<device>.txt` per
 * *device type* — a package definition Allegro reads alongside the netlist. So
 * `netlistAllegro` returns the set of files rather than a string, and the
 * caller decides where they land.
 *
 * The shape of the netlist is three sections between `(NETLIST)` and `$END`:
 *
 *  - `$PACKAGES` — one line per device type, then the references that use it;
 *  - `$A_PROPERTIES` — a `ROOM` property per sheet path, then its references;
 *  - `$NETS` — the net name, then every `REF.PIN` on it.
 *
 * Symbols are collected into *groups* first: same Value, same Footprint and the
 * same reference prefix (`R1` and `R2` group, `R1` and `C1` do not). A group is
 * one device type, and the type's name is `value_footprint` sanitised.
 *
 * Three upstream behaviours are reproduced deliberately, because a diff against
 * an Allegro-written file is the point:
 *
 *  - **two groups can collapse to one `$PACKAGES` entry.** `compPackageMap` is a
 *    `std::map` and the code `insert`s into it, which does *not* overwrite an
 *    existing key — so a second group whose value and footprint sanitise to the
 *    same device type is silently dropped from `$PACKAGES` while its device file
 *    is still written over the first one's. Faithful, and not obviously intended;
 *  - **the device-type name is trimmed before it is sanitised.** `value + "_" +
 *    footprint` has its trailing underscores removed and *then* goes through
 *    `formatDevice`, so a symbol with no footprint gives `value`, not `value_`;
 *  - **a quoted value is unquoted again in `$PACKAGES`.** `formatText` adds the
 *    quotes and the `$PACKAGES` writer strips them straight back off, because
 *    its format string supplies its own.
 *
 * Like our other netlist exporters this works on the open sheet, so there is a
 * single sheet path and `$A_PROPERTIES` has one `ROOM` group.
 */

import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import { GENERATOR_APPLICATION } from '@ziroeda/common/src/generator.js';
import type { LibPin, LibSymbol, Schematic, SchSymbol } from '../types.js';
import { boardSymbols, netPinsByName, symbolField, type NetlistMeta } from './netlist.js';

/** One file the export produces. `path` is relative to the netlist's folder. */
export interface AllegroFile {
  path: string;
  text: string;
}

export interface AllegroNetlist {
  /** The netlist file itself. */
  netlist: string;
  /** `devices/<type>.txt`, one per device type, in device-type order. */
  devices: AllegroFile[];
}

/** The reference with its trailing digits removed: `R12` -> `R`. */
export function removeTailDigits(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1]! >= '0' && s[end - 1]! <= '9') end--;
  return s.slice(0, end);
}

/** The trailing digits as a number; no digits at all reads as 0, as ToULong does. */
export function extractTailNumber(s: string): number {
  const digits = s.slice(removeTailDigits(s).length);
  return digits === '' ? 0 : Number(digits);
}

/**
 * `CompareSymbolRef`: same prefix compares by trailing number, otherwise plain
 * lexicographic — *not* natural order, so `R10` really does sort before `R9`
 * only when the prefixes match.
 */
export function compareSymbolRef(a: string, b: string): number {
  if (removeTailDigits(a) === removeTailDigits(b)) {
    return extractTailNumber(a) - extractTailNumber(b);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const UTF8 = new TextEncoder();

/**
 * Substitute every byte outside `keep` — a class over single ASCII characters —
 * with `sub`.
 *
 * Byte-wise, not character-wise, and that is the point: upstream runs
 * `std::regex_replace` over `std::string( aString )`, the UTF-8 encoding, so a
 * two-byte character becomes **two** replacement characters. Doing this per
 * JavaScript code unit would emit one, and every sanitised name holding
 * non-ASCII would differ from an Allegro-written file by a character.
 */
function substituteBytes(s: string, keep: (b: number) => boolean, sub: string): string {
  let out = '';
  for (const b of UTF8.encode(s)) out += keep(b) ? String.fromCharCode(b) : sub;
  return out;
}

const isAsciiPrintable = (b: number): boolean => b >= 0x20 && b <= 0x7e;
const inRange = (b: number, lo: string, hi: string): boolean =>
  b >= lo.charCodeAt(0) && b <= hi.charCodeAt(0);
const isDigit = (b: number): boolean => inRange(b, '0', '9');
const isLower = (b: number): boolean => inRange(b, 'a', 'z');
const isUpper = (b: number): boolean => inRange(b, 'A', 'Z');
const ch = (c: string): number => c.charCodeAt(0);

/**
 * `formatText`: micro sign to `u`, then anything outside printable ASCII — plus
 * `!` and `'` themselves — to `?`. The result is single-quoted when it holds
 * anything beyond `[a-zA-Z0-9_/]`.
 */
export function allegroFormatText(s: string): string {
  if (!s) return '';
  // Both the micro sign and the Greek mu, as upstream replaces each in turn.
  const folded = s.replace(/µ/g, 'u').replace(/μ/g, 'u');
  const ascii = substituteBytes(
    folded,
    (b) => isAsciiPrintable(b) && b !== ch('!') && b !== ch("'"),
    '?',
  );
  return /[^a-zA-Z0-9_/]/.test(ascii) ? `'${ascii}'` : ascii;
}

/** `formatDevice`: lower-cased, and anything outside `[a-z0-9_-]` becomes `_`. */
export const allegroFormatDevice = (s: string): string =>
  substituteBytes(
    s.toLowerCase(),
    (b) => isLower(b) || isDigit(b) || b === ch('_') || b === ch('-'),
    '_',
  );

/** `formatPin`: the Telesis pin name, `<name>__<number>`, sanitised. */
export const allegroFormatPin = (pin: LibPin): string =>
  substituteBytes(
    `${pin.name}__${pin.number}`,
    (b) =>
      isUpper(b) ||
      isLower(b) ||
      isDigit(b) ||
      b === ch('_') ||
      b === ch('+') ||
      b === ch('?') ||
      b === ch('/') ||
      b === ch('-'),
    '?',
  );

/** The library symbol's pins, deduped by number as upstream's pass does. */
function packagePins(lib: LibSymbol | undefined): LibPin[] {
  if (!lib) return [];
  const pins = lib.units.flatMap((u) => u.pins).sort((a, b) => strNumCmp(a.number, b.number, true));
  // "We must erase redundant Pins references": multi-unit parts and DeMorgan
  // conversions list the same pin more than once.
  return pins.filter((p, i) => i === 0 || p.number !== pins[i - 1]!.number);
}

/** `formatFunction( "main", pins )` — the PINORDER and FUNCTION pair. */
function formatFunction(name: string, pins: readonly LibPin[]): string {
  const upper = name.toUpperCase();
  const order = pins.map((p) => `,\n\t${allegroFormatPin(p)}`).join('');
  const numbers = pins.map((p) => `,\n\t${p.number}`).join('');
  return `PINORDER ${upper} ${order}\nFUNCTION ${upper} ${upper} ${numbers}\n`;
}

interface Group {
  refs: string[];
  symbols: SchSymbol[];
  deviceType: string;
  value: string;
  tolerance: string;
  /** The group's first symbol, which supplies the footprint and the pin list. */
  head: SchSymbol;
}

/**
 * `getGroupField`: the first non-empty value among `names` across the group's
 * placed symbols, then the same search across the library symbol's fields.
 * Field names match case-insensitively.
 */
function groupField(
  group: { symbols: readonly SchSymbol[] },
  libById: Map<string, LibSymbol>,
  names: readonly string[],
  sanitize = true,
): string {
  const pick = (v: string): string => (sanitize ? allegroFormatText(v) : v);
  for (const sym of group.symbols) {
    for (const name of names) {
      const f = sym.fields.find((x) => x.key.toLowerCase() === name.toLowerCase());
      if (f?.value) return pick(f.value);
    }
  }
  for (const sym of group.symbols) {
    const lib = libById.get(sym.libId);
    for (const name of names) {
      const f = lib?.properties.find((x) => x.key.toLowerCase() === name.toLowerCase());
      if (f?.value) return pick(f.value);
    }
  }
  return '';
}

/**
 * Collect the board symbols into device groups: taken from the front, a symbol
 * joins the current group when its Value, its Footprint and its reference
 * *prefix* all match the group's first member.
 */
function componentGroups(sch: Schematic, libById: Map<string, LibSymbol>): Group[] {
  const pending = boardSymbols(sch).filter(({ sym }) => packagePins(libById.get(sym.libId)).length);
  const groups: Group[] = [];

  while (pending.length) {
    const first = pending.shift()!;
    const members = [first];
    const valueText = (s: SchSymbol): string => symbolField(s, 'Value');
    const fpOf = (s: SchSymbol): string => symbolField(s, 'Footprint');
    for (let i = 0; i < pending.length; ) {
      const cand = pending[i]!;
      if (
        valueText(cand.sym) === valueText(first.sym) &&
        fpOf(cand.sym) === fpOf(first.sym) &&
        removeTailDigits(cand.ref) === removeTailDigits(first.ref)
      ) {
        members.push(cand);
        pending.splice(i, 1);
      } else {
        i++;
      }
    }

    // The device type is trimmed of trailing underscores *before* sanitising,
    // so an empty footprint gives "value" rather than "value_".
    let deviceType = `${valueText(first.sym)}_${fpOf(first.sym)}`;
    while (deviceType.endsWith('_')) deviceType = deviceType.slice(0, -1);

    const symbols = members.map((m) => m.sym);
    groups.push({
      refs: members.map((m) => m.ref).sort(compareSymbolRef),
      symbols,
      deviceType: allegroFormatDevice(deviceType),
      value: groupField({ symbols }, libById, ['Spice_Model', 'VALUE']),
      tolerance: groupField({ symbols }, libById, ['TOLERANCE', 'TOL']),
      head: first.sym,
    });
  }
  return groups;
}

/** One `devices/<type>.txt`. */
function deviceFile(group: Group, libById: Map<string, LibSymbol>): AllegroFile {
  const lib = libById.get(group.head.libId);
  // The footprint's bare name; "Lib:Foot" keeps only "Foot".
  let footprint = symbolField(group.head, 'Footprint').split(':').pop() ?? '';
  // Wildcard filters are not footprint names, so they are not candidates.
  const alt = (lib?.properties.find((p) => p.key === 'ki_fp_filters')?.value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((f) => !f.includes('*') && !f.includes('?'))
    .map((f) => f.split(':').pop() ?? '');
  if (!footprint) {
    footprint = alt.length ? alt.shift()! : group.deviceType;
  }

  const pins = packagePins(lib);
  const out: string[] = [];
  out.push(`PACKAGE '${allegroFormatDevice(footprint)}'`);
  out.push('CLASS IC');
  out.push(`PINCOUNT ${pins.length}`);
  let text = `${out.join('\n')}\n`;
  if (pins.length) text += formatFunction('main', pins);
  if (group.value) text += `PACKAGEPROP VALUE ${group.value}\n`;
  if (group.tolerance) text += `PACKAGEPROP TOL ${group.tolerance}\n`;
  if (alt.length) text += `PACKAGEPROP ALT_SYMBOLS '(${alt.join(',')})'\n`;

  const partNumber = groupField(group, libById, ['PART_NUMBER', 'mpn', 'mfr_pn']);
  if (partNumber) text += `PACKAGEPROP PART_NUMBER ${partNumber}\n`;
  const height = groupField(group, libById, ['HEIGHT']);
  if (height) text += `PACKAGEPROP HEIGHT ${height}\n`;

  text += 'END\n';
  return { path: `devices/${group.deviceType}.txt`, text };
}

/** The sheet path every symbol on the open sheet belongs to. */
const ROOT_SHEET_PATH = '/';

export function netlistAllegro(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  meta: NetlistMeta,
): AllegroNetlist {
  const groups = componentGroups(sch, libById);

  // std::map<wxString, COMP_PACKAGE_STRUCT>::insert keeps the *first* entry for
  // a key. Two groups that sanitise to one device type therefore yield one
  // $PACKAGES line — while both still write their device file.
  const byDevice = new Map<string, Group>();
  for (const g of groups) if (!byDevice.has(g.deviceType)) byDevice.set(g.deviceType, g);

  const out: string[] = [];
  out.push('(NETLIST)');
  out.push(`(Source: ${meta.source})`);
  out.push(`(Date: ${meta.date ?? new Date().toISOString()})`);
  out.push('$PACKAGES');

  for (const deviceType of [...byDevice.keys()].sort()) {
    const g = byDevice.get(deviceType)!;
    // formatText already quoted the value; the format string quotes it again,
    // so the writer takes the inner pair off.
    const value = g.value.startsWith("'") && g.value.endsWith("'") ? g.value.slice(1, -1) : g.value;
    const head =
      !value && !g.tolerance
        ? `! '${deviceType}' ; `
        : !g.tolerance
          ? `! '${deviceType}' ! '${value}' ; `
          : `! '${deviceType}' ! '${value}' ! ${g.tolerance} ; `;
    out.push(head + g.refs.join(',\n\t'));
  }

  out.push('$A_PROPERTIES');
  const rooms = groups.flatMap((g) => g.refs).sort(compareSymbolRef);
  if (rooms.length) {
    out.push(`'ROOM' '${ROOT_SHEET_PATH}' ; ${rooms.join(',\n\t')}`);
  }

  out.push('$NETS');
  for (const { name, pins } of netPinsByName(sch, libById)) {
    // NET_NODE::operator<: by reference, then by pin *number* when both parse,
    // otherwise by the pin string.
    const nodes = [...pins].sort((a, b) => {
      if (a.ref === b.ref) {
        const na = Number(a.pin);
        const nb = Number(b.pin);
        if (Number.isInteger(na) && Number.isInteger(nb) && a.pin !== '' && b.pin !== '') {
          return na - nb;
        }
        return a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0;
      }
      return compareSymbolRef(a.ref, b.ref);
    });
    if (!nodes.length) continue;
    const netName = allegroFormatText(name).toUpperCase();
    out.push(`${netName}; ${nodes.map((n) => `${n.ref}.${n.pin}`).join(',\n\t')}`);
  }

  out.push('$END');

  return {
    netlist: `${out.join('\n')}\n`,
    devices: groups.map((g) => deviceFile(g, libById)),
  };
}

/** The header line other exporters stamp; kept so the module owns its constant. */
export const ALLEGRO_GENERATOR = GENERATOR_APPLICATION;
