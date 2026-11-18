// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The project tree's Version Control submenu as drawn: a flyout off the popup (the shared menu's
 * own), whose rows reach the host by id, and whose greyed rows reach nothing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectTreePane } from '@ziroeda/designer/src/home/project_tree_pane.js';
import type { VcsMenuState } from '@ziroeda/designer/src/home/project_tree_menu.js';

afterEach(cleanup);

function pane(on: {
  versionControl?: VcsMenuState | null;
  onVersionControl?: (id: string, branch?: string) => void;
}) {
  return render(
    <ProjectTreePane
      picked={[{ name: 'proj.kicad_pro', text: '{}' }]}
      dirRoot={null}
      rootLabel="proj.kicad_pro"
      projectNames={new Set(['proj'])}
      width={250}
      expanded={new Set()}
      onToggleDir={() => {}}
      selected={new Set()}
      onSelect={() => {}}
      rootOpen
      onToggleRoot={() => {}}
      {...on}
    />,
  );
}

const LINKED: VcsMenuState = {
  enableGit: true,
  connected: true,
  linked: true,
  branch: 'main',
  upstream: 'origin/main',
  branches: ['main', 'rev-b'],
};

describe('the Version Control submenu', () => {
  it('runs the row chosen, by id - and a quick branch row with its branch', () => {
    const run = vi.fn();
    pane({ versionControl: LINKED, onVersionControl: run });
    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    fireEvent.mouseEnter(screen.getByText('Version Control'));
    fireEvent.click(screen.getByText('Commit Project...'));
    expect(run).toHaveBeenCalledWith('gitCommitProject', undefined);

    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    fireEvent.mouseEnter(screen.getByText('Version Control'));
    fireEvent.mouseEnter(screen.getByText('Switch to Branch'));
    fireEvent.click(screen.getByText('rev-b'));
    expect(run).toHaveBeenLastCalledWith('gitSwitchBranch', 'rev-b');
  });

  it('draws a greyed row greyed, and choosing it does nothing', () => {
    const run = vi.fn();
    pane({
      versionControl: { enableGit: true, connected: true, linked: false },
      onVersionControl: run,
    });
    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    fireEvent.mouseEnter(screen.getByText('Version Control'));
    const commit = screen.getByText('Commit Project...').closest('.ze-mitem')!;
    expect(commit.classList.contains('disabled')).toBe(true);
    fireEvent.click(commit);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Push to GitHub...'));
    expect(run).toHaveBeenCalledWith('pushToGithub', undefined);
  });

  it('is not drawn where the host gives it nothing to run', () => {
    pane({ versionControl: LINKED });
    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    expect(screen.queryByText('Version Control')).toBeNull();
  });
});
