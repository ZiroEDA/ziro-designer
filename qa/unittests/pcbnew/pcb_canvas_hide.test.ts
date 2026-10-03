// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `setItemsHidden`, the move gesture's `VIEW::Hide`: a dragged footprint must
 * take its pads, graphics and fields out of the VIEW with it. They are VIEW
 * items of their own (PCB_VIEW::Add adds them beside the footprint), and with
 * only the footprint hidden the drag left them drawn where the part started.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { setItemsHidden } from '@ziroeda/pcbnew/pcb_canvas.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { harnessCanvas } from './support/pcb_tool_harness.js';
import { VIEW_VISIBILITY_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';

/** `VIEW::Hide`'s flag: the item is in the VIEW but not drawn. */
const hidden = (aItem: VIEW_ITEM): boolean =>
  ((aItem.viewPrivData()?.m_flags ?? 0) & VIEW_VISIBILITY_FLAGS.HIDDEN) !== 0;
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const BOARD = fileURLToPath(
  new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url),
);

function setup() {
  const board = ParseBoard(readFileSync(BOARD, 'utf8'));
  const frame = new TEST_PCB_FRAME(board);
  const { view } = harnessCanvas(board, frame, { mouse: { x: 0, y: 0 }, forced: null });
  const panel = { GetView: () => view } as unknown as PCB_DRAW_PANEL_GAL;
  const fp = board.Footprints()[0]!;
  const children: BOARD_ITEM[] = [];
  fp.RunOnChildren((c: BOARD_ITEM) => children.push(c), RECURSE_MODE.RECURSE);
  return { view, panel, fp, children };
}

describe('setItemsHidden', () => {
  it('hides a footprint and every child it draws with, then shows them all again', () => {
    const { view, panel, fp, children } = setup();
    expect(children.length).toBeGreaterThan(2);

    setItemsHidden(panel, [fp], true);
    expect(hidden(fp)).toBe(true);
    expect(children.filter((c) => view.HasItem(c) && !hidden(c)).length).toBe(0);

    setItemsHidden(panel, [fp], false);
    expect(hidden(fp)).toBe(false);
    expect(children.filter((c) => view.HasItem(c) && hidden(c)).length).toBe(0);
  });

  it('leaves a selected child hidden at the end: the selection draws it', () => {
    const { view, panel, fp, children } = setup();
    const child = children.find((c) => view.HasItem(c))!;
    setItemsHidden(panel, [fp], true);
    child.SetSelected();
    setItemsHidden(panel, [fp], false);
    expect(hidden(child)).toBe(true);
  });
});
