// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window half of `DisplayErrorMessage` (common/confirm.cpp): the error
 * box is a modal of its own, not a child of any frame's tree, so it gets its
 * own root - as the wx dialog gets its own top-level window.
 */
import { createRoot } from 'react-dom/client';
import {
  type KICAD_MESSAGE_DIALOG_ARG,
  SetErrorPresenter,
  SetInfoPresenter,
  SetMessageDialogPresenter,
  SetQuestionPresenter,
} from './confirm.js';
import {
  wxCANCEL,
  wxCANCEL_DEFAULT,
  wxNO,
  wxNO_DEFAULT,
  wxICON_ERROR,
  wxICON_EXCLAMATION,
  wxICON_QUESTION,
} from './wx/defs.js';
import { wxID_CANCEL, wxID_NO, wxID_OK, wxID_YES } from './wx/menu.js';
import {
  MessageDialogError,
  MessageDialogOk,
  MessageDialogYesNo,
} from './dialogs/dialog_message.js';

/** Route `DisplayErrorMessage` to the real error box. Called once, at startup. */
export function InstallErrorPresenter(): void {
  SetErrorPresenter((aText, aExtraInfo) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (): void => {
      root.unmount();
      host.remove();
    };
    root.render(
      <MessageDialogError
        message={aText}
        {...(aExtraInfo ? { extendedMessage: aExtraInfo } : {})}
        onClose={close}
      />,
    );
  });
}

/** Route `IsOK` to the real question box. Called once, at startup. */
export function InstallQuestionPresenter(): void {
  SetQuestionPresenter(
    (aMessage) =>
      new Promise<boolean>((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        root.render(
          <MessageDialogYesNo
            caption="Confirmation"
            message={aMessage}
            icon="question"
            // SetOKCancelLabels( _( "&Yes" ), _( "&No" ) ): the labels read Yes
            // and No, the stock pair's spelling.
            defaultButton="yes"
            onResult={(result) => {
              root.unmount();
              host.remove();
              resolve(result === 'yes');
            }}
          />,
        );
      }),
  );
}

/** Route `DisplayInfoMessage` to the real information box. Called once, at startup. */
export function InstallInfoPresenter(): void {
  SetInfoPresenter(
    (aMessage, aExtraInfo) =>
      new Promise<void>((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        root.render(
          <MessageDialogOk
            caption="Information"
            message={aExtraInfo ? `${aMessage}\n${aExtraInfo}` : aMessage}
            onClose={() => {
              root.unmount();
              host.remove();
              resolve();
            }}
          />,
        );
      }),
  );
}

/**
 * Route `ShowKicadMessageDialog` to the native message box. Called once, at startup. An OK-only
 * style is the one-button box; with wxCANCEL it is the two-button box, its labels the
 * SetOKCancelLabels pair, its default wxCANCEL_DEFAULT's choice; wxYES_NO the same box answering
 * wxID_YES / wxID_NO.
 */
export function InstallMessageDialogPresenter(): void {
  SetMessageDialogPresenter(
    (aArg: KICAD_MESSAGE_DIALOG_ARG) =>
      new Promise<number>((resolve) => {
        const icon =
          aArg.style & wxICON_ERROR
            ? 'error'
            : aArg.style & wxICON_EXCLAMATION
              ? 'warning'
              : aArg.style & wxICON_QUESTION
                ? 'question'
                : 'information';
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const done = (aId: number): void => {
          root.unmount();
          host.remove();
          resolve(aId);
        };
        root.render(
          aArg.style & wxNO ? (
            // wxYES_NO: the two-button box answering wxID_YES / wxID_NO, its labels the
            // SetYesNoLabels pair, its default wxNO_DEFAULT's choice.
            <MessageDialogYesNo
              caption={aArg.caption}
              message={aArg.message}
              {...(aArg.extended ? { extendedMessage: aArg.extended } : {})}
              icon={icon}
              defaultButton={aArg.style & wxNO_DEFAULT ? 'no' : 'yes'}
              labels={{ yes: aArg.okLabel ?? 'Yes', no: aArg.cancelLabel ?? 'No' }}
              onResult={(r) => done(r === 'yes' ? wxID_YES : wxID_NO)}
            />
          ) : aArg.style & wxCANCEL ? (
            <MessageDialogYesNo
              caption={aArg.caption}
              message={aArg.message}
              {...(aArg.extended ? { extendedMessage: aArg.extended } : {})}
              icon={icon}
              defaultButton={aArg.style & wxCANCEL_DEFAULT ? 'no' : 'yes'}
              labels={{ yes: aArg.okLabel ?? 'OK', no: aArg.cancelLabel ?? 'Cancel' }}
              onResult={(r) => done(r === 'yes' ? wxID_OK : wxID_CANCEL)}
            />
          ) : (
            <MessageDialogOk
              caption={aArg.caption}
              message={aArg.extended ? `${aArg.message}\n${aArg.extended}` : aArg.message}
              icon={icon}
              onClose={() => done(wxID_OK)}
            />
          ),
        );
      }),
  );
}
