// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `EDA_3D_VIEWER_FRAME` and the board it shows: a board LOADED always reloads the scene,
 * a board EDITED only with "Refresh 3D view automatically" on.
 *
 * Upstream the two are different calls: `OpenProjectFiles` ends with
 * `draw3DFrame->NewDisplay()` unconditionally (pcbnew/files.cpp:931), and only
 * `PCB_EDIT_FRAME::OnModify` passes `m_Live3DRefresh` (pcb_edit_frame.cpp:2092). The board
 * editor keeps one BOARD across its edits and makes a new one per load, so the frame tells
 * them apart by the BOARD. Opened by URL (/p/<id>/pcb/3d), the frame mounted on the editor's
 * empty placeholder and kept it after the real board was parsed: an empty scene (blinky555, I-16).
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';

const reload = vi.fn();
const mount = vi.fn();

vi.mock('@ziroeda/3d-viewer/pcb3d.js', () => ({
  mount3DViewer: (_el: unknown, aBoard: unknown) => {
    mount(aBoard);
    return {
      status: { activity: '', dx: 0, dy: 0, hovered: '', zoom: 1 },
      onStatus: null,
      onSelect: null,
      reload: (aBoard: unknown) => reload(aBoard),
      setSelectedFootprints: () => {},
      setGrid: () => {},
      setOrtho: () => {},
      setCamera: () => {},
      dispose: () => {},
    };
  },
}));

const { Viewer3DFrame } = await import('@ziroeda/designer/src/editors/pcb/Viewer3DFrame.js');

afterEach(() => {
  cleanup();
  settings.updatePcbnew((s) => {
    s.pcb_display.live_3d_refresh = false;
  });
  reload.mockClear();
  mount.mockClear();
});

const frame = (k: BOARD) => (
  <Viewer3DFrame board={{ k }} backLabel="PCB Editor" imageBaseName="b" onClose={() => {}} />
);

/** Let the lazy import of the viewer resolve and its effects run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
};

describe('the 3D frame and the board it shows (live refresh off, the default)', () => {
  it('rebuilds when the editor loads a new board, as NewDisplay after OpenProjectFiles', async () => {
    const placeholder = new BOARD();
    const loaded = new BOARD();
    const view = render(frame(placeholder));
    await settle();
    expect(mount).toHaveBeenCalledWith(placeholder);

    view.rerender(frame(loaded));
    await settle();
    expect(reload).toHaveBeenCalledWith(loaded);
  });

  it('applies a board loaded while the viewer was still loading', async () => {
    const placeholder = new BOARD();
    const loaded = new BOARD();
    const view = render(frame(placeholder));
    view.rerender(frame(loaded)); // before the lazy import has resolved
    await settle();
    const shown = reload.mock.calls.at(-1)?.[0] ?? mount.mock.calls.at(-1)?.[0];
    expect(shown).toBe(loaded);
  });

  it('does not rebuild for an edit - the same BOARD under a new handle', async () => {
    const board = new BOARD();
    const view = render(frame(board));
    await settle();
    view.rerender(frame(board));
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('with "Refresh 3D view automatically" on', () => {
  it('rebuilds for an edit too, as OnModify with m_Live3DRefresh', async () => {
    settings.updatePcbnew((s) => {
      s.pcb_display.live_3d_refresh = true;
    });
    const board = new BOARD();
    const view = render(frame(board));
    await settle();
    view.rerender(frame(board));
    await settle();
    expect(reload).toHaveBeenCalledWith(board);
  });
});
