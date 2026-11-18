// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The GitHub dialogs as drawn and clicked: Clone Project from Git Repository (the KiCad-only list,
 * Show all repositories, a pasted link, Connect GitHub...), Push to GitHub (a new or an existing
 * repository) and the notice whose button takes the step.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubRepo } from '@ziroeda/designer/src/github/github_api.js';
import {
  type CloneRepoList,
  DialogCloneFromGithub,
  cloneListStatus,
} from '@ziroeda/designer/src/github/dialog_clone_from_github.js';
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
const READY: CloneRepoList = { all: [AMP, FIRMWARE], kicad: [AMP], status: 'ready' };

const button = (label: string) => screen.getByRole('button', { name: label }) as HTMLButtonElement;

function clone(over: Partial<Parameters<typeof DialogCloneFromGithub>[0]> = {}) {
  const props = {
    connected: true,
    list: READY,
    onConnect: vi.fn(),
    onChangeAccess: vi.fn(),
    onResult: vi.fn(),
    ...over,
  };
  render(<DialogCloneFromGithub {...props} />);
  return props;
}

describe('Clone Project from Git Repository', () => {
  it('lists only the repositories that hold a KiCad project, until asked for all of them', () => {
    clone();
    expect(screen.queryByText('octo/amp')).not.toBeNull();
    expect(screen.queryByText('octo/firmware')).toBeNull();
    fireEvent.click(button('Show all repositories'));
    expect(screen.queryByText('octo/firmware')).not.toBeNull();
    fireEvent.click(button('Show only repositories with a KiCad project'));
    expect(screen.queryByText('octo/firmware')).toBeNull();
  });

  it('clones the repository chosen', () => {
    const p = clone();
    expect(button('Clone').disabled).toBe(true);
    fireEvent.click(screen.getByText('octo/amp'));
    fireEvent.click(button('Clone'));
    expect(p.onResult).toHaveBeenCalledWith({ kind: 'repo', repo: AMP });
  });

  it('takes a pasted link to any public project, which it opens rather than clones', () => {
    const p = clone();
    const entry = screen.getByLabelText('GitHub link:');
    fireEvent.change(entry, { target: { value: 'not a link' } });
    expect(button('Open').disabled).toBe(true);
    expect(
      screen.queryByText('That is not a link to a GitHub repository, folder or file.'),
    ).not.toBeNull();
    fireEvent.change(entry, {
      target: { value: 'https://github.com/someone/board/blob/main/hw/board.kicad_pcb' },
    });
    fireEvent.click(button('Open'));
    expect(p.onResult).toHaveBeenCalledWith({
      kind: 'link',
      spec: { owner: 'someone', repo: 'board', ref: 'main', path: 'hw/board.kicad_pcb' },
    });
  });

  it('not connected, it still takes a link, and offers Connect GitHub... instead of a list', () => {
    const p = clone({ connected: false, list: null });
    expect(screen.queryByText('octo/amp')).toBeNull();
    fireEvent.click(button('Connect GitHub...'));
    expect(p.onConnect).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('GitHub link:'), {
      target: { value: 'https://github.com/someone/board' },
    });
    fireEvent.click(button('Open'));
    expect(p.onResult).toHaveBeenCalledWith({
      kind: 'link',
      spec: { owner: 'someone', repo: 'board' },
    });
  });

  it('links to the access settings on GitHub', () => {
    const p = clone();
    fireEvent.click(button('Change repository access on GitHub'));
    expect(p.onChangeAccess).toHaveBeenCalledTimes(1);
  });

  it('says what it is doing, and why a list is empty', () => {
    expect(cloneListStatus({ all: [], kicad: [], status: 'listing' }, false)).toBe(
      'Asking GitHub for your repositories...',
    );
    expect(
      cloneListStatus(
        { all: [AMP, FIRMWARE], kicad: [], status: 'scanning', done: 1, total: 2 },
        false,
      ),
    ).toBe('Looking for KiCad projects: 1 of 2 repositories...');
    expect(cloneListStatus({ all: [], kicad: [], status: 'ready' }, false)).toBe(
      'ZiroEDA cannot use any of your repositories yet.',
    );
    expect(cloneListStatus({ all: [FIRMWARE], kicad: [], status: 'ready' }, false)).toBe(
      'None of the repositories ZiroEDA can use holds a KiCad project.',
    );
    expect(cloneListStatus({ all: [FIRMWARE], kicad: [], status: 'ready' }, true)).toBe('');
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
