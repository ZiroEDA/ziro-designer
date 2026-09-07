// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIDIALOG` (`include/kidialog.h`, `common/kidialog.cpp`) — the message box
 * that can be told not to come back.
 *
 * Upstream it is a `wxRichMessageDialog`, i.e. the ordinary message dialog plus
 * a checkbox, so it inherits `KICAD_MESSAGE_DIALOG`'s icon, its GTK button
 * order and its extended-message line. Ours does the same: `DialogIcon` and
 * `yesNoButtons` come from the message-dialog modules rather than being drawn
 * again here, and the only thing this file adds is the checkbox row and the
 * memory behind it (`do_not_show_again.ts`).
 *
 * **The API is a promise, and that is the port of `ShowModal()`.** Upstream:
 *
 *     KIDIALOG dlg( m_frame, msg, _( "Confirmation" ), wxOK | wxCANCEL | wxICON_WARNING );
 *     dlg.SetOKLabel( _( "Place Pin Anyway" ) );
 *     dlg.DoNotShowCheckbox( __FILE__, __LINE__ );
 *
 *     if( dlg.ShowModal() == wxID_CANCEL )
 *         return false;
 *
 * A browser has no nested event loop, so the closest thing to a call that
 * blocks and returns the user's answer is one that returns a promise of it.
 * `useKiDialog` hands back exactly that — `ask(...)` and the node to render —
 * and the suppression check lives inside `ask`, so a caller that never sees the
 * dialog is a caller whose `await` simply resolved at once. That is what
 * `ShowModal`'s early return does.
 *
 * There is no `ShowDetailedText` here. Three upstream call sites use it and
 * none of them is a dialog this port has yet (sheet properties' colour-theme
 * note, the router's malformed-zone warning, Configure Paths' restart notice);
 * a collapsible details pane nothing opens is a widget written on speculation.
 *
 * **It does NOT look like `MessageDialogYesNo`, and that was the surprise.**
 * `KICAD_MESSAGE_DIALOG` is `wxMessageDialog`, which on GTK is the platform's
 * own message box: one full-width button row, no separator, a 44 px icon.
 * `KIDIALOG` is `wxRichMessageDialog`, and `wx/richmsgdlg.h` makes that
 * `wxGenericRichMessageDialog` on every platform but MSW — a plain wxDialog
 * that wx lays out itself, with a 48 px icon, a `wxStaticLine`, and buttons
 * right-aligned in a `wxStdDialogButtonSizer`. So it takes its own chrome
 * (`.ze-kidialog`), measured by `qa/probes/kidialog_probe.cpp`, rather than
 * borrowing `.ze-msgdlg`'s.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { DialogIcon } from './dialog_message.js';
import { type MessageDialogIcon, okCancelButtons } from './message_dialog.js';
import {
  type DoNotShowKey,
  type KiDialogResult,
  doNotShowAgainAnswer,
  rememberDoNotShowAgain,
} from './do_not_show_again.js';
import { useModalEscape } from './useModalEscape.js';

/** `ShowCheckBox( _( "Do not show again" ), false )` (`kidialog.cpp:57`). [data] */
export const DO_NOT_SHOW_AGAIN_LABEL = 'Do not show again';

export interface KiDialogRequest {
  /** The window title — `KIDIALOG`'s `aCaption`. */
  caption: string;
  /** `aMessage`. */
  message: string;
  /** `SetExtendedMessage`, the smaller line under it. */
  extendedMessage?: string;
  /** The `wxICON_*` in the style word. */
  icon: MessageDialogIcon;
  /**
   * `SetOKLabel` / `SetOKCancelLabels`. Naming BOTH is what upstream's
   * `SetOKCancelLabels` override does, and it is not cosmetic: it clears
   * `m_cancelMeansCancel`, so a Cancel answer becomes worth remembering. See
   * `rememberDoNotShowAgain`.
   */
  labels?: { ok?: string; cancel?: string };
  /**
   * `DoNotShowCheckbox( aUniqueId, line )`. Present: the checkbox is drawn and
   * this dialog can be suppressed. Absent: no checkbox, exactly as a KIDIALOG
   * that never calls it has none.
   */
  doNotShowKey?: DoNotShowKey;
}

/**
 * The dialog itself. `.ze-msgdlg` is `KICAD_MESSAGE_DIALOG`'s shell; the
 * checkbox row sits between the message and the buttons, where
 * wxRichMessageDialog puts it.
 */
export function KiDialog({
  request,
  onResult,
}: {
  request: KiDialogRequest;
  onResult: (result: KiDialogResult, checked: boolean) => void;
}): JSX.Element {
  const [checked, setChecked] = useState(false);
  // wxOK|wxCANCEL has a Cancel button, so Esc is that button.
  useModalEscape(() => onResult('cancel', checked));

  const defaultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    defaultRef.current?.focus();
  }, []);

  // `wxOK | wxCANCEL` in GTK order — the affirmative LAST, and each button at
  // its own stock label unless this dialog renamed it.
  const buttons = okCancelButtons(request.labels);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-kidialog" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{request.caption}</div>
        <div className="ze-kidialog-body">
          <DialogIcon icon={request.icon} className="ze-kidialog-icon" />
          <div className="ze-kidialog-text">
            <div className="ze-kidialog-message">{request.message}</div>
            {request.extendedMessage && (
              <div className="ze-kidialog-extended">{request.extendedMessage}</div>
            )}
          </div>
        </div>
        {request.doNotShowKey !== undefined && (
          <label className="ze-pref-check ze-kidialog-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {DO_NOT_SHOW_AGAIN_LABEL}
          </label>
        )}
        {/* `wxStaticLine`, which the generic dialog puts above the buttons and
            the native message box has not got at all. */}
        <div className="ze-kidialog-line" />
        <div className="ze-kidialog-buttons">
          {buttons.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`ze-btn${b.isDefault ? ' primary' : ''}`}
              ref={b.isDefault ? defaultRef : undefined}
              onClick={() => onResult(b.id, checked)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * `ShowModal()` for a React frame: `ask` returns the answer, `node` is what the
 * frame has to render for the dialog to appear.
 *
 * One host per frame, not one per question — upstream a KIDIALOG is
 * constructed, shown and destroyed at the call site, and there is never more
 * than one up at a time because `ShowModal` blocks.
 */
export function useKiDialog(): {
  ask: (request: KiDialogRequest) => Promise<KiDialogResult>;
  node: JSX.Element | null;
} {
  const [pending, setPending] = useState<{
    request: KiDialogRequest;
    resolve: (r: KiDialogResult) => void;
  } | null>(null);

  const ask = useCallback((request: KiDialogRequest): Promise<KiDialogResult> => {
    // `ShowModal`'s early return: a dialog the user has silenced answers the
    // way they answered it, without being drawn.
    if (request.doNotShowKey !== undefined) {
      const remembered = doNotShowAgainAnswer(request.doNotShowKey);
      if (remembered !== undefined) return Promise.resolve(remembered);
    }
    return new Promise<KiDialogResult>((resolve) => {
      setPending({ request, resolve });
    });
  }, []);

  const node =
    pending === null ? null : (
      <KiDialog
        request={pending.request}
        onResult={(result, checked) => {
          if (pending.request.doNotShowKey !== undefined) {
            rememberDoNotShowAgain(pending.request.doNotShowKey, result, {
              checked,
              // `m_cancelMeansCancel` is true unless BOTH labels were set.
              cancelMeansCancel: !(
                pending.request.labels?.ok !== undefined &&
                pending.request.labels?.cancel !== undefined
              ),
            });
          }
          setPending(null);
          pending.resolve(result);
        }}
      />
    );

  return { ask, node };
}
