// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The GitHub dialogs as drawn and clicked: Open Project from GitHub (its three states - not
 * connected, connected with the person's projects listed, a pasted link), Push to GitHub (a new or
 * an existing repository) and the notice whose button takes the step.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubRepo } from '@ziroeda/designer/src/github/github_api.js';
import {
  DialogOpenFromGithub,
  type GithubRepoList,
  projectRows,
  repoListStatus,
} from '@ziroeda/designer/src/github/dialog_open_from_github.js';
import { DialogPushToGithub } from '@ziroeda/designer/src/github/dialog_push_to_github.js';
import { DialogGithubNotice } from '@ziroeda/designer/src/github/dialog_github_notice.js';

afterEach(cleanup);

const repo = (name: string, isPrivate = true): GithubRepo => ({
  name,
  full_name: `octo/${name}`,
  owner: { login: 'octo' },
  private: isPrivate,
  default_branch: 'main',
});
const AMP = repo('amp');
const FIRMWARE = repo('firmware', false);
const BOARDS = repo('pcb-projects');
const HUGE = repo('huge');
const READY: GithubRepoList = {
  all: [AMP, FIRMWARE, BOARDS, HUGE],
  found: [
    { repo: AMP, projects: ['amp.kicad_pro'] },
    { repo: BOARDS, projects: ['amp/amp.kicad_pro', 'psu/psu.kicad_pro'] },
    { repo: HUGE, projects: null },
  ],
  status: 'ready',
};

const button = (label: string) => screen.getByRole('button', { name: label }) as HTMLButtonElement;
const cell = (text: string) =>
  screen.getByText((_c, el) => el?.textContent?.trim() === text && el.tagName === 'SPAN');

function open(over: Partial<Parameters<typeof DialogOpenFromGithub>[0]> = {}) {
  const props = {
    connected: true,
    list: READY,
    onConnect: vi.fn(),
    onChangeAccess: vi.fn(),
    onResult: vi.fn(),
    ...over,
  };
  render(<DialogOpenFromGithub {...props} />);
  return props;
}

describe('Open Project from GitHub: a pasted link', () => {
  it("keeps the dialog's caption, label and notes, and OK opens what was pasted", () => {
    const p = open({ connected: false, list: null });
    expect(screen.queryByText('Open Project from GitHub')).not.toBeNull();
    expect(
      screen.queryByText(
        'The repository must be public. Projects open read-only; "Save a copy" keeps one of your own.',
      ),
    ).not.toBeNull();
    fireEvent.change(screen.getByLabelText('GitHub link:'), {
      target: { value: 'https://github.com/someone/board/tree/main/hw' },
    });
    fireEvent.click(button('OK'));
    expect(p.onResult).toHaveBeenCalledWith({
      kind: 'link',
      text: 'https://github.com/someone/board/tree/main/hw',
    });
  });

  it('a link typed after choosing a project is what OK opens', () => {
    const p = open();
    fireEvent.click(cell('octo/amp'));
    fireEvent.change(screen.getByLabelText('GitHub link:'), {
      target: { value: 'https://github.com/someone/board' },
    });
    fireEvent.click(button('OK'));
    expect(p.onResult).toHaveBeenCalledWith({
      kind: 'link',
      text: 'https://github.com/someone/board',
    });
  });
});

describe('Open Project from GitHub: not connected', () => {
  it('offers the connection in place of a list', () => {
    const p = open({ connected: false, list: null });
    expect(
      screen.queryByText('Open your private repositories: connect your GitHub account.'),
    ).not.toBeNull();
    expect(screen.queryByText('octo/amp')).toBeNull();
    fireEvent.click(button('Connect GitHub...'));
    expect(p.onConnect).toHaveBeenCalledTimes(1);
  });
});

describe('Open Project from GitHub: connected', () => {
  it('lists the projects under their repositories, and nothing that holds none', () => {
    open();
    expect(screen.queryByText('octo/firmware')).toBeNull();
    // No "Show all repositories": a repository without a project is not offered at all.
    expect(screen.queryByRole('button', { name: 'Show all repositories' })).toBeNull();
    for (const t of [
      'octo/amp',
      'octo/pcb-projects',
      'amp/amp.kicad_pro',
      'psu/psu.kicad_pro',
      'octo/huge',
    ])
      expect(cell(t), t).not.toBeNull();
  });

  it('opens the project chosen, with its path in the repository', () => {
    const p = open();
    fireEvent.click(cell('psu/psu.kicad_pro'));
    fireEvent.click(button('OK'));
    expect(p.onResult).toHaveBeenCalledWith({
      kind: 'repo',
      repo: BOARDS,
      project: 'psu/psu.kicad_pro',
    });
  });

  it("a repository's own row heads its projects and is not one to open", () => {
    const p = open();
    fireEvent.click(cell('octo/pcb-projects'));
    fireEvent.click(button('OK'));
    expect(p.onResult).toHaveBeenCalledWith({ kind: 'link', text: '' });
  });

  it('a repository GitHub would not list opens with its project asked for then', () => {
    const p = open();
    fireEvent.click(cell('octo/huge'));
    fireEvent.click(button('OK'));
    expect(p.onResult).toHaveBeenCalledWith({ kind: 'repo', repo: HUGE });
  });

  it('links to the access settings on GitHub', () => {
    const p = open();
    fireEvent.click(button('Change repository access on GitHub'));
    expect(p.onChangeAccess).toHaveBeenCalledTimes(1);
  });

  it('rows: one row for a lone project at the root, a group for a repository of folders', () => {
    const rows = projectRows(READY.found);
    expect(rows.map((r) => [r.label.trim(), r.group, r.project ?? null])).toEqual([
      ['octo/amp', false, 'amp.kicad_pro'],
      ['octo/pcb-projects', true, null],
      ['amp/amp.kicad_pro', false, 'amp/amp.kicad_pro'],
      ['psu/psu.kicad_pro', false, 'psu/psu.kicad_pro'],
      ['octo/huge', false, null],
    ]);
  });

  it('says what it is doing, and why a list is empty', () => {
    expect(repoListStatus({ all: [], found: [], status: 'listing' })).toBe(
      'Asking GitHub for your repositories...',
    );
    expect(
      repoListStatus({ all: [AMP, FIRMWARE], found: [], status: 'scanning', done: 1, total: 2 }),
    ).toBe('Looking for KiCad projects: 1 of 2 repositories...');
    expect(repoListStatus({ all: [], found: [], status: 'ready' })).toBe(
      'ZiroEDA cannot use any of your repositories yet.',
    );
    expect(repoListStatus({ all: [FIRMWARE], found: [], status: 'ready' })).toBe(
      'None of the repositories ZiroEDA can use holds a KiCad project.',
    );
  });
});

describe('Push to GitHub', () => {
  function push() {
    const props = {
      defaultName: 'amp',
      owner: 'octo',
      repos: [AMP, FIRMWARE],
      onChangeAccess: vi.fn(),
      onResult: vi.fn(),
    };
    render(<DialogPushToGithub {...props} />);
    return props;
  }

  it('creates a new repository by default, private', () => {
    const p = push();
    fireEvent.click(button('Push'));
    expect(p.onResult).toHaveBeenCalledWith({ kind: 'new', name: 'amp', isPrivate: true });
  });

  it('pushes into an existing repository chosen from the list', () => {
    const p = push();
    fireEvent.click(screen.getByText('octo/firmware'));
    fireEvent.click(button('Push'));
    expect(p.onResult).toHaveBeenCalledWith({ kind: 'existing', repo: FIRMWARE });
  });

  it('wants a repository chosen before it pushes into an existing one', () => {
    push();
    fireEvent.click(screen.getByLabelText('Use an existing repository', { selector: 'input' }));
    expect(button('Push').disabled).toBe(true);
  });
});

describe('a notice whose button takes the step', () => {
  it('runs the step from the click, and closes', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <DialogGithubNotice
        caption="Connect GitHub"
        message="ZiroEDA is not installed on your account yet."
        action={{ label: 'Install on GitHub...', run }}
        onClose={onClose}
      />,
    );
    fireEvent.click(button('Install on GitHub...'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
