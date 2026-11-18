// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * File > Clone Project from Repository...: "Clone Project from Git Repository", KiCad's title for
 * DIALOG_GIT_REPOSITORY in its clone role. Upstream asks for a URL and credentials; here the
 * credentials are the connected GitHub App, so the dialog offers what it can reach - the
 * repositories the App may use that hold a KiCad project, or all of them on request - and still
 * takes a link, for any public project on GitHub.
 *
 * A link opens that project read-only, as File > Open Project from GitHub... did before this
 * dialog took its place (`/gh/<owner>/<repo>` addresses still do): a public repository is not the
 * person's to commit to. A repository chosen from the list is cloned into the account, linked.
 */
import { useRef, useState, type JSX } from 'react';
import { HyperlinkCtrl, ListCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { type GithubSpec, githubSpecFromUrl } from '../home/github_id.js';
import type { GithubRepo } from './github_api.js';

/** What the list shows while it is being found out. */
export interface CloneRepoList {
  /** Every repository the App may use. */
  all: readonly GithubRepo[];
  /** Those found so far to hold a KiCad project. */
  kicad: readonly GithubRepo[];
  /** `listing`: asking GitHub for them; `scanning`: looking into each; then `ready` or `error`. */
  status: 'listing' | 'scanning' | 'ready' | 'error';
  done?: number;
  total?: number;
  error?: string;
}

export type CloneAnswer = { kind: 'link'; spec: GithubSpec } | { kind: 'repo'; repo: GithubRepo };

/** Notes wrap at the list's width, so the dialog is as wide as the list and no wider (ours). */
const WRAP = 420;

/** The status line under the list. */
export function cloneListStatus(aList: CloneRepoList, aShowAll: boolean): string {
  switch (aList.status) {
    case 'listing':
      return _('Asking GitHub for your repositories...');
    case 'scanning':
      return wxFormat(
        _('Looking for KiCad projects: %d of %d repositories...'),
        aList.done ?? 0,
        aList.total ?? aList.all.length,
      );
    case 'error':
      return aList.error ?? '';
    case 'ready':
      if (aList.all.length === 0) return _('ZiroEDA cannot use any of your repositories yet.');
      if (!aShowAll && aList.kicad.length === 0)
        return _('None of the repositories ZiroEDA can use holds a KiCad project.');
      return '';
  }
}

export function DialogCloneFromGithub({
  connected,
  list,
  onConnect,
  onChangeAccess,
  onResult,
}: {
  /** Whether GitHub is connected: without it the list is replaced by the way to connect. */
  connected: boolean;
  list: CloneRepoList | null;
  onConnect: () => void;
  onChangeAccess: () => void;
  onResult: (aAnswer: CloneAnswer | null) => void;
}): JSX.Element {
  const [link, setLink] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  const rows = list ? (showAll ? list.all : list.kicad) : [];
  const spec = link.trim() ? githubSpecFromUrl(link) : null;
  const repo = picked ? rows.find((r) => r.full_name === picked) : undefined;
  const finish = (): void => {
    if (link.trim()) {
      if (spec) onResult({ kind: 'link', spec });
    } else if (repo) onResult({ kind: 'repo', repo });
  };
  const status = list ? cloneListStatus(list, showAll) : '';

  return (
    <DialogShim
      title={_('Clone Project from Git Repository')}
      onClose={() => onResult(null)}
      initialFocus={linkRef}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              <StaticText label={_('GitHub link:')} />
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxALIGN_CENTER_VERTICAL | wxALL}
              border={5}
              minSize={[340, -1]}
            >
              <TextCtrl
                inputRef={linkRef}
                ariaLabel={_('GitHub link:')}
                hint="https://github.com/owner/repository"
                value={link}
                onChange={(v) => {
                  setLink(v);
                  if (v.trim()) setPicked(null);
                }}
                onEnter={finish}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxLEFT | wxRIGHT} border={10}>
          <StaticText
            wrap={WRAP}
            label={
              link.trim() && !spec
                ? _('That is not a link to a GitHub repository, folder or file.')
                : _('A link to any public repository, folder or file opens that project read-only.')
            }
          />
        </SizerItem>
        {connected ? (
          <>
            <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
              <StaticText
                label={
                  showAll
                    ? _('Or clone one of the repositories ZiroEDA can use:')
                    : _('Or clone one of your repositories that hold a KiCad project:')
                }
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
              <ListCtrl
                ariaLabel={_('Clone Project from Git Repository')}
                headers={[_('Repository'), _('Visibility')]}
                columnWidths={[320, 100]}
                rows={rows.map((r) => [r.full_name, r.private ? _('Private') : _('Public')])}
                selection={rows.findIndex((r) => r.full_name === picked)}
                onSelect={(i) => {
                  setPicked(rows[i]?.full_name ?? null);
                  setLink('');
                }}
                onActivate={(i) => {
                  const r = rows[i];
                  if (r) onResult({ kind: 'repo', repo: r });
                }}
              />
            </SizerItem>
            {status && (
              <SizerItem flag={wxLEFT | wxRIGHT} border={10}>
                <StaticText wrap={WRAP} label={status} />
              </SizerItem>
            )}
            <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
              <HyperlinkCtrl
                label={
                  showAll
                    ? _('Show only repositories with a KiCad project')
                    : _('Show all repositories')
                }
                onClick={() => setShowAll((v) => !v)}
              />
            </SizerItem>
            <SizerItem flag={wxALL} border={10}>
              <HyperlinkCtrl
                label={_('Change repository access on GitHub')}
                onClick={onChangeAccess}
              />
            </SizerItem>
          </>
        ) : (
          <>
            <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={10}>
              <StaticText
                wrap={WRAP}
                label={_(
                  'Connect GitHub to clone your own repositories, private ones included, into your account.',
                )}
              />
            </SizerItem>
            <SizerItem flag={wxALL} border={10}>
              <HyperlinkCtrl label={_('Connect GitHub...')} onClick={onConnect} />
            </SizerItem>
          </>
        )}
      </BoxSizer>
      <StdDialogButtons
        okLabel={link.trim() ? _('Open') : _('Clone')}
        okDisabled={link.trim() ? !spec : !repo}
        onCancel={() => onResult(null)}
        onOk={finish}
      />
    </DialogShim>
  );
}
