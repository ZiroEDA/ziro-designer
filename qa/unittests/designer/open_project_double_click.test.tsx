// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * File > Open Project: double-clicking a project opens it.
 *
 * Reported: every project read as a folder you had to walk into and then pick its .kicad_pro,
 * where a project list (EasyEDA's, the account's own) opens the project you pick. The chooser
 * already knows a project folder from a plain one (`kind: 'project'`) and a place can say its
 * projects open rather than being entered (ChooserPlace.activateOpens); the Open Project window
 * now says so for every place it shows. An editor's Open, which is looking for a file, still walks in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileChooser } from '@ziroeda/designer/src/fs/FileChooser.js';
import type { ChooserPlace } from '@ziroeda/designer/src/fs/chooser_types.js';
import { listFileSystem } from '@ziroeda/designer/src/fs/list_fs.js';

afterEach(cleanup);

const fs = listFileSystem(async () => ({
  files: [
    { name: 'blinky/blinky.kicad_pro', size: 10, modified: 0 },
    { name: 'blinky/blinky.kicad_sch', size: 10, modified: 0 },
  ],
  projects: new Set(['/blinky']),
}));

function chooser(aActivateOpens: boolean, onAccept: (p: string) => void) {
  const places: ChooserPlace[] = [
    { id: 'projects', label: 'Projects', icon: 'open_project', activateOpens: aActivateOpens },
  ];
  return render(
    <FileChooser
      fs={fs}
      mode="open"
      title="Open Existing Project"
      accept="Open"
      places={places}
      initialPlace="projects"
      onAccept={onAccept}
      onCancel={() => {}}
    />,
  );
}

describe('double-clicking a project in the chooser', () => {
  it('opens it where the place says projects open', async () => {
    const onAccept = vi.fn();
    chooser(true, onAccept);
    fireEvent.doubleClick(await screen.findByText('blinky'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0]).toBe('/blinky');
  });

  it('walks into it everywhere else: its files are listed, nothing is opened', async () => {
    const onAccept = vi.fn();
    chooser(false, onAccept);
    fireEvent.doubleClick(await screen.findByText('blinky'));
    expect(await screen.findByText('blinky.kicad_pro')).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe('the Open Existing Project window', () => {
  const HOME = readFileSync(join(__dirname, '../../../designer/src/home/HomePage.tsx'), 'utf8');

  it('shows places whose projects open', () => {
    const at = HOME.indexOf("title={_('Open Existing Project')}");
    const chooserTag = HOME.slice(HOME.lastIndexOf('<FileChooser', at), at + 200);
    expect(chooserTag).toMatch(/places=\{openProjectPlaces\}/);
    expect(HOME).toMatch(
      /const openProjectPlaces = useMemo<readonly ChooserPlace\[\]>\(\s*\(\) => chooserPlaces\.map\(\(p\) => \(\{ \.\.\.p, activateOpens: true \}\)\),/,
    );
  });
});
