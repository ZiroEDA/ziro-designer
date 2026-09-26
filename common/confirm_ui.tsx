// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window half of `DisplayErrorMessage` (common/confirm.cpp): the error
 * box is a modal of its own, not a child of any frame's tree, so it gets its
 * own root - as the wx dialog gets its own top-level window.
 */
import { createRoot } from 'react-dom/client';
import { SetErrorPresenter } from './confirm.js';
import { MessageDialogError } from './dialogs/dialog_message.js';

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
