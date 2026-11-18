// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * File > Open Project from GitHub... (#640): a link to any public GitHub project, opened read-only
 * as before, and - below it - the person's own repositories, once their GitHub is connected.
 *
 * The link half is the dialog this row always had, kept as it was: WX_TEXT_ENTRY_DIALOG's sizer
 * tree (`m_ContentSizer` wxALL 5; the label wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5; the entry
 * wxEXPAND|wxALL 5 at 700 wide, `aExtraWidth`; each note a bulleted item under it) with the same
 * caption, label, hint and notes. OK opens what was pasted, and an address that is no GitHub link
 * is told so afterwards, as it was.
 *
 * The second half is ours. Not connected, it offers the connection. Connected, it lists the KiCad
 * projects on the default branch of each repository the ZiroEDA GitHub App may use, under their
 * repository; one chosen there opens as the person's own project, linked to its repository and its
 * folder in it, so Commit and Pull work from the project tree's Version Control menu. A project on
 * another branch is reached through the link, which takes a branch's address.
 */
import { useRef, useState, type JSX } from 'react';
import {
  Button,
  HyperlinkCtrl,
  ListCtrl,
  StaticLine,
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
import type { RepoProjects } from './github_project.js';

/** What the repository list shows while it is being found out. */
export interface GithubRepoList {
  /** Every repository the App may use. */
  all: readonly GithubRepo[];
  /** Those found so far to hold a KiCad project, with their projects. */
  found: readonly RepoProjects[];
  /** `listing`: asking GitHub for them; `scanning`: looking into each; then `ready` or `error`. */
  status: 'listing' | 'scanning' | 'ready' | 'error';
  done?: number;
  total?: number;
  error?: string;
}

/**
 * A pasted link (opened read-only), or one of the person's projects (opened linked): its
 * repository and the project's path in it - absent for a repository GitHub would not list, whose
 * project is asked for once it is opened.
 */
export type OpenFromGithubAnswer =
  | { kind: 'link'; text: string }
  | { kind: 'repo'; repo: GithubRepo; project?: string };

/** One row of the list: a repository heading its projects, or a project that can be opened. */
export interface ProjectRow {
  key: string;
  label: string;
  visibility: string;
  /** A repository's own row over its projects: drawn bold, and not something to open. */
  group: boolean;
  repo: GithubRepo;
  project?: string;
}

/** A project row's indent under its repository: the list is one column of text (data). */
const INDENT = '\u00a0\u00a0\u00a0\u00a0';

/**
 * The list's rows: each repository with its projects under it, by path. A repository holding one
 * project, at its root, is that project's row by itself; one GitHub would not list is a row by
 * itself too, whose project is asked for when it is opened.
 */
export function projectRows(aFound: readonly RepoProjects[]): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const { repo, projects } of aFound) {
    const visibility = repo.private ? _('Private') : _('Public');
    const only = projects?.length === 1 && !projects[0]!.includes('/') ? projects[0] : undefined;
    if (projects === null || only !== undefined) {
      rows.push({
        key: repo.full_name,
        label: repo.full_name,
        visibility,
        group: false,
        repo,
        ...(only === undefined ? {} : { project: only }),
      });
      continue;
    }
    rows.push({ key: `${repo.full_name}/`, label: repo.full_name, visibility, group: true, repo });
    for (const project of projects)
      rows.push({
        key: `${repo.full_name}/${project}`,
        label: INDENT + project,
        visibility: '',
        group: false,
        repo,
        project,
      });
  }
  return rows;
}

/** `aExtraWidth`: the entry's minimum, and what the label and the notes wrap at. */
const EXTRA_WIDTH = 700;

/**
 * What to paste for what you want, for someone who has never done it: the address bar's link
 * while looking at the thing on GitHub, in each case. The dialog's own notes, unchanged.
 */
const LINK_NOTES = [
  'A whole repository: paste its main page, github.com/owner/repository. If it holds several KiCad projects, you choose one.',
  'One project in a repository: open the folder on GitHub that holds its .kicad_pro, and paste that link.',
  'A schematic or a board: open the .kicad_sch or .kicad_pcb file on GitHub and paste its link. Its project opens in that editor.',
  'Another branch or tag: switch to it on GitHub first, then copy the link.',
  'The repository must be public. Projects open read-only; "Save a copy" keeps one of your own.',
];

/** The status line under the list. */
export function repoListStatus(aList: GithubRepoList): string {
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
      if (aList.found.length === 0)
        return _('None of the repositories ZiroEDA can use holds a KiCad project.');
      return '';
  }
}

export function DialogOpenFromGithub({
  connected,
  list,
  onConnect,
  onChangeAccess,
  onResult,
}: {
  /** Whether GitHub is connected: without it the list is replaced by the way to connect. */
  connected: boolean;
  list: GithubRepoList | null;
  /** Connect GitHub...: from the click itself, which GitHub's window has to open from. */
  onConnect: () => void;
  onChangeAccess: () => void;
  /** The link, or the repository chosen, on wxID_OK; null on wxID_CANCEL. */
  onResult: (aAnswer: OpenFromGithubAnswer | null) => void;
}): JSX.Element {
  const [link, setLink] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  const rows = projectRows(list ? list.found : []);
  const row = picked ? rows.find((r) => r.key === picked) : undefined;
  const open = (r: ProjectRow): void =>
    onResult({ kind: 'repo', repo: r.repo, ...(r.project ? { project: r.project } : {}) });
  // The project chosen in the list (typing a link drops the choice); else the link, which OK
  // always took.
  const finish = (): void => {
    if (row) open(row);
    else onResult({ kind: 'link', text: link });
  };
  const status = list ? repoListStatus(list) : '';

  return (
    <DialogShim
      title={_('Open Project from GitHub')}
      onClose={() => onResult(null)}
      initialFocus={linkRef}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('GitHub link:')} wrap={EXTRA_WIDTH} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[EXTRA_WIDTH, -1]}>
              <TextCtrl
                inputRef={linkRef}
                ariaLabel={_('GitHub link:')}
                hint="https://github.com/owner/repository"
                value={link}
                onChange={(v) => {
                  setLink(v);
                  if (v.trim()) setPicked(null);
                }}
              />
            </SizerItem>
            {LINK_NOTES.map((note) => (
              <SizerItem key={note} flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxRIGHT} border={5}>
                    <StaticText label={'•'} />
                  </SizerItem>
                  <SizerItem proportion={1}>
                    <StaticText label={note} wrap={EXTRA_WIDTH} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            ))}

            {/* Ours: the person's own repositories, through the ZiroEDA GitHub App. */}
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StaticLine />
            </SizerItem>
            {connected ? (
              <>
                <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Your repositories with a KiCad project:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                  <ListCtrl
                    ariaLabel={_('Your repositories with a KiCad project:')}
                    headers={[_('Project'), _('Visibility')]}
                    columnWidths={[EXTRA_WIDTH - 120, 120]}
                    rows={rows.map((r) => [r.label, r.visibility])}
                    boldRows={rows.flatMap((r, i) => (r.group ? [i] : []))}
                    selection={rows.findIndex((r) => r.key === picked)}
                    onSelect={(i) => {
                      const r = rows[i];
                      // A repository's own row heads its projects; it is not one to open.
                      if (!r || r.group) return;
                      setPicked(r.key);
                      setLink('');
                    }}
                    onActivate={(i) => {
                      const r = rows[i];
                      if (r && !r.group) open(r);
                    }}
                  />
                </SizerItem>
                {status && (
                  <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                    <StaticText wrap={EXTRA_WIDTH} label={status} />
                  </SizerItem>
                )}
                <SizerItem flag={wxALL} border={5}>
                  <HyperlinkCtrl
                    label={_('Change repository access on GitHub')}
                    onClick={onChangeAccess}
                  />
                </SizerItem>
              </>
            ) : (
              <SizerItem flag={wxEXPAND | wxALL} border={5}>
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
                    <StaticText
                      label={_('Open your private repositories: connect your GitHub account.')}
                    />
                  </SizerItem>
                  <SizerItem flag={wxALIGN_CENTER_VERTICAL}>
                    <Button label={_('Connect GitHub...')} onClick={() => onConnect()} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            )}
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons onCancel={() => onResult(null)} onOk={finish} />
    </DialogShim>
  );
}
