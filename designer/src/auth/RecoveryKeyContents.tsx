// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The recovery key, shown to a person: once at sign-up, and again from the
 * account menu for whoever chose "Do this later".
 *
 * The words are the reference design's, because they are the right ones: the
 * first sentence says what the key is FOR, the second says why it has to be
 * saved now, and the two buttons are the two honest answers. "Save Key"
 * writes a text file, since a file in Downloads survives the tab in a way a
 * clipboard does not; Copy is beside the words for the people whose safe
 * place is a password manager.
 */
import { useState, type JSX } from 'react';

export function RecoveryKeyContents({
  recoveryKey,
  onLater,
  laterLabel = 'Do this later',
}: {
  recoveryKey: string;
  /** "Do this later" (or Close, when shown again from the account menu). */
  onLater: () => void;
  laterLabel?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // No clipboard (an insecure context, or denied): the words are on
      // screen and selectable, which is the point of the screen anyway.
    }
  };

  const save = (): void => {
    const blob = new Blob([`${recoveryKey}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ziroeda-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
    onLater();
  };

  return (
    <div>
      <p className="ze-auth-note">
        If you forget your password, the only way you can recover your data is with this key.
      </p>
      <div className="ze-auth-recovery-key" aria-label="Recovery key">
        {recoveryKey}
        <button type="button" className="ze-auth-recovery-copy" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="ze-auth-note">We don't store this key, so please save this in a safe place</p>
      <div className="ze-auth-recovery-actions">
        <button type="button" className="ze-btn" onClick={onLater}>
          {laterLabel}
        </button>
        <button type="button" className="ze-btn primary ze-auth-submit" onClick={save}>
          Save Key
        </button>
      </div>
    </div>
  );
}
