// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// @vitest-environment happy-dom
/**
 * `mount3DViewer` end to end on a real board, with only the WebGL context
 * stubbed.
 *
 * This is the test that was missing on 2026-09-11: the frame wraps the
 * mount in a `try/catch` (it has to — a GL failure must not take the board
 * editor down), so a throw anywhere in the scene build produced a blank
 * viewer with an empty status bar and no message. One such throw shipped —
 * `applyZoomLimits` called before `const camera` existed — and the unit
 * tests, which cover the pure halves, could not see it. This one runs the
 * whole mount: units, layers, materials, meshes, models, camera, gizmo.
 *
 * It lives in `designer/`, not `qa/`, because `pcb3d.ts` reaches
 * `occt-import-js` and a Vite `?url` import that qa's typecheck cannot
 * resolve (see qa-cannot-test-designer-ui-modules).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const real = await importOriginal<typeof import('three')>();
  /** `WebGLRenderer` without a context: every call the mount makes, as a no-op. */
  class FakeRenderer {
    domElement = document.createElement('canvas');
    autoClear = false;
    toneMapping = 0;
    outputColorSpace = '';
    sortObjects = true;
    setPixelRatio(): void {}
    getPixelRatio(): number {
      return 1;
    }
    setClearColor(): void {}
    setSize(): void {}
    setViewport(): void {}
    setScissorTest(): void {}
    clear(): void {}
    clearDepth(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...real, WebGLRenderer: FakeRenderer };
});

import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { mount3DViewer } from '../pcb3d.js';

const BOARD = resolve(__dirname, '../../../../public/demos/ecc83/ecc83-pp.kicad_pcb');

describe('mount3DViewer', () => {
  it('mounts the ecc83 demo board and answers its status, with no GL', async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    const board = readBoard(parse(readFileSync(BOARD, 'utf8')));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const statuses: { dx: number; dy: number; zoom: number; activity: string }[] = [];
    const v = mount3DViewer(host, board, [], undefined, {});
    expect(v).not.toBeNull();
    if (!v) return;
    // The build reported every reload stage into the ACTIVITY field before a
    // listener could attach (create_scene.cpp:704-937); the last synchronous
    // one names a model file load3dModels has in hand (create_scene.cpp:1661),
    // and `status` holds it for the late frame.
    expect(v.status.activity).toMatch(/^Loading \S+\.wrl\.\.\.$/);
    v.onStatus = (s) => statuses.push(s);
    // the frame's own commands, each once — none may throw
    v.setGrid('10mm');
    v.zoomIn();
    v.setView('front');
    v.rotate('z', true);
    v.move('left');
    v.setOrtho(true);
    v.setOrtho(false);
    v.pivotCenter();
    const m = v.getViewMatrix();
    expect(m).toHaveLength(16);
    v.setViewMatrix(m);
    v.setSelectedFootprints(new Set([0]));
    // a reload beside the live scene, with the same board and other flags:
    // the reporter starts over at "Loading..." and walks the stages again,
    // naming each layer the way the board does (create_scene.cpp:825)
    const before = statuses.length;
    v.reload(
      board,
      undefined,
      { showBoardBody: false, visible3d: new Set(['LAYER_3D_COPPER_TOP']) },
      [],
    );
    const reloadLog = statuses.slice(before).map((s) => s.activity);
    expect(reloadLog[0]).toBe('Loading...');
    expect(reloadLog).toContain('Create layers');
    // ecc83 renames F.Cu "top_cu"; `GetBoard()->GetLayerName()` says so, not "F.Cu"
    expect(reloadLog).toContain('Load OpenGL layer top_cu');
    expect(reloadLog).not.toContain('Load OpenGL layer F.Cu');
    expect(reloadLog).toContain('Loading 3D models...');
    // the models are cached from the first build (S3D_CACHE): none is re-fetched
    expect(reloadLog.at(-1)).toBe('Loading 3D models...');
    // load3dModels done: the reload clock is reported (create_scene.cpp:946)
    await new Promise((r) => setTimeout(r, 0));
    expect(statuses.at(-1)?.activity).toMatch(/^Reload time \d+\.\d{3} s$/);
    v.dispose();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('mounts an EMPTY footprint-holder board — the chooser before a selection', () => {
    // `bbbox.Inflate( pcbIUScale.mmToIU( 10 ) )` when the box is 0 x 0
    // (board_adapter.cpp:363-364): the scene exists, background and navigator
    // and no board body, where this used to answer null and leave the
    // chooser's 3D pane blank.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    const board = readBoard(
      parse(
        `(kicad_pcb (version 20241229) (generator "pcbnew") (general (thickness 1.6))
           (paper "A4") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (net 0 ""))`,
      ),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const v = mount3DViewer(host, board, [], undefined, { footprintHolder: true });
    expect(v).not.toBeNull();
    v?.dispose();
  });
});
