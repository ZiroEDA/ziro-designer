// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pl_editor sizes its own status-bar panes, and not the way every other draw
 * frame does.
 *
 * `EDA_DRAW_FRAME`'s constructor calls `updateStatusBarWidths`
 * (common/eda_draw_frame.cpp:792) and every frame inherits that table.
 * `PL_EDITOR_FRAME`'s constructor then throws it away: it builds its own
 * `dims[]` and calls `SetFieldsCount` with it
 * (pagelayout_editor/pl_editor_frame.cpp:150-181). Ours had been rendering the
 * shared table, so the pane that carries `coord origin: Left Top paper corner`
 * was sized for the word "Inches".
 *
 * Corroborated by measurement, not only by reading: the status bar of a driven
 * pl_editor was captured at 1854 px and the left edge of each pane's text read
 * off the picture (`qa/probes/pl_e2e`). After removing the 5 px text inset the
 * fixed panes measure 85, 176, 190, 116 and 288 px with 226 px shared by panes
 * 6 and 7 — which follows from the table below at ~7.1 px/char plus a two-M
 * spacer, and does not follow from the shared table at any spacer.
 */
import { describe, expect, it } from 'vitest';
import { PL_EDITOR_STATUS_TEMPLATES } from '@ziroeda/designer/src/editors/drawingsheet/pl_status_bar.js';
import { STATUS_FIELD_TEMPLATES } from '@ziroeda/designer/src/ui/StatusField.js';

describe('the pl_editor dims[] table', () => {
  it('sizes pane 5 for the longest coordinate origin, not for "Inches"', () => {
    // `KIUI::GetTextSize( _( "coord origin: Right Bottom page corner" ), … )`
    // (pl_editor_frame.cpp:171). This is the pane `UpdateStatusBar` writes the
    // origin into (:805) and it is 38 characters, against six for "Inches".
    expect(PL_EDITOR_STATUS_TEMPLATES.units).toContain('coord origin: Right Bottom page corner');
    expect(STATUS_FIELD_TEMPLATES.units).toBe('Inches');
  });

  it('puts "Inches" in pane 6, which every other frame lets stretch', () => {
    // :174, and `SetStatusText( _( "inches" ), 6 )` at :776 is what goes in it.
    expect(PL_EDITOR_STATUS_TEMPLATES.tool).toContain('Inches');
  });

  it('gives pane 7 a fixed width too', () => {
    // :178. The shared table leaves 6 and 7 proportional at -2 each.
    expect(PL_EDITOR_STATUS_TEMPLATES.constraint).toContain('Constrain to H, V, 45');
  });

  it('uses pl_editor’s own coordinate, delta and grid templates', () => {
    // :163, :166, :169. Shorter than the shared ones, and written with 0s
    // rather than 1s — the C++ comment at :157-158 is explicit that the width
    // of '1' is not the width of '0'. Upstream really does say `dx` twice in
    // the delta template.
    expect(PL_EDITOR_STATUS_TEMPLATES.coords).toContain('X 0234.567  Y 0234.567');
    expect(PL_EDITOR_STATUS_TEMPLATES.deltas).toContain('dx 0234.567  dx 0234.567');
    expect(PL_EDITOR_STATUS_TEMPLATES.grid).toContain('grid 0234.567');
    // and they are NOT the shared frame's.
    expect(PL_EDITOR_STATUS_TEMPLATES.coords).not.toContain(STATUS_FIELD_TEMPLATES.coords);
    expect(PL_EDITOR_STATUS_TEMPLATES.deltas).not.toContain(STATUS_FIELD_TEMPLATES.deltas);
    expect(PL_EDITOR_STATUS_TEMPLATES.grid).not.toContain(STATUS_FIELD_TEMPLATES.grid);
  });

  it('carries the doubled spacer on every pane', () => {
    // `spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x * 2` (:148) against
    // the shared bar's single M (eda_draw_frame.cpp:795). `.ze-statusbar .cell`
    // already pads by one M, so the second is a trailing M in the template.
    for (const [pane, template] of Object.entries(PL_EDITOR_STATUS_TEMPLATES)) {
      expect(template.endsWith('M'), `${pane} is missing pl_editor's second M`).toBe(true);
    }
  });

  it('states every pane the frame writes, including the two it fixes', () => {
    expect(Object.keys(PL_EDITOR_STATUS_TEMPLATES).sort()).toEqual([
      'constraint',
      'coords',
      'deltas',
      'grid',
      'tool',
      'units',
      'zoom',
    ]);
  });
});
