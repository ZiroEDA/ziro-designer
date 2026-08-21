// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Getting from a chooser path back to the demo it names.
 *
 * The file chooser hands the caller a path and nothing else, so every place in
 * its sidebar needs a way back from a path to the thing it names. The account's
 * tree has `projectAt`; the Demos tree has this.
 *
 * It was missing, and Open Existing Project ran every accepted path through
 * `projectAt` — which reads the first segment as a project of the store. A demo
 * lives at `simulation/amplifier-ac`, so that looked for a stored project called
 * `simulation`, found none, closed the window and opened nothing. Upstream never
 * has to make this distinction: `KICAD_MANAGER_CONTROL::OpenDemoProject` is
 * `openProject( PATHS::GetStockDemosPath() )` (kicad/tools/kicad_manager_control
 * .cpp:519) — one dialog, one `LoadProject`, a different starting directory. A
 * demo opens by exactly the code that opens any other project.
 *
 * The ids here are the real ones from the published manifest, which is why the
 * depth matters: 34 demos, most of them under `simulation/`, and three of those
 * a further level down under `simulation/power_supplies/`.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DemoMeta, demoAt } from '@ziroeda/designer/src/home/demos.js';
import { projectAt } from '@ziroeda/designer/src/fs/project_store_fs.js';
import {
  deleteProject,
  listProjects,
  saveProject,
} from '@ziroeda/designer/src/home/projectStore.js';

const demo = (id: string, files: string[] = []): DemoMeta => ({
  id,
  base: id.slice(id.lastIndexOf('/') + 1),
  title: id,
  description: '',
  files,
});

/** Ids as the published manifest spells them — flat, one deep, and two deep. */
const MANIFEST: DemoMeta[] = [
  demo('ecc83', ['ecc83-pp.kicad_pro', 'ecc83-pp.kicad_sch']),
  demo('simulation/amplifier-ac', ['2n2222.model', 'amplifier-ac.kicad_pro']),
  demo('simulation/power_supplies/boost', ['boost.kicad_pro']),
];

describe('a path names the demo it is inside', () => {
  it('takes the .kicad_pro of a demo one level down', () => {
    expect(demoAt('/simulation/amplifier-ac/amplifier-ac.kicad_pro', MANIFEST)?.id).toBe(
      'simulation/amplifier-ac',
    );
  });

  it('takes the .kicad_pro of a demo two levels down', () => {
    expect(demoAt('/simulation/power_supplies/boost/boost.kicad_pro', MANIFEST)?.id).toBe(
      'simulation/power_supplies/boost',
    );
  });

  it('takes a file that is not the project file, as the chooser will offer', () => {
    expect(demoAt('/simulation/amplifier-ac/2n2222.model', MANIFEST)?.id).toBe(
      'simulation/amplifier-ac',
    );
  });

  it('takes the demo folder itself, which is what selecting the row gives', () => {
    expect(demoAt('/simulation/amplifier-ac', MANIFEST)?.id).toBe('simulation/amplifier-ac');
  });

  it('takes a flat id, where there is no folder above the demo at all', () => {
    expect(demoAt('/ecc83/ecc83-pp.kicad_pro', MANIFEST)?.id).toBe('ecc83');
  });
});

describe('a path that names no demo names nothing', () => {
  it('says nothing for the grouping folder the demos sit in', () => {
    // `simulation` is a folder derived from the ids, not a demo. Accepting it
    // must not open the first demo that happens to be inside it.
    expect(demoAt('/simulation', MANIFEST)).toBeNull();
  });

  it('says nothing for a grouping folder two levels down', () => {
    expect(demoAt('/simulation/power_supplies', MANIFEST)).toBeNull();
  });

  it('says nothing for the root', () => {
    expect(demoAt('/', MANIFEST)).toBeNull();
  });

  it('says nothing when the manifest has not loaded yet', () => {
    expect(demoAt('/simulation/amplifier-ac/amplifier-ac.kicad_pro', [])).toBeNull();
  });

  it('does not match a longer name that merely starts with a demo id', () => {
    // `simulation/amplifier-ac-2` is a different folder, not a file inside
    // `simulation/amplifier-ac`. Only a whole segment boundary counts.
    expect(demoAt('/simulation/amplifier-ac-2/x.kicad_pro', MANIFEST)).toBeNull();
    expect(demoAt('/ecc83-pp/x.kicad_pro', MANIFEST)).toBeNull();
  });
});

describe('nested ids resolve to the innermost demo', () => {
  // Nothing in the manifest nests today, but the ids are folder paths and
  // nothing stops one demo being published inside another's folder. The outer
  // id is then only an ancestor of the path; the inner one is where the file is.
  const nested: DemoMeta[] = [demo('video'), demo('video/vme-wren')];

  it('takes the inner demo, whichever order the manifest lists them in', () => {
    expect(demoAt('/video/vme-wren/wren.kicad_pro', nested)?.id).toBe('video/vme-wren');
    expect(demoAt('/video/vme-wren/wren.kicad_pro', [...nested].reverse())?.id).toBe(
      'video/vme-wren',
    );
  });

  it('still takes the outer demo for a file that is only in it', () => {
    expect(demoAt('/video/video.kicad_pro', nested)?.id).toBe('video');
  });
});

describe('the account tree cannot answer for a demo path', () => {
  // The reason the Demos place needs a lookup of its own, executed rather than
  // asserted from memory: a real store, a real project in it, and `projectAt`
  // asked the very path the chooser hands back from the Demos tree.
  const wipe = async (): Promise<void> => {
    for (const p of await listProjects()) await deleteProject(p.id);
  };
  beforeEach(wipe);
  afterEach(wipe);

  it('returns null even when a project is stored, because the segment is a demo folder', async () => {
    const enc = new TextEncoder();
    await saveProject('simulation', [{ name: 'x.kicad_pro', bytes: enc.encode('{}') }]);
    // A stored project named `simulation` is the *best* case for the old code,
    // and it still opens the wrong thing: the account's project, not the demo.
    const wrong = await projectAt('/simulation/amplifier-ac/amplifier-ac.kicad_pro');
    expect(wrong?.name).toBe('simulation');
    expect(demoAt('/simulation/amplifier-ac/amplifier-ac.kicad_pro', MANIFEST)?.id).toBe(
      'simulation/amplifier-ac',
    );
  });

  it('returns null in the ordinary case, which is why nothing opened at all', async () => {
    expect(await projectAt('/simulation/amplifier-ac/amplifier-ac.kicad_pro')).toBeNull();
  });
});
