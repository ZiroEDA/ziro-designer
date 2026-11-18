// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GIT_SWITCH` (common/dialogs/git/dialog_git_switch.cpp), "Git Branch Switch": Switch to
 * Branch > Other.... The sizer tree is the constructor's:
 *
 *     sizer->Add( explanationText, 0, wxALL, 10 );
 *     sizer->Add( m_branchList, 1, wxALL | wxEXPAND, 10 );
 *     sizer->Add( m_branchNameText, 0, wxALL | wxEXPAND, 10 );
 *     sizer->Add( buttonSizer, 0, wxALIGN_RIGHT | wxALL, 10 );
 *
 * The behaviour is its handlers': the current branch is marked `* ` and selected, with its name in
 * the entry; choosing a row puts its name there; the button reads "Switch" for a branch that
 * exists - disabled on the current one - and "Add" for a name that does not (`OnTimer`), and a
 * double click switches straight away (`OnBranchListDClick`).
 *
 * The list has the Branch column only. "Last Commit" and "Last Updated" are read from the local
 * repository's commits upstream; GitHub's branch listing carries a commit id and nothing else, and
 * a request per branch to fill two columns is not worth the wait.
 */
import { useRef, useState, type JSX } from 'react';
import { ListCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { wxALL, wxEXPAND, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { _ } from '@ziroeda/wx/translation.js';
import { DialogShim, StdDialogButtons } from '../../dialog_shim.js';

/** `wxID_OK` (switch to an existing branch) or `wxID_ADD` (create it first). */
export interface GitSwitchResult {
  branch: string;
  add: boolean;
}

/** The button's label and state for what the entry holds (`OnTimer`, `OnBranchListSelection`). */
export function gitSwitchButton(
  aName: string,
  aBranches: readonly string[],
  aCurrent: string,
): { add: boolean; enabled: boolean } {
  if (aBranches.includes(aName)) return { add: false, enabled: aName !== aCurrent };
  return { add: true, enabled: aName.trim() !== '' };
}

export function DIALOG_GIT_SWITCH({
  branches,
  current,
  onResult,
}: {
  /** `m_branches`' names. */
  branches: readonly string[];
  /** `m_currentBranch`. */
  current: string;
  onResult: (aResult: GitSwitchResult | null) => void;
}): JSX.Element {
  const [name, setName] = useState(current);
  const textRef = useRef<HTMLInputElement>(null);
  const button = gitSwitchButton(name, branches, current);
  const finish = (aName: string): void => {
    const b = gitSwitchButton(aName, branches, current);
    if (b.enabled) onResult({ branch: aName, add: b.add });
  };

  return (
    <DialogShim
      title={_('Git Branch Switch')}
      onClose={() => onResult(null)}
      initialFocus={textRef}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL} border={10}>
          <StaticText label={_('Select or enter a branch name:')} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          <ListCtrl
            ariaLabel={_('Branch')}
            headers={[_('Branch')]}
            columnWidths={[380]}
            // `( name == m_currentBranch ? "* " : "  " ) + name`.
            rows={branches.map((b) => [(b === current ? '* ' : '  ') + b])}
            selection={branches.indexOf(name)}
            onSelect={(i) => setName(branches[i] ?? name)}
            onActivate={(i) => {
              const b = branches[i];
              if (b === undefined) return;
              setName(b);
              if (b !== current) onResult({ branch: b, add: false });
            }}
          />
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={10}>
          <TextCtrl
            inputRef={textRef}
            ariaLabel={_('Select or enter a branch name:')}
            value={name}
            onChange={setName}
            onEnter={() => finish(name)}
          />
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons
        okLabel={button.add ? _('Add') : _('Switch')}
        okDisabled={!button.enabled}
        onCancel={() => onResult(null)}
        onOk={() => finish(name)}
      />
    </DialogShim>
  );
}
