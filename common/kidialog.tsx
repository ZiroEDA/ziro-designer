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
 * `ShowDetailedText` is wxGenericRichMessageDialog's collapsible pane, "See details" /
 * "Hide details" (wx/richmsgdlg.h), under the message; MULTICHANNEL_TOOL's topology
 * mismatch is its first caller here.
 *
 * **It does NOT look like `MessageDialogYesNo`, and that was the surprise.**
 * `KICAD_MESSAGE_DIALOG` is `wxMessageDialog`, which on GTK is the platform's
 * own message box: a client-side-decorated window with its own 30 px title
 * strip, one full-width button row, no separator. `KIDIALOG` is
 * `wxRichMessageDialog`, and `wx/richmsgdlg.h` makes that
 * `wxGenericRichMessageDialog` on every platform but MSW — a plain wxDialog
 * under the window manager's title bar, laid out by wx itself: a
 * `wxStaticLine`, and buttons right-aligned in a `wxStdDialogButtonSizer`. So
 * it takes its own chrome
 * (`.ze-kidialog`), measured by `qa/probes/kidialog_probe.cpp`, rather than
 * borrowing `.ze-msgdlg`'s.
 */
import { CheckBox, StaticText } from '@ziroeda/wx/controls.js';
import { WxCollapsiblePane } from './widgets/wx_collapsible_pane.js';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { DialogIcon } from './dialogs/dialog_message.js';
import { type MessageDialogIcon, okCancelButtons, yesNoCancelButtons } from './confirm_types.js';
import {
  type DoNotShowKey,
  type KiDialogResult,
  doNotShowAgainAnswer,
  rememberDoNotShowAgain,
} from './kidialog_do_not_show.js';
import { DialogShim } from './dialog_shim.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `ShowCheckBox( _( "Do not show again" ), false )` (`kidialog.cpp:57`). [data] */
export const DO_NOT_SHOW_AGAIN_LABEL = _HKI('Do not show again');

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
  /** `ShowDetailedText( aText )`: the text behind the "See details" pane. */
  detailedText?: string;
  /** `wxOK` without `wxCANCEL`: one OK button. */
  okOnly?: boolean;
  /**
   * `wxYES_NO | wxCANCEL` with `SetYesNoCancelLabels( yes, no, cancel )`: Yes, No and Cancel
   * instead of OK and Cancel, Yes the default.
   */
  yesNo?: { yes?: string; no?: string; cancel?: string };
}

/** wxGenericRichMessageDialog's expander labels (wx/richmsgdlg.h). [data] */
const DETAILS_COLLAPSED_LABEL = 'See details';
const DETAILS_EXPANDED_LABEL = 'Hide details';

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
  const [detailsShown, setDetailsShown] = useState(false);
  // wxOK|wxCANCEL has a Cancel button, so Esc is that button.

  const defaultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    defaultRef.current?.focus();
  }, []);

  // `wxOK | wxCANCEL` in GTK order — the affirmative LAST, and each button at
  // its own stock label unless this dialog renamed it.
  // `wxYES_NO | wxCANCEL`: the std dialog button sizer's GTK order is the message box's.
  const buttons: { id: KiDialogResult; label: string; isDefault: boolean }[] = request.yesNo
    ? yesNoCancelButtons('yes', request.yesNo)
    : okCancelButtons(request.labels).filter((b) => !request.okOnly || b.id === 'ok');

  return (
    <DialogShim
      title={request.caption}
      onClose={() => onResult('cancel', checked)}
      className="ze-kidialog"
    >
      <div className="ze-kidialog-body">
        <DialogIcon icon={request.icon} className="ze-kidialog-icon" />
        <div className="ze-kidialog-text">
          <div className="ze-kidialog-message">{request.message}</div>
          {request.extendedMessage && (
            <div className="ze-kidialog-extended">{request.extendedMessage}</div>
          )}
        </div>
      </div>
      {request.detailedText !== undefined && (
        <WxCollapsiblePane
          label={detailsShown ? DETAILS_EXPANDED_LABEL : DETAILS_COLLAPSED_LABEL}
          collapsed={!detailsShown}
          onChange={(aCollapsed) => setDetailsShown(!aCollapsed)}
        >
          <StaticText label={request.detailedText} />
        </WxCollapsiblePane>
      )}
      {request.doNotShowKey !== undefined && (
        <CheckBox
          label={DO_NOT_SHOW_AGAIN_LABEL}
          checked={checked}
          className="ze-pref-check ze-kidialog-check"
          onChange={(aChecked) => setChecked(aChecked)}
        />
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
    </DialogShim>
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
