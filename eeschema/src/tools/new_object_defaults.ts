// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Editing Options > "Defaults for New
 * Objects", applied where KiCad applies it: at the moment the item is created,
 * by `SCH_DRAWING_TOOLS`.
 *
 * Nothing here re-reads the preference later. A sheet drawn while the border
 * default was red stays red when the default changes, exactly as upstream —
 * these are defaults for NEW objects, not a theme.
 */

import type { LibSymbol, SchField } from '../types.js';
import { list, atom, str, type SList } from '@ziroeda/sexpr/src/types.js';

/**
 * `POWER_SYMBOLS` (`eeschema_settings.h`), the "Power Symbols:" choice.
 *
 * DEFAULT means "follow the symbol definition" — the two others convert one
 * power kind to the other and never promote an ordinary symbol.
 */
export enum NewPowerSymbols {
  Default = 0,
  Global = 1,
  Local = 2,
}

/** Replace a property's value, keeping the node it was parsed from aligned. */
function withProperty(sym: LibSymbol, key: string, value: string): LibSymbol {
  const at = sym.properties.findIndex((p) => p.key === key);
  if (at < 0) return sym;
  const prop = sym.properties[at]!;
  if (prop.value === value) return sym;
  const items = prop.source.items.slice();
  items[2] = str(value);
  const next: SchField = { ...prop, value, source: { kind: 'list', items } };
  const properties = sym.properties.slice();
  properties[at] = next;
  return { ...sym, properties };
}

/** Rewrite the `(power)` / `(power local)` token on the symbol's own node. */
function withPowerToken(sym: LibSymbol, local: boolean): LibSymbol {
  const node = local ? list(atom('power'), atom('local')) : list(atom('power'));
  const items = sym.source.items.filter(
    (n) => !(n.kind === 'list' && n.items[0]?.kind === 'atom' && n.items[0].value === 'power'),
  );
  // `(power …)` sits with the other symbol-level flags, before the properties;
  // appending would put it after the units, which the reader accepts and the
  // writer would then emit out of KiCad's order.
  const firstProp = items.findIndex(
    (n) => n.kind === 'list' && n.items[0]?.kind === 'atom' && n.items[0].value === 'property',
  );
  const at = firstProp < 0 ? items.length : firstProp;
  const out: SList = { kind: 'list', items: [...items.slice(0, at), node, ...items.slice(at)] };
  return { ...sym, isPower: true, isLocalPower: local, source: out };
}

/**
 * `SCH_DRAWING_TOOLS::PlaceSymbol`'s power conversion
 * (`sch_drawing_tools.cpp:436-471`), applied to the library symbol before the
 * placement is built from it.
 *
 * Upstream is emphatic in a comment about the one thing this must not do:
 *
 *     Only convert between power symbol types. Regular (non-power) symbols must
 *     never be promoted to power symbols just because the default is set to
 *     Global or Local.
 *
 * The keyword and description edits are upstream's too, and only on the
 * global -> local direction: "We do not currently have local power symbols in
 * the KiCad library, so don't update any fields" the other way.
 */
export function applyNewPowerSymbolType(sym: LibSymbol, mode: NewPowerSymbols): LibSymbol {
  if (!sym.isPower) return sym;

  if (mode === NewPowerSymbols.Local && sym.isLocalPower !== true) {
    let out = withPowerToken(sym, true);
    const keywords = out.properties.find((p) => p.key === 'ki_keywords')?.value;
    if (keywords?.includes('global power')) {
      out = withProperty(out, 'ki_keywords', keywords.replaceAll('global power', 'local power'));
    }
    const desc = out.properties.find((p) => p.key === 'ki_description')?.value;
    if (desc?.includes('global label')) {
      out = withProperty(out, 'ki_description', desc.replaceAll('global label', 'local label'));
    }
    return out;
  }

  if (mode === NewPowerSymbols.Global && sym.isLocalPower === true) {
    return withPowerToken(sym, false);
  }

  return sym;
}
