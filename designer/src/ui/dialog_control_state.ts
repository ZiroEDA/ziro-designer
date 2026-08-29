// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Per-dialog control-state persistence: the port of `DIALOG_SHIM`'s
 * `SaveControlState` / `LoadControlState` (common/dialog_shim.cpp:654, :765).
 *
 * **Why this is not one dialog's problem.** Nothing in
 * `eeschema/dialogs/dialog_symbol_chooser.cpp` remembers "Place repeated
 * copies": the checkbox is created with no `SetValue` (:79, unlike `m_useUnits`
 * at :83), the dialog holds no statics, and `eeschema/picksymbol.cpp:62`
 * constructs it as a stack local on every invocation. It survives anyway
 * because `DIALOG_SHIM` — the class *every* KiCad dialog inherits — restores
 * saved values over the constructor's defaults. So this is base-class
 * behaviour, and it is written here once for the same reason.
 *
 * **Lifecycle upstream.** `LoadControlState()` runs from
 * `DIALOG_SHIM::onInitDialog` (:305), the `wxEVT_INIT_DIALOG` handler — after
 * the constructor has set its defaults, before the dialog is on screen.
 * `SaveControlState()` runs from `DIALOG_SHIM::Show( false )` (:542) and from
 * `DIALOG_SHIM::OnCloseWindow` (:1603) — on close, unconditionally, whether the
 * user pressed OK or Cancel or Esc. Ours matches: read once at mount, write
 * once at unmount.
 *
 * **Where it is stored.** `COMMON_SETTINGS::CsInternals().m_dialogControlValues`,
 * registered as the `"dialog.controls"` param and written to `common.json` — a
 * user setting that outlives the process, not session state. Ours is the
 * `dialog.controls` member of the `common` slice, which is that same file.
 * See `prefs/settings.ts`.
 *
 * Split from `useDialogControl.ts` the way `modal_escape.ts` is split from
 * `useModalEscape.ts`, so the keying and the store stay testable without React.
 */
import { settings } from '../prefs/settings.js';
import type { DialogControlValue } from '../prefs/settings.js';

export type { DialogControlValue } from '../prefs/settings.js';

/**
 * The key a dialog's values are filed under: its title, with any trailing
 * parenthesised suffix stripped.
 *
 * A transcription of `getDialogKeyFromTitle` (common/dialog_shim.cpp:79-95),
 * including its comment's reason: *"Dialog titles like 'Choose Symbol (1234
 * items loaded)' would otherwise create unique keys for each item count,
 * flooding the settings file with duplicate entries."* That is not incidental
 * to the reported bug — the Choose Symbol title carries a live item count, so
 * without the strip the chooser could never find what it saved.
 *
 * Upstream a dialog may override the key outright by setting `m_hash_key`
 * (dialog_shim.h:334), which the six dialogs whose titles are *composed* from
 * their contents do — `DIALOG_TEXT_ENTRY` uses caption + field label,
 * `PAGED_DIALOG` its own title, `EDA_LIST_DIALOG` its title. Ours takes the
 * same escape hatch by passing the fixed string it wants keyed on instead of a
 * live title; there is nothing to override when you hand over the key yourself.
 *
 * `rfind`, not `find`: a title that itself contains a bracket keeps all but its
 * last group. `parenPos > 0` leaves a title that *starts* with a bracket alone,
 * rather than keying every such dialog under the empty string.
 */
export function dialogKeyFromTitle(title: string): string {
  const parenPos = title.lastIndexOf('(');
  if (parenPos > 0) {
    let end = parenPos;
    while (end > 0 && title[end - 1] === ' ') end--;
    return title.slice(0, end);
  }
  return title;
}

/** The value stored for one control, or undefined if this dialog is new. */
export function loadDialogControl(
  dialogKey: string,
  controlKey: string,
): DialogControlValue | undefined {
  return settings.common.dialog.controls[dialogKey]?.[controlKey];
}

/** Remember one control's value. `dlgMap[ key ] = ...` in `SaveControlState`. */
export function saveDialogControl(
  dialogKey: string,
  controlKey: string,
  value: DialogControlValue,
): void {
  settings.setDialogControl(dialogKey, controlKey, value);
}

/**
 * What a control actually gets: the stored value if it is the right kind of
 * value, otherwise the default the dialog constructed it with.
 *
 * `LoadControlState` never assigns blind. Every branch asks the JSON what it is
 * first — `j.is_boolean()` before a `wxCheckBox`, `j.is_number_integer()`
 * before a `wxSpinCtrl`, `j.is_string()` before a `wxTextEntry`
 * (dialog_shim.cpp:800-870) — and a value that fails simply is not restored, so
 * the control keeps what its constructor gave it. Comparing against the
 * default's own type says the same thing once instead of thirteen times, and it
 * is the same judgement `deepMerge` makes about the rest of the settings file:
 * a stored value of the wrong type is not a preference, it is damage.
 *
 * Two guards upstream has that this cannot generalise: an index restored into a
 * `wxChoice`/`wxRadioBox`/`wxOwnerDrawnComboBox` is range-checked against the
 * live control's `GetCount()`, and a notebook page is matched by *title* rather
 * than index so that adding a page does not select a different one. A caller
 * persisting a selection index owes its own range check for the same reason.
 */
export function restoredValue<T extends DialogControlValue>(
  stored: DialogControlValue | undefined,
  fallback: T,
): T {
  return typeof stored === typeof fallback ? (stored as T) : fallback;
}
