// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `/demo/<id>/pcb` typed into the address bar opened the PCB editor on an
 * **untitled empty board**: "untitled [Read Only] — PCB Editor", 0 pads, 0
 * tracks, with the demo banner above it.
 *
 * The banner is the tell. The demo HAD been fetched and the app knew it was on
 * one; what never happened was the handover. A demo's files live in the
 * project manager - `openDemoProject` ingests them and persists nothing, by
 * design - and they reach an editor ONLY when one of the manager's launchers
 * passes them up. The deep link raised the frame itself, so the editor showed
 * what it had been warmed with.
 *
 * A project deep link never had this bug (`openByUid` loads the files into the
 * app before the frame is raised), which is why it was only ever a demo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DemoMeta } from '@ziroeda/designer/src/home/demos.js';
import { launchDemoFrame } from '@ziroeda/designer/src/home/demos.js';
import type { PickedHomeFile } from '@ziroeda/designer/src/home/files.js';

const SRC = resolve(import.meta.dirname, '../../../designer/src');

const file = (name: string): PickedHomeFile => ({ name, text: `(${name})` }) as PickedHomeFile;

const DEMO: DemoMeta = {
  id: 'cm5_minima',
  base: 'CM5_MINIMA_3',
  title: 'CM5 Minima',
  description: 'a carrier board',
  files: [],
};

const PROJECT = [
  file('CM5_MINIMA_3/CM5_MINIMA_3.kicad_pro'),
  file('CM5_MINIMA_3/CM5_MINIMA_3.kicad_sch'),
  file('CM5_MINIMA_3/CM5_MINIMA_3.kicad_pcb'),
  file('CM5_MINIMA_3/CM5IO.pretty/R_0805.kicad_mod'),
];

/** The launchers, recording what each was handed. */
function spies(): {
  calls: { frame: string; board: string | null; files: number }[];
  launchers: Parameters<typeof launchDemoFrame>[3];
} {
  const calls: { frame: string; board: string | null; files: number }[] = [];

  return {
    calls,
    launchers: {
      openPcb: (board, files) =>
        calls.push({ frame: 'pcb', board: board?.name ?? null, files: files.length }),
      openSchematic: (files) =>
        calls.push({ frame: 'schematic', board: null, files: files.length }),
      openSymbolEditor: (files) =>
        calls.push({ frame: 'symbols', board: null, files: files.length }),
      openFootprintEditor: (files) =>
        calls.push({ frame: 'footprints', board: null, files: files.length }),
    },
  };
}

describe('a demo address names a frame, and that frame gets the files', () => {
  it('opens the board editor on the demo’s own board, with the whole project behind it', () => {
    const { calls, launchers } = spies();

    launchDemoFrame(PROJECT, DEMO, 'pcb', launchers);

    // The board itself, and every file - the board editor reaches the
    // schematic through them (Update PCB from Schematic, cross-probing).
    expect(calls).toEqual([
      { frame: 'pcb', board: 'CM5_MINIMA_3/CM5_MINIMA_3.kicad_pcb', files: 4 },
    ]);
  });

  it('falls back to the empty board when the demo has none, as launchPcb does', () => {
    const { calls, launchers } = spies();

    launchDemoFrame(PROJECT.slice(0, 2), DEMO, 'pcb', launchers);

    expect(calls).toEqual([{ frame: 'pcb', board: null, files: 2 }]);
  });

  it('opens the other three frames on the project too', () => {
    for (const view of ['schematic', 'symbols', 'footprints'] as const) {
      const { calls, launchers } = spies();

      launchDemoFrame(PROJECT, DEMO, view, launchers);

      expect(calls).toEqual([{ frame: view, board: null, files: 4 }]);
    }
  });

  it('is the demo it came from, so the editors stay read-only', () => {
    // `onOpenProject( files, start, demo )`: the third argument is what marks
    // the project a demo in the app. Passing null there is what used to let a
    // demo be edited as though it were the user's own.
    let seen: DemoMeta | null = null;

    launchDemoFrame(PROJECT, DEMO, 'schematic', {
      openSchematic: (_files, demo) => {
        seen = demo;
      },
    });

    expect(seen).toBe(DEMO);
  });
});

describe('the address carries the frame as far as the launcher', () => {
  it('App puts the view in the request it sends the manager', () => {
    const app = readFileSync(resolve(SRC, 'App.tsx'), 'utf8');
    const demoBranch = app.slice(app.indexOf("if (route.kind === 'demo')"));
    const request = demoBranch.slice(demoBranch.indexOf('setDemoRequest'));

    expect(request.slice(0, request.indexOf('}));'))).toContain('view: route.view');
  });

  it('the manager runs a launcher for it', () => {
    const home = readFileSync(resolve(SRC, 'home/HomePage.tsx'), 'utf8');
    const open = home.slice(home.indexOf('const openDemoProject = async ('));
    const body = open.slice(0, open.indexOf('\n  };'));

    // The request's view reaches openDemoProject...
    expect(home).toContain('void openDemoProject(id, openDemoRequest?.view)');
    // ...and openDemoProject hands it to a launcher rather than to nothing.
    // Whitespace-stripped and including the GUARD: `if (false && view)` left
    // the call in the file and the frame empty, and survived this check when
    // it looked for the call alone.
    expect(body.replace(/\s+/g, '')).toContain('if(view){launchDemoFrame(files,d,view,{');
  });
});
