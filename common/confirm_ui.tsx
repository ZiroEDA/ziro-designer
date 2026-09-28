// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window half of `DisplayErrorMessage` (common/confirm.cpp): the error
 * box is a modal of its own, not a child of any frame's tree, so it gets its
 * own root - as the wx dialog gets its own top-level window.
 */
import { createRoot } from 'react-dom/client';
import { SetErrorPresenter, SetInfoPresenter, SetQuestionPresenter } from './confirm.js';
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
