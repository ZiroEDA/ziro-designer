// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Teardrops, end to end — `PANEL_SETUP_TEARDROPS`.
 *
 * The page LOOKED half-built and was not: at the old dialog size the whole
 * right-hand column of every group — Allow teardrop to span two track segments,
 * Prefer zone connection, and the track width limit, nine controls in all — sat
 * behind a horizontal scrollbar. What was wrong was the window, not the page.
 *
 * So this pins the chain a control actually has to travel, because "the panel
 * draws it" is only the first link of four:
 *
 *     the control  ->  TeardropsSetup  ->  TEARDROP_PARAMETERS_LIST  ->  .kicad_pro
 *
 * Each of the three is a place a value has been lost before. The middle one is
 * where the units change (a percentage becomes a ratio, a millimetre becomes an
 * IU) and where one field is INVERTED, which is the kind of thing that looks
 * right in a screenshot and is wrong on the board.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  PanelPcbTeardrops,
  defaultTeardrops,
  type TeardropsSetup,
} from '@ziroeda/pcbnew/dialogs/panel_setup_teardrops.js';
import { BoardSetupFromWindow } from '@ziroeda/designer/src/editors/pcb/dialogs/board_setup_transfer.js';
import { EMPTY_PCB } from '@ziroeda/designer/src/home/new_project.js';
import { TARGET_TD } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';
import { readSetup } from './board_setup_test_utils.js';

afterEach(cleanup);

/** Render the panel and hand back the last value its `onChange` produced. */
function panel(value: TeardropsSetup = defaultTeardrops()): {
  latest: () => TeardropsSetup;
  rerender: (v: TeardropsSetup) => void;
} {
  let last = value;
  const view = render(
    <PanelPcbTeardrops
      value={value}
      onChange={(next) => {
        last = next;
      }}
    />,
  );
  return {
    latest: () => last,
    rerender: (v) =>
      view.rerender(
        <PanelPcbTeardrops
          value={v}
          onChange={(n) => {
            last = n;
          }}
        />,
      ),
  };
}

/** The three groups, in `panel_setup_teardrops_base.cpp`'s order. */
const GROUPS = [
  'Default Properties for Round Shapes',
  'Default Properties for Rectangular Shapes',
  'Properties for Track-to-Track Teardrops',
] as const;

describe('the page draws all three groups', () => {
  it('under upstream’s headings, in upstream’s order', () => {
    panel();
    const titles = [...document.querySelectorAll('.ze-pref-group-title')].map((e) => e.textContent);
    expect(titles).toEqual([...GROUPS]);
  });

  it('and every group carries its whole right-hand column', () => {
    // The nine controls the old 980px dialog hid. Round and Rectangular have a
    // Prefer zone connection; Track-to-Track has none, because a track has no
    // zone connection to prefer (`panel_setup_teardrops_base.cpp` gives the
    // third group no such checkbox).
    panel();
    expect(screen.getAllByText('Allow teardrop to span two track segments')).toHaveLength(1);
    expect(screen.getAllByText('Allow teardrop to span track segments')).toHaveLength(2);
    expect(screen.getAllByText('Prefer zone connection')).toHaveLength(2);
    expect(screen.getAllByText('Track width limit:')).toHaveLength(3);
    expect(screen.getAllByText('Curved edges')).toHaveLength(3);
  });

  it('names the reference dimension per group: d for round, w for the other two', () => {
    // `%(d)` is a fraction of the pad or via DIAMETER; `%(w)` of its width.
    // Three static texts with the middle one italic, not one grey "%(d)".
    panel();
    const hints = [...document.querySelectorAll('.ze-td-hint')].map((e) => e.textContent);
    // Three per group: best length, best width, track width limit.
    expect(hints).toEqual(['d', 'd', 'd', 'w', 'w', 'w', 'w', 'w', 'w']);
  });
});

describe('the dialog is big enough to show them', () => {
  /**
   * Which is the whole reason the right-hand column looked missing.
   *
   * `PAGED_DIALOG( …, wxSize( 980, 600 ) )` is the size the window OPENS at;
   * `onPageChanged` then grows it into the showing page's `GetBestSize()`
   * (`paged_dialog.cpp:424-451`), so 980 is a number no user ever sees. This
   * port states one size for the dialog's whole life — `ui/paged_dialog_size.ts`
   * records at length why — so the size it states has to be the grown one.
   */
  it('states the measured size, not the constructor literal', () => {
    // [px] 1227 x 786, off a live Board Setup on the Teardrops page: the window
    // spans x 330..1556 and y 256..1041 in a 1920 x 1200 screenshot.
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/dialogs/dialog_board_setup.tsx'),
      'utf8',
    );
    expect(src).toMatch(/initialSize=\{\{ width: 1227, height: 786 \}\}/);
    // Inside `PAGED_DIALOG`'s own failsafe, which `.ze-paged-dialog` carries:
    // `minSize.DecTo( FromDIP( wxSize( 1500, 900 ) ) )`.
    expect(1227).toBeLessThanOrEqual(1500);
    expect(786).toBeLessThanOrEqual(900);
  });
});

describe('a control writes its own field', () => {
  const checkbox = (label: string, nth = 0): HTMLInputElement =>
    screen.getAllByText(label)[nth]?.closest('label')?.querySelector('input') as HTMLInputElement;

  it('Curved edges, per group and not across them', () => {
    // The bug a shared handler makes: one checkbox toggling all three.
    const p = panel();
    fireEvent.click(checkbox('Curved edges', 1));
    expect(p.latest().rect.curvedEdges).toBe(true);
    expect(p.latest().round.curvedEdges).toBe(false);
    expect(p.latest().trackToTrack.curvedEdges).toBe(false);
  });

  it('Prefer zone connection, which defaults ON', () => {
    // `TEARDROP_PARAMETERS`' constructor leaves `m_TdOnPadsInZones` false, and
    // the checkbox shows its negation (`panel_setup_teardrops.cpp`).
    expect(defaultTeardrops().round.preferZoneConnection).toBe(true);
    const p = panel();
    fireEvent.click(checkbox('Prefer zone connection', 0));
    expect(p.latest().round.preferZoneConnection).toBe(false);
  });

  it('the span checkbox, whose label differs on the round group', () => {
    const p = panel();
    fireEvent.click(checkbox('Allow teardrop to span two track segments'));
    expect(p.latest().round.allowSpanTwoSegments).toBe(false);
  });

  it('a millimetre entry', () => {
    const p = panel();
    // A DIRECT child of the grid: a `wxTextCtrl` sits in the cell itself, while
    // the three `wxSpinCtrlDouble`s wrap theirs in the stepper. Two per group —
    // maximum length and maximum width — which is also the pair that is in
    // millimetres rather than a percentage.
    const entries = [...document.querySelectorAll('.ze-td-grid > input.ze-search')];
    expect(entries).toHaveLength(6);
    fireEvent.change(entries[0] as HTMLInputElement, { target: { value: '1.5' } });
    expect(p.latest().round.maxLengthMM).toBe(1.5);
  });
});

describe('what TEARDROP_MANAGER is handed', () => {
  /**
   * `PANEL_SETUP_TEARDROPS::TransferDataFromWindow` writes the page onto
   * `BOARD_DESIGN_SETTINGS::m_TeardropParamsList`, which is what
   * TEARDROP_MANAGER reads inside BOARD_COMMIT::Push. Board Setup's OK runs it
   * (`BoardSetupFromWindow`); nothing re-applies the page per commit, as
   * nothing does upstream.
   */
  const handed = (edit: (t: TeardropsSetup) => void) => {
    const f = readSetup(EMPTY_PCB);
    edit(f.values.teardrops);
    BoardSetupFromWindow(f.values, f.board, f.project);
    const tdl = f.board.GetDesignSettings().GetTeadropParamsList();
    return { tdl, round: tdl.GetParameters(TARGET_TD.TARGET_ROUND) };
  };

  it('turns the percentages into ratios and the millimetres into IU', () => {
    const { round: p } = handed((t) => {
      t.round.bestLengthPct = 40;
      t.round.bestWidthPct = 80;
      t.round.trackWidthLimitPct = 70;
      t.round.maxLengthMM = 1.5;
      t.round.maxWidthMM = 2.5;
    });
    expect(p.m_BestLengthRatio).toBeCloseTo(0.4, 12);
    expect(p.m_BestWidthRatio).toBeCloseTo(0.8, 12);
    expect(p.m_WidthtoSizeFilterRatio).toBeCloseTo(0.7, 12);
    // 1.5 mm and 2.5 mm at the pcbnew IU scale.
    expect(p.m_TdMaxLen).toBe(1_500_000);
    expect(p.m_TdMaxWidth).toBe(2_500_000);
  });

  it('INVERTS Prefer zone connection, which is the field to get wrong', () => {
    // The checkbox asks whether to PREFER the zone; the parameter records
    // whether to put teardrops on pads that are IN one. Wiring it straight
    // through reads perfectly and does the opposite on every zone-connected pad.
    expect(handed((t) => (t.round.preferZoneConnection = true)).round.m_TdOnPadsInZones).toBe(
      false,
    );
    expect(handed((t) => (t.round.preferZoneConnection = false)).round.m_TdOnPadsInZones).toBe(
      true,
    );
  });

  it('writes the scope flags, and never enables a parameter set', () => {
    // `m_Enabled` is not on the page: the per-item one is Edit Teardrops', and
    // TARGET_TRACK's is set only by that dialog (dialog_global_edit_teardrops.cpp).
    const { tdl } = handed((t) => {
      t.targets.trackToTrack = true;
      t.targets.vias = false;
    });
    expect(tdl.m_TargetTrack2Track).toBe(true);
    expect(tdl.m_TargetVias).toBe(false);
    for (const t of [TARGET_TD.TARGET_ROUND, TARGET_TD.TARGET_RECT, TARGET_TD.TARGET_TRACK])
      expect(tdl.GetParameters(t).m_Enabled).toBe(false);
  });
});
