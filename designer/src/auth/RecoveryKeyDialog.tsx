// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The recovery key shown again, from the account menu.
 *
 * The sign-up wall's words and buttons (`RecoveryKeyContents`), on the shared dialog every ported
 * KiCad dialog is made of, as Delete Account is: `DialogShim` with its title and close box, a body
 * laid out as a wxFormBuilder column (each item bordered `wxALL 5`), and `StdDialogButtons` with
 * Save Key in the OK slot, Close in Cancel's, and Copy on the left. The key is a read-only
 * multi-line entry, so it wraps at its spaces and selects like any field. It used to be the wall's
 * card dropped over the app: the words broken mid-word, Copy drawn over the first line, and the
 * buttons pressed against the text.
 */
import { Button, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { wxALL, wxEXPAND, wxVERTICAL } from '@ziroeda/wx/defs.js';
import type { JSX } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { useRecoveryKeyActions } from './RecoveryKeyContents.js';

/** The column's width: Delete Account's, ente's MUI "xs" - the account dialogs' one size. */
const COLUMN_WIDTH = 444;
/** Its text wraps inside the items' own `wxALL 5`. */
const TEXT_WRAP = COLUMN_WIDTH - 2 * 5;
/**
 * The key's entry, tall enough for all of it: 24 words are three lines at this width, of the
 * entry's 19 px, plus its padding and border - measured headless, 61 px of content - and a line
 * spare. A wxTE_MULTILINE has the size its form states, as this one does.
 */
const KEY_HEIGHT = 84;

export function RecoveryKeyDialog({
  words,
  onClose,
}: {
  words: string;
  onClose: () => void;
}): JSX.Element {
  const { copied, copy, save } = useRecoveryKeyActions(words, onClose);
  return (
    <DialogShim title="Recovery key" onClose={onClose} className="ze-recovery-key-dialog">
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[COLUMN_WIDTH, -1]}>
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL} border={5}>
              <StaticText
                label="If you forget your password, the only way you can recover your data is with this key."
                wrap={TEXT_WRAP}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[-1, KEY_HEIGHT]}>
              <TextCtrl multiLine readOnly value={words} ariaLabel="Recovery key" />
            </SizerItem>
            <SizerItem flag={wxALL} border={5}>
              <StaticText
                label="We don't store this key, so please save this in a safe place"
                wrap={TEXT_WRAP}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons onCancel={onClose} cancelLabel="Close" onOk={save} okLabel="Save Key">
        <Button label={copied ? 'Copied' : 'Copy'} onClick={() => void copy()} />
      </StdDialogButtons>
    </DialogShim>
  );
}
