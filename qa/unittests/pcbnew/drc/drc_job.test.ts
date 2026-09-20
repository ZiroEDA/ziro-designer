// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `runDrcJob` is the DRC as it crosses into a worker: the board rebuilt from
 * its own text, and every violation coming back as plain data. Two things have
 * to hold for that to be a port of `DRC_TOOL::RunTests` rather than a second
 * implementation of it.
 *
 * 1. The job finds the same violations an engine run over the same board finds
 *    - same codes, same messages, same items, same positions, same rules.
 * 2. What it hands back survives the boundary. `structuredClone` is what
 *    `postMessage` actually does, so the comparison runs on cloned data: a
 *    class instance or a function smuggled into the wire format fails here
 *    rather than in the browser.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import {
  type DRC_JOB_REQUEST,
  type DRC_JOB_VIOLATION,
  runDrcJob,
} from '@ziroeda/pcbnew/drc/drc_job.js';
import type { PCB_MARKER } from '@ziroeda/pcbnew/pcb_marker.js';
import { HAVE_TEST_DATA, LoadBoard, PCBNEW_TEST_DATA_DIR } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

/** KiCad's own boards, each with violations to compare - an empty list proves nothing. */
const FIXTURES = [
  'creepage/creepage', // one creepage violation, whose path is an arc
  'keepout_disallow/keepout_disallow',
  'issue24525/issue24525',
  'issue24355/issue24355',
  // Netclass-dependent clearances: without `SynchronizeNetsAndNetClasses` in
  // the job's load, every net resolves to Default and this board's answers
  // change.
  'multinetclasses_drc',
];

function readIfPresent(aPath: string): string | null {
  try {
    return readFileSync(aPath, 'utf8');
  } catch {
    return null;
  }
}

function requestFor(aRelPath: string): DRC_JOB_REQUEST {
  const base = PCBNEW_TEST_DATA_DIR + aRelPath;

  return {
    boardText: readFileSync(`${base}.kicad_pcb`, 'utf8'),
    boardPath: `${base}.kicad_pcb`,
    projectText: readIfPresent(`${base}.kicad_pro`),
    rulesText: readIfPresent(`${base}.kicad_dru`),
    rulesPath: `${base}.kicad_dru`,
    netlistText: null,
    units: 'mm',
    reportAllTrackErrors: true,
    testFootprints: false,
  };
}

/**
 * The same run through the engine directly, written out here rather than
 * called through the job, so that a change to the job's own load has something
 * independent to disagree with.
 */
function referenceViolations(aRelPath: string): DRC_JOB_VIOLATION[] {
  const board = LoadBoard(aRelPath);
  const out: DRC_JOB_VIOLATION[] = [];

  board.SynchronizeNetsAndNetClasses(false);

  board
    .GetDesignSettings()
    .m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM, aPos: VECTOR2I, aLayer: number) => {
      const rule = aItem.GetViolatingRule();

      out.push({
        errorCode: aItem.GetErrorCode(),
        errorMessage: aItem.GetErrorMessage(false),
        ids: aItem.GetIDs().map((id) => String(id)),
        pos: { x: aPos.x, y: aPos.y },
        layer: aLayer,
        ruleName: rule ? rule.m_Name : null,
        path: null, // compared separately, from the marker the job fills
      });
    });

  board.GetDesignSettings().m_DRCEngine!.RunTests('mm', true, false);

  return out;
}

/** The violations the job streams, as they arrive on the far side of postMessage. */
async function jobViolations(aRelPath: string): Promise<DRC_JOB_VIOLATION[]> {
  const out: DRC_JOB_VIOLATION[] = [];

  await runDrcJob(requestFor(aRelPath), {
    onPhase: () => {},
    onProgress: () => {},
    onViolation: (v) => out.push(structuredClone(v)),
  });

  return out;
}

const withoutPath = (v: DRC_JOB_VIOLATION): DRC_JOB_VIOLATION => ({ ...v, path: null });

suite('runDrcJob: the DRC across a worker boundary', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const relPath of FIXTURES) {
    it(`finds what an engine run finds: ${relPath}`, { timeout: 120_000 }, async () => {
      const want = referenceViolations(relPath);
      const got = await jobViolations(relPath);

      // A fixture with nothing to find would pass this whichever way the job
      // was broken, so the count itself is an assertion.
      expect(want.length, `${relPath} reports no violations at all`).toBeGreaterThan(0);
      expect(got.map(withoutPath)).toEqual(want);
    });
  }

  it('carries the marker path, arcs and all', { timeout: 120_000 }, async () => {
    // `creepage`'s report draws the shortest path over the graph, and where the
    // path runs along a round pad it is an ARC with a centre - the one shape
    // that needs more than its two ends to come back.
    const got = await jobViolations('creepage/creepage');
    const paths = got.filter((v) => v.path !== null);

    expect(paths.length).toBeGreaterThan(0);

    for (const v of paths) {
      expect(v.path!.shapes.length).toBeGreaterThan(0);

      for (const shape of v.path!.shapes) {
        expect(Number.isFinite(shape.start.x) && Number.isFinite(shape.start.y)).toBe(true);
        expect(Number.isFinite(shape.end.x) && Number.isFinite(shape.end.y)).toBe(true);
      }
    }

    // SHAPE_T.ARC is 2 (eda_shape.ts). A creepage path that runs along a
    // round pad is an arc, and an arc is the one shape that needs more than
    // its two ends to come back: without `center` it would reconstruct as a
    // different curve.
    const arcs = got.flatMap((v) => v.path?.shapes ?? []).filter((s) => s.shape === 2);

    expect(arcs.length).toBeGreaterThan(0);

    for (const arc of arcs) expect(arc.center).toBeDefined();
  });

  it('stops where the caller cancels, keeping what it found', { timeout: 120_000 }, async () => {
    const found: DRC_JOB_VIOLATION[] = [];
    let phases = 0;

    await runDrcJob(requestFor('issue24525/issue24525'), {
      onPhase: () => {
        phases += 1;
      },
      onProgress: () => {},
      onViolation: (v) => found.push(v),
      // Cancel as soon as the run has started a second phase.
      isCancelled: () => phases > 1,
    });

    const whole = await jobViolations('issue24525/issue24525');

    expect(phases).toBeGreaterThan(1);
    expect(found.length).toBeLessThan(whole.length);
  });

  it('reads the marker back out of the wire data', { timeout: 120_000 }, async () => {
    const { PCB_MARKER: MARKER } = await import('@ziroeda/pcbnew/pcb_marker.js');
    const { DRC_ITEM: ITEM } = await import('@ziroeda/pcbnew/drc/drc_item.js');
    const { drcJobPathShapes } = await import('@ziroeda/pcbnew/drc/drc_job.js');

    const got = await jobViolations('creepage/creepage');
    const wire = got[0]!;

    // What DRC_TOOL does with each message: DRC_ITEM::Create( code ) for the
    // title and the settings key, then the message, the items and the path.
    const item = ITEM.Create(wire.errorCode)!;

    item.SetErrorMessage(wire.errorMessage);
    item.SetItems(wire.ids);

    const marker: PCB_MARKER = new MARKER(item, wire.pos, wire.layer);

    marker.SetPath(drcJobPathShapes(wire.path), wire.path!.start, wire.path!.end);

    expect(marker.GetRCItem()!.GetErrorCode()).toBe(wire.errorCode);
    expect(marker.GetRCItem()!.GetIDs().map(String)).toEqual(wire.ids);
    expect(marker.GetPath().length).toBe(wire.path!.shapes.length);
    expect(marker.GetPathStart()).toEqual(wire.path!.start);
  });
});
