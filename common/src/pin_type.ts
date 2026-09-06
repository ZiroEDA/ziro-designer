// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ELECTRICAL_PINTYPE` and its canonical names.
 * Counterpart: `common/pin_type.h:35-81` — and it lives in common/ for the same
 * reason it does upstream: eeschema owns the pin, but pcbnew reads the type off
 * a pad (`(pintype …)`, PAD::GetPinType) and lists the same twelve values in the
 * Properties panel's Pin Type cell.
 *
 * "These strings are the canonical name of the electrical type. Not translated,
 * no space in name, only ASCII chars." They are also the file tokens, which is
 * why both editors store exactly these strings. The ORDER is the enum's, and
 * `GetCanonicalElectricalTypeName` indexes this array by it, so it is data, not
 * presentation: sorting it would renumber the enum.
 *
 * The human-readable labels are a different table — `g_pinElectricalTypes` in
 * `eeschema/pin_type.cpp`, ours in `eeschema/src/pin_type.ts` — because upstream
 * separates them too: the panel's Pin Type combo lists these canonical names.
 */

export const ELECTRICAL_PINTYPES = [
  'input',
  'output',
  'bidirectional',
  'tri_state',
  'passive',
  /** PT_NIC — not internally connected. */
  'free',
  'unspecified',
  'power_in',
  'power_out',
  'open_collector',
  'open_emitter',
  /** PT_NC. */
  'no_connect',
] as const;

export type ElectricalPinType = (typeof ELECTRICAL_PINTYPES)[number];
