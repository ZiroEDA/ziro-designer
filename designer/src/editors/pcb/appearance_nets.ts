// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which nets APPEARANCE_CONTROLS' Nets tab lists, and in what order.
 *
 * `NET_GRID_TABLE::Rebuild` (pcbnew/widgets/appearance_controls.cpp:246-266):
 *
 *     for( const std::pair<const wxString, NETINFO_ITEM*>& pair : nets )
 *     {
 *         int netCode = pair.second->GetNetCode();
 *
 *         if( netCode > 0 && !pair.first.StartsWith( wxT( "unconnected-(" ) ) )
 *             m_nets.emplace_back( ... );
 *     }
 *
 *     std::sort( m_nets.begin(), m_nets.end(),
 *                []( const NET_GRID_ENTRY& a, const NET_GRID_ENTRY& b )
 *                { return a.name < b.name; } );
 *
 * Two decisions, and we had both wrong. It was written inline in
 * `PcbEditor.tsx`, which qa cannot import, so neither could be pinned; here it
 * can be.
 */

/**
 * The Nets tab's rows, as `[code, name]` pairs.
 *
 * `nets` is `BOARD::GetNetInfo().NetsByName()` — our board's own net map.
 *
 * The sort is a plain `<`, which on a wxString is codepoint order. Reaching
 * for `localeCompare` instead reads perfectly plausibly and is wrong: a
 * collation treats punctuation as a tie-breaker rather than as a character, so
 * `+3V3_PI` sorted in among the `/CM5/...` names where '+' (0x2B) belongs
 * ahead of '/' (0x2F), and the four power nets vanished from the top of a
 * 220-net board's list.
 *
 * The filter drops net 0 — the unconnected pseudo-net — AND every
 * `unconnected-(...)` name, which is what a pad with no net is given
 * automatically. Skipping only code 0 left every one of those in the list.
 */
export function appearanceNetRows(
  nets: ReadonlyMap<number, string>,
): readonly (readonly [number, string])[] {
  return [...nets.entries()]
    .filter(([code, name]) => code !== 0 && !name.startsWith('unconnected-('))
    .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
}
