// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GIT_COMMIT` (common/dialogs/git/dialog_git_commit.cpp), "Commit Changes": the files to
 * commit with their status, the message, and the author. The sizer tree is the constructor's,
 * Add() for Add():
 *
 *     sizer->Add( m_listCtrl, 1, wxEXPAND | wxALL, 5 );
 *     sizer->Add( commitMessageLabel, 0, wxALL, 5 );
 *     sizer->Add( m_commitMessageTextCtrl, 1, wxEXPAND | wxALL, 5 );
 *     sizer->Add( authorLabel, 0, wxALL, 5 );
 *     sizer->Add( m_authorTextCtrl, 0, wxEXPAND | wxALL, 5 );
 *     sizer->Add( buttonSizer, 0, wxALIGN_RIGHT | wxALL, 5 );
 *
 * with OK relabelled "C&ommit" and enabled only while there is a message (`updateOkButton`).
 *
 * Two differences, both because there is no local repository:
 *
 * - No checkbox column (`EnableCheckBoxes`): every change listed is committed. Upstream ticks only
 *   what is already staged, and nothing is ever staged here.
 * - The author is the connected GitHub account, which GitHub stamps on the commit itself, so the
 *   field shows it and does not take an edit.
 */
import { useRef, useState, type JSX } from 'react';
import { ListCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { wxALL, wxEXPAND, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { _ } from '@ziroeda/wx/translation.js';
import { DialogShim, StdDialogButtons } from '../../dialog_shim.js';

/** One file: its path, and `New` / `Modified` / `Deleted`. */
export interface GitCommitFile {
  path: string;
  status: 'new' | 'modified' | 'deleted';
}

/** The Status column's words (dialog_git_commit.cpp:98-116). */
export function gitStatusLabel(aStatus: GitCommitFile['status']): string {
  switch (aStatus) {
    case 'new':
      return _('New');
    case 'modified':
      return _('Modified');
    case 'deleted':
      return _('Deleted');
  }
}

export function DIALOG_GIT_COMMIT({
  files,
  author,
  onResult,
}: {
  files: readonly GitCommitFile[];
  /** `defaultAuthor`: who the commit is by. */
  author: string;
  /** `GetCommitMessage()` on wxID_OK; null on wxID_CANCEL. */
  onResult: (aMessage: string | null) => void;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // `updateOkButton`: a message, and (m_requireFiles) at least one file.
  const okEnabled = message.trim() !== '' && files.length > 0;

  return (
    <DialogShim
      title={_('Commit Changes')}
      onClose={() => onResult(null)}
      initialFocus={messageRef}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* AppendColumn( "Filename" ), AppendColumn( "Status" ), each SetColumnWidth 200. */}
          <ListCtrl
            ariaLabel={_('Commit Changes')}
            headers={[_('Filename'), _('Status')]}
            columnWidths={[200, 200]}
            rows={files.map((f) => [f.path, gitStatusLabel(f.status)])}
          />
        </SizerItem>
        <SizerItem flag={wxALL} border={5}>
          <StaticText label={_('Commit Message:')} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          <TextCtrl
            multiLine
            textAreaRef={messageRef}
            ariaLabel={_('Commit Message:')}
            value={message}
            onChange={setMessage}
          />
        </SizerItem>
        <SizerItem flag={wxALL} border={5}>
          <StaticText label={_('Author:')} />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <TextCtrl ariaLabel={_('Author:')} value={author} readOnly />
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons
        okLabel={_('Commit')}
        okDisabled={!okEnabled}
        onCancel={() => onResult(null)}
        onOk={() => {
          if (okEnabled) onResult(message);
        }}
      />
    </DialogShim>
  );
}
