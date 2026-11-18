// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Version Control > Push to GitHub...: the repository to create for a project that has none, and
 * whether anyone may see it.
 *
 * Ours. Upstream's nearest is "Add Project to Version Control..." followed by "Configure Default
 * Remote..." (DIALOG_GIT_REPOSITORY), which asks for a URL and credentials for a repository that
 * already exists somewhere; here the account is already connected and the repository does not
 * exist yet, so the only questions are its name and Private / Public.
 */
import { useRef, useState, type JSX } from 'react';
import { RadioButton, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { isValidRepoName } from './github_project.js';

export interface PushToGithubAnswer {
  name: string;
  isPrivate: boolean;
}

export function DialogPushToGithub({
  defaultName,
  owner,
  onResult,
}: {
  defaultName: string;
  /** The connected account, which the repository is created under. */
  owner: string;
  onResult: (aAnswer: PushToGithubAnswer | null) => void;
}): JSX.Element {
  const [name, setName] = useState(defaultName);
  const [isPrivate, setPrivate] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = isValidRepoName(name.trim());
  const finish = (): void => {
    if (valid) onResult({ name: name.trim(), isPrivate });
  };

  return (
    <DialogShim title={_('Push to GitHub')} onClose={() => onResult(null)} initialFocus={nameRef}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              <StaticText label={_('Repository name:')} />
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxALIGN_CENTER_VERTICAL | wxALL}
              border={5}
              minSize={[300, -1]}
            >
              <TextCtrl
                inputRef={nameRef}
                ariaLabel={_('Repository name:')}
                value={name}
                onChange={setName}
                onEnter={finish}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
          <RadioButton
            label={_('Private')}
            name="ze-github-visibility"
            checked={isPrivate}
            onChange={() => setPrivate(true)}
          />
        </SizerItem>
        <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
          <RadioButton
            label={_('Public')}
            name="ze-github-visibility"
            checked={!isPrivate}
            onChange={() => setPrivate(false)}
          />
        </SizerItem>
        {/* The notes wrap at the name row's width - its label and the entry's 300 minimum - so
            a sentence is a paragraph under the row, not a line that widens the dialog (ours). */}
        <SizerItem flag={wxALL} border={10}>
          <StaticText
            wrap={420}
            label={wxFormat(
              _(
                'The repository is created under %s, and every file of the project is pushed to it as its first commit.',
              ),
              owner,
            )}
          />
        </SizerItem>
        {!valid && (
          <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={10}>
            <StaticText
              wrap={420}
              label={_(
                'A repository name may use letters, digits, ".", "-" and "_", and at most 100 of them.',
              )}
            />
          </SizerItem>
        )}
      </BoxSizer>
      <StdDialogButtons
        okLabel={_('Push')}
        okDisabled={!valid}
        onCancel={() => onResult(null)}
        onOk={finish}
      />
    </DialogShim>
  );
}
