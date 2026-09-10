// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The recovery key shown again, from the account menu.
 *
 * The same contents the sign-up wall shows once (`RecoveryKeyContents`), in
 * the same card, with the one difference the situation has: the person is
 * already in, so the second button is Close rather than "Do this later".
 */
import type { JSX } from 'react';
import { useModalEscape } from '../ui/useModalEscape.js';
import { ZiroLogo } from '../ui/ZiroLogo.js';
import { RecoveryKeyContents } from './RecoveryKeyContents.js';

export function RecoveryKeyDialog({
  words,
  onClose,
}: {
  words: string;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-auth-card ze-auth-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Your recovery key"
      >
        <span className="ze-auth-close" title="Close" onClick={onClose}>
          ✕
        </span>
        <div className="ze-auth-head">
          <ZiroLogo size={52} />
          <div className="ze-auth-title">Recovery key</div>
        </div>
        <RecoveryKeyContents recoveryKey={words} onLater={onClose} laterLabel="Close" />
      </div>
    </div>
  );
}
