// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The recovery key, shown to a person: once at sign-up, and again from the
 * account menu for whoever chose "Do this later".
 *
 * The words are the reference design's, because they are the right ones: the
 * first sentence says what the key is FOR, the second says why it has to be
 * saved now, and Save Key and "Do this later" are the two honest answers.
 * Save Key writes a text file, since a file in Downloads survives the tab in a
 * way a clipboard does not; Copy is beside them for the people whose safe
 * place is a password manager. (Copy sat inside the words, top right, over
 * the first line's last word.)
 */
import { Button } from '@ziroeda/wx/controls.js';
import { useState, type JSX } from 'react';

/**
 * Copy and Save Key, for whichever surface shows the key: the sign-up wall's page, or the account
 * menu's dialog. Save Key writes `ziroeda-recovery-key.txt` and then calls `onSaved`.
 */
export function useRecoveryKeyActions(
  recoveryKey: string,
  onSaved: () => void,
): { copied: boolean; copy: () => Promise<void>; save: () => void } {
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
    onSaved();
  };

  return { copied, copy, save };
}

export function RecoveryKeyContents({
  recoveryKey,
  onLater,
}: {
  recoveryKey: string;
  /** "Do this later", and after Save Key. */
  onLater: () => void;
}): JSX.Element {
  const { copied, copy, save } = useRecoveryKeyActions(recoveryKey, onLater);

  // A form, for the auth forms' spacing between its blocks; Save Key is its submit.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="ze-auth-note">
        If you forget your password, the only way you can recover your data is with this key.
      </p>
      <div className="ze-auth-recovery-key" aria-label="Recovery key">
        {recoveryKey}
      </div>
      <p className="ze-auth-note">We don't store this key, so please save this in a safe place</p>
      <div className="ze-auth-recovery-actions">
        <Button label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()} />
        <Button label="Do this later" onClick={onLater} />
        <Button label="Save Key" isDefault className="ze-auth-submit" onClick={save} />
      </div>
    </form>
  );
}
