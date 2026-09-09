// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * No file dialog lists the account's shared folders at its root.
 *
 * Templates, Symbols, Footprints and 3D Models are folders of the one account
 * tree, siblings of the projects, because that tree is this app's file manager.
 * In a FILE DIALOG they are four rows that look exactly like a project and can
 * never be one: Open Existing Project refuses to accept a `folder`, and an
 * editor's Open or Save As already carries the shared folder for its OWN kind
 * as a sidebar row — which is where that folder is meant to be reached from. A
 * user asked why a window offering to save a project was showing him 3D Models.
 *
 * `projectsOnlyFileSystem` is unit-tested next door in `open_project_listing`.
 * What this file pins is that the DIALOGS wrap their tree in it — the wiring,
 * not the wrapper, because the wrapper existed and only one window used it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Entry, FileSystem } from '@ziroeda/designer/src/fs/filesystem.js';

/** The account root as the store hands it back: the four, and two projects. */
const ROOT: Entry[] = [
  { name: '3D Models', path: '/3D Models', kind: 'folder', size: null, modified: 0 },
  { name: 'Footprints', path: '/Footprints', kind: 'folder', size: null, modified: 0 },
  { name: 'Symbols', path: '/Symbols', kind: 'folder', size: null, modified: 0 },
  { name: 'Templates', path: '/Templates', kind: 'folder', size: null, modified: 0 },
  { name: 'ACtoDCconverter', path: '/ACtoDCconverter', kind: 'project', size: null, modified: 0 },
  { name: 'demo', path: '/demo', kind: 'project', size: null, modified: 0 },
];

const fakeStore = (): FileSystem => ({
  async list(dir: string) {
    return dir === '/' ? ROOT : [];
  },
  async stat() {
    return null;
  },
  async read() {
    return new Uint8Array();
  },
  async write() {},
  async mkdir() {},
  async mkproject() {},
  async rename() {},
  async remove() {},
});

vi.mock('@ziroeda/designer/src/fs/project_store_fs.js', () => ({
  projectStoreFileSystem: () => fakeStore(),
}));

const { OpenFileDialog } = await import('@ziroeda/designer/src/fs/OpenFileDialog.js');
const { SaveAsDialog } = await import('@ziroeda/designer/src/fs/SaveAsDialog.js');

afterEach(cleanup);

/** Every row the listing drew, by name. */
const rows = async (): Promise<string[]> => {
  // The listing is loaded in an effect, so the projects are what to wait for.
  await screen.findByText('ACtoDCconverter');
  return ROOT.map((e) => e.name).filter((n) => screen.queryAllByText(n).length > 0);
};

describe('the root of a file dialog', () => {
  it('shows the projects and not the shared folders, opening', async () => {
    render(<OpenFileDialog onDone={() => {}} />);
    expect(await rows()).toStrictEqual(['ACtoDCconverter', 'demo']);
  });

  it('shows the projects and not the shared folders, saving', async () => {
    render(<SaveAsDialog initialName="" onDone={() => {}} />);
    expect(await rows()).toStrictEqual(['ACtoDCconverter', 'demo']);
  });
});
