// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/altium/altium_project_variants.cpp`: the assembly variants and
 * project parameters of an Altium `.PrjPcb`, and the stable KIID an Altium
 * component unique id maps to.
 *
 * Upstream reads the `.PrjPcb` through `wxFileConfig( …, aPrjPcbPath,
 * wxCONFIG_USE_NO_ESCAPE_CHARACTERS )`; here the parsers take the file's text
 * (the browser has no path to open), read by the same INI rules: groups are
 * walked in `wxFileConfig`'s order (sorted by name, ignoring case) and keys
 * match ignoring case.
 */

import { nameGeneratorSha1 } from '../../kiid.js';
import type { KIID } from '../../kiid.js';
import { ToLong } from '../../libc/stdlib.js';
import { wxCmpNoCase } from '../../wx/wxstring.js';

/**
 * A single component variation within an Altium project variant.
 *
 * In Altium, each variant can override individual components. Kind=1 means
 * "Not Fitted" (DNP), Kind=0 means "Alternate" with optional field overrides
 * supplied via the AlternatePart string.
 */
export interface ALTIUM_VARIANT_ENTRY {
  designator: string;

  // Component's own unique id (final segment of the Altium path); the value used for matching.
  uniqueId: string;

  kind: number;
  alternateFields: Map<string, string>;
}

/**
 * A project-level assembly variant parsed from an Altium .PrjPcb file.
 *
 * Each [ProjectVariantN] section in the .PrjPcb becomes one of these.
 */
export interface ALTIUM_PROJECT_VARIANT {
  name: string;
  description: string;
  variations: ALTIUM_VARIANT_ENTRY[];
}

/**
 * Derive a stable KIID from an Altium component unique id.
 *
 * Altium unique ids are not hexadecimal, so KIID's string constructor cannot parse them and
 * returns a fresh random uuid each call. This maps equal id strings to equal KIIDs.
 */
export function AltiumUniqueIdToKiid(aUniqueId: string): KIID {
  // Fixed namespace so a given id always maps to the same KIID. Must never change or
  // previously stamped footprint paths would stop matching.
  return nameGeneratorSha1('6f9619ff-8b86-d011-b42d-00cf4fc964ff', aUniqueId);
}

/** `wxString::Trim().Trim( false )`. */
const trimBoth = (s: string): string =>
  s.replace(/^[ \t\n\v\f\r]+/, '').replace(/[ \t\n\v\f\r]+$/, '');

/** `wxString::CmpNoCase( b ) == 0`. */
const eqNoCase = (a: string, b: string): boolean => wxCmpNoCase(a, b) === 0;

function ParseVariationString(aValue: string): ALTIUM_VARIANT_ENTRY {
  const entry: ALTIUM_VARIANT_ENTRY = {
    designator: '',
    uniqueId: '',
    kind: 0,
    alternateFields: new Map(),
  };

  // wxSplit( aValue, '|' ): '\\' escapes a separator
  const tokens = wxSplitEscaped(aValue, '|');

  for (const token of tokens) {
    const eqPos = token.indexOf('=');

    if (eqPos === -1) continue;

    const key = trimBoth(token.substring(0, eqPos));
    const val = trimBoth(token.substring(eqPos + 1));

    if (eqNoCase(key, 'Designator')) {
      entry.designator = val;
    } else if (eqNoCase(key, 'UniqueId')) {
      // The target is a backslash-delimited path; only the final segment is the
      // component's own unique id, which is what symbol and footprint records store.
      const sep = val.lastIndexOf('\\');

      if (sep !== -1) entry.uniqueId = val.substring(sep + 1);
      else entry.uniqueId = val;
    } else if (eqNoCase(key, 'Kind')) {
      entry.kind = ToLong(val).value | 0;
    }
    // AlternatePart sub-fields are handled below.
  }

  // Parse AlternatePart sub-fields. In the raw line, AlternatePart= is followed by
  // pipe-separated key=value pairs that are part of the alternate part definition.
  // Since we already split on '|', find the AlternatePart token and treat everything
  // after it as sub-fields.
  let inAlternatePart = false;

  for (const token of tokens) {
    const eqPos = token.indexOf('=');

    if (eqPos === -1) continue;

    const key = trimBoth(token.substring(0, eqPos));
    const val = trimBoth(token.substring(eqPos + 1));

    if (eqNoCase(key, 'AlternatePart')) {
      inAlternatePart = true;

      // The value after AlternatePart= might itself be the first sub-field value
      // In practice it's typically empty for Kind=1, or a lib reference for Kind=0
      if (val !== '') entry.alternateFields.set('LibReference', val);

      continue;
    }

    if (inAlternatePart && val !== '') entry.alternateFields.set(key, val);
  }

  return entry;
}

/**
 * `wxSplit( aStr, aSep )` with the default escape character `'\\'`: a
 * backslash before the separator keeps it in the token (the backslash is
 * dropped); any other backslash is kept.
 */
function wxSplitEscaped(aStr: string, aSep: string): string[] {
  const out: string[] = [];
  let cur = '';

  if (aStr === '') return out;

  for (let i = 0; i < aStr.length; i++) {
    const ch = aStr[i]!;

    if (ch === '\\' && aStr[i + 1] === aSep) {
      cur += aSep;
      i++;
    } else if (ch === aSep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out;
}

/** One `[group]` of a `wxFileConfig`: its entries, keyed ignoring case. */
interface INI_GROUP {
  name: string;
  entries: Map<string, string>;
}

/**
 * The groups of a `wxFileConfig` read with `wxCONFIG_USE_NO_ESCAPE_CHARACTERS`,
 * in `GetFirstGroup`/`GetNextGroup` order.
 */
function readIniGroups(aText: string): INI_GROUP[] {
  const groups = new Map<string, INI_GROUP>();
  let current: INI_GROUP | null = null;

  for (const rawLine of aText.split(/\r\n|\n|\r/)) {
    const line = trimBoth(rawLine);

    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      const name = line.substring(1, end === -1 ? line.length : end);
      const key = name.toLowerCase();

      current = groups.get(key) ?? { name, entries: new Map() };
      groups.set(key, current);
      continue;
    }

    const eq = line.indexOf('=');

    if (eq === -1 || !current) continue;

    const k = trimBoth(line.substring(0, eq)).toLowerCase();

    // A repeated key: the last one read is the value
    current.entries.set(k, trimBoth(line.substring(eq + 1)));
  }

  return [...groups.values()].sort((a, b) => wxCmpNoCase(a.name, b.name));
}

function read(aGroup: INI_GROUP, aKey: string): string {
  return aGroup.entries.get(aKey.toLowerCase()) ?? '';
}

/**
 * Parse all [ParameterN] sections from an Altium .PrjPcb project file.
 *
 * Altium stores project-wide special strings (PCB_Revision, Company_Name, ...) here as
 * Name/Value pairs. They are what board text such as ".PCB_Revision" resolves against, so
 * they map to KiCad project text variables.
 *
 * @param aPrjPcbText the .PrjPcb file's text.
 * @return Map of upper-cased parameter name to value, matching the case-insensitive variable
 *         references emitted by AltiumPcbSpecialStringsToKiCadStrings.
 */
export function ParseAltiumProjectParameters(aPrjPcbText: string): Map<string, string> {
  const parameters = new Map<string, string>();

  for (const group of readIniGroups(aPrjPcbText)) {
    const groupname = group.name;

    if (!groupname.startsWith('Parameter')) continue;

    // Only numbered [ParameterN] sections hold the project parameters; reject look-alikes
    // such as [ParameterEngine] by requiring a trailing integer.
    if (!ToLong(groupname.substring(9)).ok) continue;

    let name = read(group, 'Name');

    if (name === '') continue;

    const value = read(group, 'Value');

    // KiCad variable references are matched case-insensitively by resolving to upper case,
    // which is what AltiumPcbSpecialStringsToKiCadStrings emits, so key on the upper-cased
    // name to keep ${PCB_REVISION} and friends resolvable.
    name = name.toUpperCase();

    parameters.set(name, value);
  }

  return new Map([...parameters].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Parse all [ProjectVariantN] sections from an Altium .PrjPcb project file.
 *
 * @param aPrjPcbText the .PrjPcb file's text.
 * @return Vector of project variants with their per-component entries.
 */
export function ParseAltiumProjectVariants(aPrjPcbText: string): ALTIUM_PROJECT_VARIANT[] {
  const variants: ALTIUM_PROJECT_VARIANT[] = [];

  for (const group of readIniGroups(aPrjPcbText)) {
    const groupname = group.name;

    if (!groupname.startsWith('ProjectVariant')) continue;

    if (!ToLong(groupname.substring(14)).ok) continue;

    const pv: ALTIUM_PROJECT_VARIANT = { name: '', description: '', variations: [] };

    pv.description = read(group, 'Description');
    pv.name = pv.description;

    if (pv.name === '') pv.name = groupname;

    const variationCount = ToLong(read(group, 'VariationCount'));
    const count = variationCount.ok ? variationCount.value : 0;

    for (let vi = 1; vi <= count; ++vi) {
      const value = read(group, `Variation${vi}`);

      if (value === '') continue;

      const entry = ParseVariationString(value);

      if (entry.designator !== '') pv.variations.push(entry);
    }

    if (pv.variations.length !== 0) variants.push(pv);
  }

  return variants;
}
