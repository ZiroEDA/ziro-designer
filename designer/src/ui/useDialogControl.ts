// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The hook a dialog calls to get `DIALOG_SHIM`'s free control-state
 * persistence. One line at the top of a dialog component, in place of
 * `useState`:
 *
 *     const [keepSymbol, setKeepSymbol] = useDialogControl( title, 'keepSymbol', false );
 *
 * See dialog_control_state.ts for the upstream mechanism, its lifecycle, and
 * where the values live. Split from it so the store stays testable without
 * React, exactly as `useModalEscape` is split from `modal_escape.ts`.
 *
 * ## How a control is identified, and why not the way upstream does it
 *
 * `DIALOG_SHIM::generateKey` (common/dialog_shim.cpp:611-649) walks up from the
 * control to the dialog building `wxCheckBox_1`, `wxPanel_0wxCheckBox_1`, and
 * so on: **class name plus the control's index among its same-class siblings**.
 * That key is purely positional. Swap two checkboxes in a wxFormBuilder file
 * and each silently inherits the other's remembered value; delete one and every
 * later one shifts. Upstream accepts that because a dialog laid out in
 * wxFormBuilder rarely gets reordered, and because there is a real window tree
 * to walk.
 *
 * There is no such tree to walk here. A React dialog's state is declared before
 * anything is rendered, and a controlled `<input checked={...}>` cannot be
 * restored by poking the DOM anyway — the next render would overwrite it. So
 * the control key is named at the call site instead. That is a deliberate
 * improvement on the positional key and not a drift from it: it is the same
 * per-control string in the same per-dialog map, and it is stable under exactly
 * the edits that break upstream's.
 *
 * The dialog key is *not* improvised: it is upstream's, the title with any
 * trailing parenthesised suffix stripped (`dialogKeyFromTitle`).
 *
 * ## What is excluded
 *
 * Upstream persists **everything** by default and opts individual things out.
 * `DIALOG_SHIM::OptOut( win )` (:931) hangs a `PROPERTY_HOLDER` with
 * `persist = false` on the window; both walkers check it and `return` *before*
 * recursing, so opting out a container excludes its whole subtree, and
 * `OptOut( this )` excludes the dialog. Every use of it upstream falls into one
 * of three groups, and they are the groups this hook must not be pointed at:
 *
 *  - **paths and filenames** — `dialog_export_step.cpp:121` (m_outputFileName),
 *    `footprint_libraries_utils.cpp:1029` (m_fpNameCtrl);
 *  - **seeded from the current selection or document** —
 *    `dialog_group_properties.cpp:45`, `dialog_global_deletion.cpp:58`,
 *    `dialog_grid_settings.cpp:46`, `dialog_unit_entry.cpp:71-72`,
 *    `dialog_text_entry.cpp:48`, `eda_list_dialog.cpp:137`,
 *    `dialog_sim_format_value.cpp:33`, `dialog_migrate_buses.cpp:63`;
 *  - **content, not settings** — `dialog_git_commit.cpp:136` (the commit
 *    message), and the find/replace history combos in
 *    `eeschema/dialogs/dialog_sch_find.cpp:42-43` and
 *    `pcbnew/dialogs/dialog_find.cpp:47`.
 *
 * The opt-out survives here as the sense of the API rather than as a call:
 * because this hook is reached by *using* it instead of `useState`, a control
 * nobody opted in is already excluded, and a path or a value seeded from the
 * document simply stays on `useState`. That inverts upstream's default, which
 * is the safer direction — upstream's failure mode is a filename remembered
 * because someone forgot to call `OptOut`, and it cannot happen here.
 *
 * `OptOut( this )`, the whole-dialog form, does have a counterpart, because a
 * dialog can persist conditionally: passing a null title turns every one of its
 * controls back into plain `useState`, reading nothing and writing nothing.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import type { DialogControlValue } from '../prefs/settings.js';
import {
  dialogKeyFromTitle,
  loadDialogControl,
  restoredValue,
  saveDialogControl,
} from './dialog_control_state.js';

/** `false` back to `boolean`, `'x'` back to `string`. See below. */
type Widened<T extends DialogControlValue> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : string;

/**
 * `useState`, plus this dialog's memory of what the control was last set to.
 *
 * `Widened` and the one cast below exist because a checkbox's default is
 * written `false`, from which the generic infers the *literal* type `false` —
 * handing back a setter that cannot tick the box. Everything inside works in
 * the un-narrowed {@link DialogControlValue}, which is what the store holds.
 *
 * @param dialogTitle the dialog's title as shown, which may carry a live suffix
 *   like `" (1234 items loaded)"`; the key is derived from it by
 *   {@link dialogKeyFromTitle}. Null is `OptOut( this )`: no read, no write.
 * @param controlKey names the control within the dialog. Must be unique inside
 *   one dialog and stable across releases — it is what upstream's positional
 *   `wxCheckBox_1` is trying and failing to be.
 * @param defaultValue what the control is constructed with, and what it keeps
 *   on a first-ever open or when the stored value is of the wrong type.
 */
export function useDialogControl<T extends DialogControlValue>(
  dialogTitle: string | null,
  controlKey: string,
  defaultValue: T,
): [Widened<T>, Dispatch<SetStateAction<Widened<T>>>] {
  // `LoadControlState` from onInitDialog: once, over the constructor's default.
  // The lazy initialiser is what makes it once — a later render must not pull
  // the stored value back over what the user has just clicked.
  const [value, setValue] = useState<DialogControlValue>(() =>
    dialogTitle === null
      ? defaultValue
      : restoredValue(loadDialogControl(dialogKeyFromTitle(dialogTitle), controlKey), defaultValue),
  );

  // The unmount cleanup below runs with the deps it closed over at mount, which
  // for the value would be the default and for the title the one the dialog
  // opened with. Both have to be the *last* ones instead: the value because
  // saving the value the user did not choose is the bug this whole module
  // exists to fix, and the title because ours changes while the dialog is open
  // (the chooser's item count) even though the key derived from it does not.
  const latest = useRef({ dialogTitle, controlKey, value });
  useEffect(() => {
    latest.current = { dialogTitle, controlKey, value };
  });

  // `SaveControlState` from Show( false ) / OnCloseWindow: on close, whatever
  // closed it. A React dialog is unmounted by its owner on OK and on Cancel and
  // on Esc alike, so the unmount cleanup is that same unconditional point.
  useEffect(() => {
    return () => {
      const saved = latest.current;
      if (saved.dialogTitle === null) return;
      saveDialogControl(dialogKeyFromTitle(saved.dialogTitle), saved.controlKey, saved.value);
    };
  }, []);

  // The only cast in the module, and it widens rather than reinterprets: the
  // runtime pair is exactly what the signature promises, with `false` read back
  // as `boolean`. See `Widened`.
  return [value, setValue] as unknown as [Widened<T>, Dispatch<SetStateAction<Widened<T>>>];
}
