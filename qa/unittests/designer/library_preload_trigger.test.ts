// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * WHERE the preload is fired from.
 *
 * This is the half of the port that a test of `preloadLibraries` alone cannot
 * reach, and it is the half Akshay's complaint is actually about: the routine
 * is correct and useless if nothing calls it, or if it is called from the place
 * tool. Upstream's trigger is **opening a project** —
 * `SCH_EDIT_FRAME::LoadProject` (eeschema/sch_edit_frame.cpp:1492-1499),
 * `SCH_EDIT_FRAME::OpenProjectFiles` (eeschema/files-io.cpp:857-864) and
 * `PCB_EDIT_FRAME::OpenProjectFiles` (pcbnew/files.cpp:605-612). Nothing in
 * eeschema or pcbnew calls `PreloadLibraries` from a tool, a chooser or a
 * dialog other than the two library-table panels.
 *
 * So the call sites are pinned structurally: each call must sit inside the
 * loader it belongs to, which an occurrence count alone would not say.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { backgroundJobsMonitor } from '@ziroeda/designer/src/ui/background_jobs_monitor.js';
import { PRELOAD_JOB_NAME } from '@ziroeda/designer/src/libraryPreload.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

/** The offset of `needle`, asserted to exist so a rename fails loudly. */
function at(source: string, needle: string, from = 0): number {
  const i = source.indexOf(needle, from);
  expect(i, `${needle} not found`).toBeGreaterThan(-1);
  return i;
}

describe('the schematic fires it from the two loaders, not from a tool', () => {
  const src = read('editors/schematic/SchematicEditor.tsx');

  it('once inside loadText and once inside loadProject, and nowhere else', () => {
    const calls = [...src.matchAll(/preloadSchematicLibraries\(/g)].map((m) => m.index ?? -1);
    // Two trigger sites, matching upstream's two CallAfters.
    expect(calls).toHaveLength(2);

    const loadText = at(src, 'const loadText = useCallback(');
    const loadProject = at(src, 'const loadProject = useCallback(');
    // `loadText` is declared before `loadProject`; the first call must fall
    // between them and the second after the latter, which is what puts each
    // call in its own loader rather than both in one.
    expect(loadText).toBeLessThan(loadProject);
    expect(calls[0]).toBeGreaterThan(loadText);
    expect(calls[0]).toBeLessThan(loadProject);
    expect(calls[1]).toBeGreaterThan(loadProject);
  });

  it('is not wired to the place tool', () => {
    // The whole point of the port. `activeTool === 'placeSymbol'` and the
    // chooser's own open flag must be nowhere near the preload.
    for (const call of [...src.matchAll(/preloadSchematicLibraries\(/g)]) {
      const around = src.slice((call.index ?? 0) - 600, (call.index ?? 0) + 200);
      expect(around).not.toMatch(/placeSymbol|placePower|chooserOpen/);
    }
  });
});

describe('the board fires it from its load path', () => {
  const src = read('editors/pcb/PcbEditor.tsx');

  it('inside the effect that parses the board text', () => {
    const calls = [...src.matchAll(/preloadBoardLibraries\(/g)].map((m) => m.index ?? -1);
    expect(calls).toHaveLength(1);
    // pcbnew/files.cpp:605-612 preloads as the project is switched, just
    // before the board is read; ours goes in the same parse effect.
    // `textRef.current`: the `text` prop is live now (the host mirrors the
    // board's own autosave back into the open project), so the parse effect
    // reads it at open time instead of depending on it.
    const parse = at(src, 'readBoard(parse(textRef.current))');
    const call = calls[0] ?? -1;
    expect(call).toBeGreaterThan(parse);
    expect(call - parse).toBeLessThan(800);
  });
});

describe('firing it puts a job on the monitor and takes it off again', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('preloadSchematicLibraries runs both faces', async () => {
    // eeschema alone schedules only the symbol face; the project manager
    // (kicad/kicad_manager_frame.cpp:539-549) is what fires the footprint one
    // too. We have no separate manager process, so the schematic frame does
    // both — see designer/src/editors/schematic/preload.ts.
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]', { status: 200 }))),
    );

    const names: string[] = [];
    const stop = backgroundJobsMonitor.subscribe(() => {
      for (const job of backgroundJobsMonitor.jobs())
        if (!names.includes(job.name)) names.push(job.name);
    });

    const { preloadSchematicLibraries } = await import(
      '@ziroeda/designer/src/editors/schematic/preload.js'
    );
    preloadSchematicLibraries([
      { symbols: [{ libId: 'Device:R', fields: [{ key: 'Footprint', value: '' }] }] } as never,
    ]);

    // The `CallAfter` (setTimeout 0) plus one 150 ms poll.
    await new Promise((r) => setTimeout(r, 500));
    stop();

    expect(names).toContain(PRELOAD_JOB_NAME.symbols);
    expect(names).toContain(PRELOAD_JOB_NAME.footprints);
    // Both removed once done — `BackgroundJobMonitor().Remove( … )`.
    expect(backgroundJobsMonitor.jobs()).toHaveLength(0);
  }, 30_000);
});
