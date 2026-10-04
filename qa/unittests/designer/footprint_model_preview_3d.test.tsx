// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_PREVIEW_3D_MODEL::UpdateDummyFootprint: the canvas draws a COPY of the
 * footprint that has the panel's model list, never the footprint itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Board } from '@ziroeda/pcbnew/types.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT, FP_3DMODEL } from '@ziroeda/pcbnew/footprint.js';

const seen: (Board | null)[] = [];

vi.mock('@ziroeda/designer/src/editors/pcb/widgets/footprint_preview_3d.js', async (orig) => {
  const real =
    await orig<
      typeof import('@ziroeda/designer/src/editors/pcb/widgets/footprint_preview_3d.js')
    >();
  return {
    ...real,
    FootprintPreview3D: ({ board }: { board: Board | null }) => {
      seen.push(board);
      return null;
    },
  };
});

import { FootprintModelPreview3D } from '@ziroeda/designer/src/editors/pcb/widgets/footprint_model_preview_3d.js';

afterEach(() => {
  cleanup();
  seen.length = 0;
});

const model = (n: string): FP_3DMODEL => {
  const m = new FP_3DMODEL();
  m.m_Filename = n;
  return m;
};

describe('FootprintModelPreview3D', () => {
  it("draws a holder board with one footprint carrying the panel's models", () => {
    const fp = new FOOTPRINT(new BOARD());
    fp.Models().push(model('old.wrl'));

    render(
      <FootprintModelPreview3D
        footprint={fp}
        models={[model('a.wrl'), model('b.wrl')]}
        version={0}
      />,
    );

    const board = seen.at(-1)!;
    expect(board.footprints).toHaveLength(1);
    expect(board.footprints[0]!.models.map((m) => m.path)).toEqual(['a.wrl', 'b.wrl']);
  });

  it('never touches the footprint it was given', () => {
    const fp = new FOOTPRINT(new BOARD());
    fp.Models().push(model('old.wrl'));
    render(<FootprintModelPreview3D footprint={fp} models={[model('a.wrl')]} version={0} />);
    expect(fp.Models().map((m) => m.m_Filename)).toEqual(['old.wrl']);
  });

  it('a row with no file name is not a model to draw', () => {
    const fp = new FOOTPRINT(new BOARD());
    render(
      <FootprintModelPreview3D footprint={fp} models={[model(''), model('a.wrl')]} version={0} />,
    );
    expect(seen.at(-1)!.footprints[0]!.models).toHaveLength(1);
  });

  it("redraws when the panel's change counter moves", () => {
    const fp = new FOOTPRINT(new BOARD());
    const list = [model('a.wrl')];
    const { rerender } = render(
      <FootprintModelPreview3D footprint={fp} models={list} version={0} />,
    );
    const first = seen.at(-1);
    list.push(model('b.wrl'));
    rerender(<FootprintModelPreview3D footprint={fp} models={list} version={1} />);
    expect(seen.at(-1)).not.toBe(first);
    expect(seen.at(-1)!.footprints[0]!.models).toHaveLength(2);
  });
});
