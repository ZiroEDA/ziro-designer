// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A placed pin's *effective* function. Counterparts: `SCH_PIN::GetName`,
 * `GetType` and `GetShape` (eeschema/sch_pin.cpp), which each check `m_alt`
 * first and fall back to the library pin.
 *
 * A library pin may declare `(alternate "NAME" <type> <shape>)` children — the
 * same physical pin serving a different function, e.g. a microcontroller pad
 * that is GPIO or SPI clock. A placement picks one by name, and from then on
 * the *alternate's* name, electrical type and graphic shape are what the pin
 * shows, what the netlist reports and what ERC checks.
 *
 * Two upstream rules are what make this more than a lookup, and both exist to
 * survive files other tools wrote:
 *
 *  - an alternate naming a function the library no longer declares is **not**
 *    an error; the pin simply falls back to its base function, and
 *    `DIALOG_CHANGE_SYMBOLS` clears the stale name whether or not the reset
 *    option is checked;
 *  - an alternate equal to the pin's own base name is treated as no alternate
 *    at all. It is a bug in older KiCad that this could be stored, and both
 *    the writer and the change-symbols pass work around it rather than
 *    tolerating the value.
 */

import type { LibPin, LibPinAlt, SchSymbol, SchSymbolPin } from '../types.js';

/** The resolved function of a placed pin: what it is called and how it behaves. */
export interface ResolvedPin {
  readonly name: string;
  readonly electricalType: string;
  readonly shape: string;
  /** The alternate in force, absent when the pin serves its base function. */
  readonly alternate?: string;
}

/** The placement's entry for a pin number, if the file listed one. */
export const symbolPin = (sym: SchSymbol, number: string): SchSymbolPin | undefined =>
  sym.pins?.find((p) => p.number === number);

/** The named alternate a library pin declares, if it declares it. */
export const pinAlternate = (pin: LibPin, name: string | undefined): LibPinAlt | undefined =>
  name ? pin.alternates?.find((a) => a.name === name) : undefined;

/**
 * Whether an alternate name is one the pin can actually serve. A name equal to
 * the pin's own is rejected, matching the write-side workaround: the two mean
 * the same thing, and storing it breaks library comparison upstream.
 */
export const isUsableAlternate = (pin: LibPin, name: string | undefined): boolean =>
  !!name && name !== pin.name && !!pinAlternate(pin, name);

/**
 * A pin's effective name, type and shape under the placement's selection.
 * An unusable alternate resolves to the base function rather than throwing it
 * away, so a stale file still renders and still nets up.
 */
export function resolvePin(sym: SchSymbol, pin: LibPin): ResolvedPin {
  const chosen = symbolPin(sym, pin.number)?.alternate;
  const alt = isUsableAlternate(pin, chosen) ? pinAlternate(pin, chosen) : undefined;
  return alt
    ? { name: alt.name, electricalType: alt.electricalType, shape: alt.shape, alternate: alt.name }
    : { name: pin.name, electricalType: pin.electricalType, shape: pin.shape };
}

/**
 * `DIALOG_CHANGE_SYMBOLS`'s "Clear alternate pins as required" pass.
 *
 * `resetAll` is the "Reset alternate pin functions" checkbox. Even with it
 * off, an alternate is cleared when it equals the base pin name or names a
 * function the library no longer declares — upstream clears those regardless,
 * because leaving them makes the placement disagree with its library symbol.
 *
 * Returns the symbol unchanged when nothing needed clearing, so callers can use
 * identity to decide whether anything happened.
 */
export function clearAlternates(
  sym: SchSymbol,
  libPins: readonly LibPin[],
  resetAll: boolean,
): SchSymbol {
  if (!sym.pins?.length) return sym;
  const byNumber = new Map(libPins.map((p) => [p.number, p]));
  let changed = false;
  const pins = sym.pins.map((p) => {
    if (!p.alternate) return p;
    const lib = byNumber.get(p.number);
    // A pin the library no longer has at all: its alternate cannot be valid.
    const keep = !resetAll && !!lib && isUsableAlternate(lib, p.alternate);
    if (keep) return p;
    changed = true;
    const { alternate: _dropped, ...rest } = p;
    return rest;
  });
  return changed ? { ...sym, pins } : sym;
}
