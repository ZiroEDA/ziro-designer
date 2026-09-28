// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shape of `MAIL_SCH_GET_NETLIST`'s payload, both ways: upstream this
 * crosses a real KIWAY mail as a plain string (`wxString`) — the netlist
 * text on success, the annotate message unchanged on refusal. Named here so
 * `eeschema/cross-probing.ts` (the handler, `formatSchematicNetlist`) and
 * `pcbnew/netlist_from_schematic.ts` (the board-side reader, which parses
 * the text into its own `NETLIST`) agree on it without either importing the
 * other — `common/` is the one place both may import from.
 */
export type NetlistTextResult =
  | { ok: true; netlistText: string }
  | { ok: false; error: string; details?: string };
