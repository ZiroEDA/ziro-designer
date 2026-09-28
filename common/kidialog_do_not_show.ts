// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIDIALOG`'s "do not show again" memory — `common/kidialog.cpp`'s
 * file-static map, and the three rules that decide what goes into it.
 *
 *     // Set of dialogs that have been chosen not to be shown again
 *     static std::unordered_map<unsigned long, int> g_doNotShowAgainDlgs;
 *
 * **It is SESSION state, not a setting.** Nothing writes it to disk: quit KiCad
 * and every suppressed dialog comes back. That is why Preferences >
 * Maintenance has to clear two different things — this map, and
 * `COMMON_SETTINGS::m_DoNotShowAgain`, which is six persisted bools belonging
 * to six specific warnings and has nothing to do with this class.
 *
 * Split out of the component for the reason `prefs/maintenance.ts` is split out
 * of its panel: the rules below are the whole of the behaviour and none of them
 * needs a DOM.
 */

/** The value stored: **the answer the user gave**, not merely "suppressed". */
export type KiDialogResult = 'ok' | 'cancel';

/**
 * `g_doNotShowAgainDlgs`. Module state, so it dies with the tab exactly as
 * upstream's dies with the process.
 */
const g_doNotShowAgainDlgs = new Map<string, KiDialogResult>();

/**
 * `KIDIALOG::DoNotShowCheckbox( wxString aUniqueId, int line )`:
 *
 *     m_hash = std::hash<wxString>{}( aUniqueId ) + line;
 *
 * Upstream every call site but three passes `__FILE__, __LINE__`, and hashes
 * the pair down to an `unsigned long`. Ours keys on the id STRING itself: there
 * is no `__FILE__` in a bundle, a literal line number is a lie the moment the
 * file is edited, and hashing a string we already have buys nothing but
 * collisions. KiCad's own `pcbnew/files.cpp:683`, `pcb_control.cpp:2150` and
 * `kicad_clipboard.cpp:513` do the same thing — `DoNotShowCheckbox( aMessage,
 * 0 )` — so a caller-chosen unique string is upstream's own second form.
 *
 * What the key must be is STABLE: change it and every user's suppression for
 * that dialog silently comes back.
 */
export type DoNotShowKey = string;

/**
 * `KIDIALOG::ShowModal`'s first three lines — the answer this dialog was told
 * to keep giving, or `undefined` if it should be shown.
 *
 *     auto it = g_doNotShowAgainDlgs.find( m_hash );
 *     if( it != g_doNotShowAgainDlgs.end() )
 *         return it->second;
 *
 * Note it returns the STORED ANSWER, not a fixed one. A suppressed dialog
 * keeps answering the way the user answered it, so ticking the box on "Place
 * Pin Anyway" and pressing Cancel — where that is stored at all, see below —
 * goes on cancelling.
 */
export function doNotShowAgainAnswer(key: DoNotShowKey): KiDialogResult | undefined {
  return g_doNotShowAgainDlgs.get(key);
}

/**
 * The tail of `ShowModal`, which is the subtle one:
 *
 *     if( IsCheckBoxChecked() && ( !m_cancelMeansCancel || ret != wxID_CANCEL ) )
 *         g_doNotShowAgainDlgs[m_hash] = ret;
 *
 * `m_cancelMeansCancel` starts true and only `SetOKCancelLabels` clears it
 * (`include/kidialog.h:52-56`) — `SetOKLabel` does not. So the rule reads: if
 * the dialog RENAMED BOTH buttons, Cancel is doing some other job and is worth
 * remembering; if Cancel still says "Cancel", a user who ticks the box and then
 * cancels is not asking to have the answer "no" applied forever without being
 * asked again. Upstream's own comment says exactly that, and it is why this is
 * a condition rather than an unconditional store.
 */
export function rememberDoNotShowAgain(
  key: DoNotShowKey,
  result: KiDialogResult,
  opts: { checked: boolean; cancelMeansCancel: boolean },
): void {
  if (!opts.checked) return;
  if (opts.cancelMeansCancel && result === 'cancel') return;
  g_doNotShowAgainDlgs.set(key, result);
}

/**
 * `KIDIALOG::ClearDoNotShowAgainDialogs()` (`common/kidialog.cpp:49-52`) —
 * `g_doNotShowAgainDlgs = {}`, which is the session half of Preferences >
 * Maintenance > Reset "Don't Show Again" Dialogs.
 *
 * Returns how many were forgotten, for the infobar line. Upstream's message is
 * unconditional; the count is what lets this page say "there were none" the way
 * its two neighbouring buttons already do.
 */
export function clearDoNotShowAgainDialogs(): number {
  const n = g_doNotShowAgainDlgs.size;
  g_doNotShowAgainDlgs.clear();
  return n;
}

/**
 * Every key this port uses, in one place.
 *
 * Upstream needs no such list: `DoNotShowCheckbox( __FILE__, __LINE__ )`
 * derives the key from where the call sits, so there is nothing to write down
 * and nothing to keep in step. Ours is written by hand, and a hand-written key
 * that must never change is exactly the thing to declare once and test — a key
 * edited in passing silently un-silences every user's dialog, and nothing about
 * the change would look like that is what it did.
 */
export const DO_NOT_SHOW_KEYS = {
  /**
   * `SYMBOL_EDITOR_PIN_TOOL::PlacePin`
   * (`eeschema/tools/symbol_editor_pin_tool.cpp:230-236`) — placing a pin on
   * top of another unit's pin while Synchronized Pins Mode is on.
   */
  symbolEditorPinClash: 'eeschema/tools/symbol_editor_pin_tool.cpp:PlacePin',
} as const satisfies Record<string, DoNotShowKey>;
