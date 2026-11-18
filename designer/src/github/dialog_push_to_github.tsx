// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Version Control > Push to GitHub...: where a project with no repository goes - a new
 * repository (its name, Private / Public), or an existing EMPTY one among those the ZiroEDA
 * GitHub App may use.
 *
 * Ours. Upstream's nearest is "Add Project to Version Control..." followed by "Configure Default
 * Remote..." (DIALOG_GIT_REPOSITORY), which asks for a URL and credentials for a repository that
 * already exists somewhere; here the account is connected already, so the questions are which
 * repository and, for a new one, its name and who may see it. The App sees only the repositories
 * its installation covers, so the link to change that on GitHub sits under the list.
 */
import { useRef, useState, type JSX } from 'react';
import {
  HyperlinkCtrl,
  ListCtrl,
  RadioButton,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
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
import type { GithubRepo } from './github_api.js';
import { isValidRepoName } from './github_project.js';

export type PushToGithubAnswer =
  | { kind: 'new'; name: string; isPrivate: boolean }
  | { kind: 'existing'; repo: GithubRepo };

/** How far a radio button's own controls sit in from it: its box and the gap after it (ours). */
const UNDER_RADIO = 25;
/** Notes wrap at the name row's width, so a sentence does not widen the dialog (ours). */
const NOTE_WRAP = 420;

export function DialogPushToGithub({
  defaultName,
  owner,
  repos,
  onChangeAccess,
  onResult,
}: {
  defaultName: string;
  /** The connected account, which a new repository is created under. */
  owner: string;
  /** The repositories the App may use, for "Use an existing repository". */
  repos: readonly GithubRepo[];
  /** "Change repository access on GitHub": the installation's page. */
  onChangeAccess: () => void;
  onResult: (aAnswer: PushToGithubAnswer | null) => void;
}): JSX.Element {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState(defaultName);
  const [isPrivate, setPrivate] = useState(true);
  const [picked, setPicked] = useState(-1);
  const nameRef = useRef<HTMLInputElement>(null);
  const validName = isValidRepoName(name.trim());
  const ok = mode === 'new' ? validName : picked >= 0 && picked < repos.length;
  const finish = (): void => {
    if (!ok) return;
    if (mode === 'new') onResult({ kind: 'new', name: name.trim(), isPrivate });
    else onResult({ kind: 'existing', repo: repos[picked]! });
  };

  return (
    <DialogShim title={_('Push to GitHub')} onClose={() => onResult(null)} initialFocus={nameRef}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
          <RadioButton
            label={_('Create a new repository')}
            name="ze-github-push-mode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxLEFT} border={UNDER_RADIO}>
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
                    disabled={mode !== 'new'}
                    onChange={setName}
                    onEnter={finish}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxLEFT | wxTOP} border={UNDER_RADIO}>
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxRIGHT} border={15}>
                  <RadioButton
                    label={_('Private')}
                    name="ze-github-visibility"
                    checked={isPrivate}
                    disabled={mode !== 'new'}
                    onChange={() => setPrivate(true)}
                  />
                </SizerItem>
                <SizerItem>
                  <RadioButton
                    label={_('Public')}
                    name="ze-github-visibility"
                    checked={!isPrivate}
                    disabled={mode !== 'new'}
                    onChange={() => setPrivate(false)}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxLEFT | wxTOP} border={UNDER_RADIO}>
              <StaticText
                wrap={NOTE_WRAP}
                label={
                  mode === 'new' && !validName
                    ? _(
                        'A repository name may use letters, digits, ".", "-" and "_", and at most 100 of them.',
                      )
                    : wxFormat(_('The repository is created under %s.'), owner)
                }
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
          <RadioButton
            label={_('Use an existing repository')}
            name="ze-github-push-mode"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
          />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxTOP} border={UNDER_RADIO}>
              {repos.length > 0 ? (
                <ListCtrl
                  ariaLabel={_('Use an existing repository')}
                  headers={[_('Repository'), _('Visibility')]}
                  columnWidths={[300, 100]}
                  rows={repos.map((r) => [r.full_name, r.private ? _('Private') : _('Public')])}
                  selection={mode === 'existing' ? picked : -1}
                  onSelect={(i) => {
                    setMode('existing');
                    setPicked(i);
                  }}
                  onActivate={(i) => onResult({ kind: 'existing', repo: repos[i]! })}
                />
              ) : (
                <StaticText
                  wrap={NOTE_WRAP}
                  label={_('ZiroEDA cannot use any of your repositories yet.')}
                />
              )}
            </SizerItem>
            <SizerItem flag={wxLEFT | wxTOP} border={UNDER_RADIO}>
              <StaticText
                wrap={NOTE_WRAP}
                label={_(
                  'Only an empty repository can take the project; one that has commits is cloned instead.',
                )}
              />
            </SizerItem>
            <SizerItem flag={wxLEFT | wxTOP} border={UNDER_RADIO}>
              <HyperlinkCtrl
                label={_('Change repository access on GitHub')}
                onClick={onChangeAccess}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL} border={10}>
          <StaticText
            wrap={NOTE_WRAP}
            label={_('Every file of the project is pushed to it as its first commit.')}
          />
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons
        okLabel={_('Push')}
        okDisabled={!ok}
        onCancel={() => onResult(null)}
        onOk={finish}
      />
    </DialogShim>
  );
}
