// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A linked project in the project tree, as KiCad draws a project in a repository: the root reads
 * `name.kicad_pro [branch]`, and each file carries its Git state image left of its icon
 * (`PROJECT_TREE_PANE::updateGitStatusIcons`). A project that is not linked shows neither.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectTreePane } from '@ziroeda/designer/src/home/project_tree_pane.js';
import { buildDirTree } from '@ziroeda/designer/src/home/project_tree.js';
import type { GitFileStatus } from '@ziroeda/designer/src/github/git_status.js';
import { svgUrl } from '@ziroeda/bitmaps_png';

afterEach(cleanup);

const FILES = [
  { name: 'amp.kicad_pro', text: '{}' },
  { name: 'amp.kicad_sch', text: '' },
  { name: 'amp.kicad_pcb', text: '' },
  { name: 'notes.txt', text: '' },
];

function pane(gitBranch: string | null, gitStatus: ReadonlyMap<string, GitFileStatus> | null) {
  return render(
    <ProjectTreePane
      picked={FILES}
      dirRoot={buildDirTree(FILES, '', 'amp')}
      rootLabel="amp.kicad_pro"
      projectNames={new Set(['amp'])}
      width={250}
      expanded={new Set()}
      onToggleDir={() => {}}
      selected={new Set()}
      onSelect={() => {}}
      rootOpen
      onToggleRoot={() => {}}
      gitBranch={gitBranch}
      gitStatus={gitStatus}
    />,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('.ze-tree-item')!;

describe('a linked project in the tree', () => {
  it('names its branch after the project', () => {
    pane('rev-b', new Map());
    expect(screen.queryByText('amp.kicad_pro [rev-b]')).not.toBeNull();
  });

  it("draws each file's state image before its icon", () => {
    pane(
      'main',
      new Map<string, GitFileStatus>([
        ['amp.kicad_sch', 'MODIFIED'],
        ['amp.kicad_pcb', 'BEHIND'],
        ['notes.txt', 'CURRENT'],
      ]),
    );
    const state = (name: string) => rowOf(name).querySelector('.ze-tree-state') as HTMLImageElement;
    expect(state('amp.kicad_sch').getAttribute('alt')).toBe('MODIFIED');
    expect(state('amp.kicad_sch').getAttribute('src')).toBe(svgUrl('manager', 'git_modified'));
    expect(state('amp.kicad_pcb').getAttribute('src')).toBe(svgUrl('manager', 'git_out_of_date'));
    expect(state('notes.txt').getAttribute('src')).toBe(svgUrl('manager', 'git_good_check'));
    // Left of the file's own icon.
    const kids = [...rowOf('notes.txt').children];
    expect(kids.indexOf(state('notes.txt'))).toBeLessThan(
      kids.findIndex((k) => k.tagName === 'IMG' && !k.classList.contains('ze-tree-state')),
    );
  });
});

describe('a project that is not linked', () => {
  it('has no branch and no state images', () => {
    pane(null, null);
    expect(screen.queryByText('amp.kicad_pro')).not.toBeNull();
    expect(document.querySelector('.ze-tree-state')).toBeNull();
  });
});
