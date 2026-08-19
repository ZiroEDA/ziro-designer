// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The five `cross_probing.*` preferences, tested by what they change rather
 * than by whether the checkbox moves.
 *
 * They were placeholders for a long time — four checkboxes drawn `checked` and
 * `disabled` with no store behind them — so the thing worth proving is not that
 * a setting persists but that turning it off makes the cross-probe do something
 * different. Each case below flips one and asserts on the answer the board acts
 * on: the items it selects, the view it lands on, the net it lights.
 *
 * The nesting is the part that is easy to get wrong and easy to "fix" into
 * something plausible-but-wrong: `zoom_to_fit` lives INSIDE `center_on_items`
 * (include/settings/app_settings.h:36, "ignored if center_on_items is off"), so
 * centring off must leave the zoom alone too, not merely skip the pan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  crossProbeSelection,
  crossProbeHighlightNet,
  crossProbeViewChange,
  crossProbeFlashSelection,
  CROSS_PROBE_FLASH_INTERVAL_MS,
  CROSS_PROBE_FLASH_LAST_PHASE,
} from '@ziroeda/pcbnew';
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  CROSS_PROBING_DEFAULTS,
  type CrossProbingSettings,
} from '@ziroeda/common/src/cross_probing_settings.js';
import {
  EESCHEMA_DEFAULTS,
  PCBNEW_DEFAULTS,
  deepMerge,
} from '@ziroeda/designer/src/prefs/settings.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (footprint "R_0402" (layer "F.Cu") (uuid "fp-1") (at 10 10)
    (path "/sym-1")
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "t1")
      (effects (font (size 1 1) (thickness 0.15)))))
  (footprint "R_0402" (layer "F.Cu") (uuid "fp-2") (at 30 10)
    (path "/sym-2")
    (property "Reference" "R2" (at 0 0 0) (layer "F.SilkS") (uuid "t2")
      (effects (font (size 1 1) (thickness 0.15))))))
`;
const board = readBoard(parse(BOARD));

const cfg = (over: Partial<CrossProbingSettings>): CrossProbingSettings => ({
  ...CROSS_PROBING_DEFAULTS,
  ...over,
});

// ----- the settings themselves ------------------------------------------------

describe('cross_probing settings round-trip', () => {
  it('carries KiCad’s own defaults: four on, flash off', () => {
    // APP_SETTINGS_BASE::APP_SETTINGS_BASE, common/settings/app_settings.cpp:290-303.
    expect(CROSS_PROBING_DEFAULTS).toEqual({
      on_selection: true,
      center_on_items: true,
      zoom_to_fit: true,
      auto_highlight: true,
      flash_selection: false,
    });
  });

  it('hangs off both editors, as it hangs off APP_SETTINGS_BASE upstream', () => {
    // app_settings.h:226 — one per frame that can receive a probe.
    expect(EESCHEMA_DEFAULTS.cross_probing).toEqual(CROSS_PROBING_DEFAULTS);
    expect(PCBNEW_DEFAULTS.cross_probing).toEqual(CROSS_PROBING_DEFAULTS);
  });

  it('takes a stored value back and defaults the keys the store predates', () => {
    const merged = deepMerge(PCBNEW_DEFAULTS, {
      cross_probing: { zoom_to_fit: false },
    }) as typeof PCBNEW_DEFAULTS;
    expect(merged.cross_probing.zoom_to_fit).toBe(false);
    // A settings file written before `flash_selection` existed must not lose
    // the other four to `undefined`.
    expect(merged.cross_probing.on_selection).toBe(true);
    expect(merged.cross_probing.flash_selection).toBe(false);
  });

  it('keeps the default when a stored value has the wrong type', () => {
    const merged = deepMerge(PCBNEW_DEFAULTS, {
      cross_probing: { on_selection: 'yes' },
    }) as typeof PCBNEW_DEFAULTS;
    expect(merged.cross_probing.on_selection).toBe(true);
  });
});

// ----- on_selection -----------------------------------------------------------

describe('on_selection decides whether the packet is acted on at all', () => {
  it('selects what the parts name when it is on', () => {
    expect(crossProbeSelection(cfg({ on_selection: true }), board, ['FR1'])).toEqual([
      'footprint:0',
    ]);
  });

  it('refuses the packet when it is off, rather than clearing the selection', () => {
    // `case MAIL_SELECTION: if( !on_selection ) break;` — cross-probing.cpp:734.
    // null is "do not touch the selection", which is not the same answer as [].
    expect(crossProbeSelection(cfg({ on_selection: false }), board, ['FR1'])).toBeNull();
  });

  it('still obeys an explicitly forced probe', () => {
    // MAIL_SELECTION_FORCE falls in below the check (cross-probing.cpp:738).
    expect(crossProbeSelection(cfg({ on_selection: false }), board, ['FR1'], true)).toEqual([
      'footprint:0',
    ]);
  });
});

// ----- center_on_items / zoom_to_fit -----------------------------------------

describe('center_on_items and zoom_to_fit decide where the view lands', () => {
  const canvas = { width: 800, height: 600 };
  // A view looking at the origin, 800 px across 100 mm of board.
  const view = { scale: 800 / pcbMmToIU(100), cx: 0, cy: 0 };
  // A 1 mm part far off to the right of where the view is looking.
  const far = {
    minX: pcbMmToIU(500),
    minY: pcbMmToIU(500),
    maxX: pcbMmToIU(501),
    maxY: pcbMmToIU(501),
  };

  it('moves the view onto the item with both on', () => {
    const next = crossProbeViewChange(cfg({}), far, view, canvas)!;
    expect(next).not.toBeNull();
    expect(next.cx).toBeCloseTo(pcbMmToIU(500.5), 0);
    expect(next.cy).toBeCloseTo(pcbMmToIU(500.5), 0);
    // A 1 mm part on a 100 mm viewport: the zoom has to change to see it.
    expect(next.scale).not.toBeCloseTo(view.scale, 10);
  });

  it('leaves the view entirely alone when centring is off', () => {
    expect(crossProbeViewChange(cfg({ center_on_items: false }), far, view, canvas)).toBeNull();
  });

  it('leaves the view alone with centring off even though zoom_to_fit is on', () => {
    // The nesting: zoom_to_fit is "ignored if center_on_items is off"
    // (app_settings.h:36), so this must not zoom-without-panning.
    expect(
      crossProbeViewChange(cfg({ center_on_items: false, zoom_to_fit: true }), far, view, canvas),
    ).toBeNull();
  });

  it('pans without re-zooming when zoom_to_fit is off', () => {
    const next = crossProbeViewChange(cfg({ zoom_to_fit: false }), far, view, canvas)!;
    expect(next).not.toBeNull();
    // Centred on the item, but at exactly the scale the user had.
    expect(next.cx).toBeCloseTo(pcbMmToIU(500.5), 0);
    expect(next.scale).toBe(view.scale);
  });

  it('zooms differently from not zooming, on the same probe', () => {
    const zoomed = crossProbeViewChange(cfg({ zoom_to_fit: true }), far, view, canvas)!;
    const panned = crossProbeViewChange(cfg({ zoom_to_fit: false }), far, view, canvas)!;
    expect(zoomed.scale).not.toBe(panned.scale);
  });

  it('leaves an item already on screen where the user put it', () => {
    // EDA_DRAW_FRAME::FocusOnLocation only recentres when the target is outside
    // the viewport shrunk by a tenth of its width.
    const near = {
      minX: pcbMmToIU(-0.5),
      minY: pcbMmToIU(-0.5),
      maxX: pcbMmToIU(0.5),
      maxY: pcbMmToIU(0.5),
    };
    const next = crossProbeViewChange(cfg({ zoom_to_fit: false }), near, view, canvas)!;
    expect(next.cx).toBe(view.cx);
    expect(next.cy).toBe(view.cy);
  });

  it('has nothing to aim at for a zero-area selection', () => {
    const flat = { minX: 0, minY: 0, maxX: 0, maxY: pcbMmToIU(5) };
    expect(crossProbeViewChange(cfg({}), flat, view, canvas)).toBeNull();
    expect(crossProbeViewChange(cfg({}), null, view, canvas)).toBeNull();
  });
});

// ----- auto_highlight ---------------------------------------------------------

describe('auto_highlight decides whether a net probe lights anything', () => {
  it('resolves the net name against the board when it is on', () => {
    expect(crossProbeHighlightNet(cfg({}), board, 'VCC')).toBe(2);
  });

  it('refuses the probe when it is off, leaving the current highlight lit', () => {
    // `if( !auto_highlight ) return;` fires before the highlight is touched
    // (cross-probing.cpp:140), so null must be distinguishable from 0.
    expect(crossProbeHighlightNet(cfg({ auto_highlight: false }), board, 'VCC')).toBeNull();
  });

  it('clears the highlight for a net the board does not have', () => {
    // netcode <= 0 falls through to `SetHighlight( false )`.
    expect(crossProbeHighlightNet(cfg({}), board, 'NOT_A_NET')).toBe(0);
    expect(crossProbeHighlightNet(cfg({}), board, null)).toBe(0);
  });
});

// ----- flash_selection --------------------------------------------------------

describe('flash_selection blinks the new selection three times', () => {
  const ids = ['footprint:0', 'footprint:1'];

  it('runs six visible toggles over three seconds', () => {
    // 500 ms an interval, phases 0..6 (pcb_edit_frame.cpp:677, :752).
    expect(CROSS_PROBE_FLASH_INTERVAL_MS).toBe(500);
    expect(CROSS_PROBE_FLASH_LAST_PHASE).toBe(6);
  });

  it('hides on the even phases and restores on the odd ones', () => {
    expect(crossProbeFlashSelection(0, ids)).toEqual([]);
    expect(crossProbeFlashSelection(1, ids)).toEqual(ids);
    expect(crossProbeFlashSelection(2, ids)).toEqual([]);
    expect(crossProbeFlashSelection(3, ids)).toEqual(ids);
  });

  it('leaves the items selected once the run is over', () => {
    // Whatever the parity of the last phase, the final state is selected.
    expect(crossProbeFlashSelection(CROSS_PROBE_FLASH_LAST_PHASE + 1, ids)).toEqual(ids);
  });

  it('blinks three times, which is what the tooltip promises', () => {
    // Phases 0..5 are the three visible hide/show pairs. Phase 6 hides too, but
    // upstream increments past 6 in the same tick and restores before the next
    // one, so it is not a fourth blink — it is the tail of the third.
    let blinks = 0;
    for (let p = 0; p < CROSS_PROBE_FLASH_LAST_PHASE; p++)
      if (crossProbeFlashSelection(p, ids).length === 0) blinks++;
    expect(blinks).toBe(3);
    expect(CROSS_PROBE_FLASH_LAST_PHASE * CROSS_PROBE_FLASH_INTERVAL_MS).toBe(3000);
  });
});

// ----- the wiring in PcbEditor ------------------------------------------------

/**
 * The pure functions above answer correctly; this checks the board editor
 * actually asks them, and asks with the right settings object.
 *
 * The file is read as text because `qa`'s tsconfig cannot compile a `.tsx`;
 * `clipboard_wired.test.ts` covers the same blind spot the same way. The failure
 * being guarded is silent: dropping a gate here leaves every unit test green
 * while the preference stops doing anything, which is how the group came to be
 * four disabled checkboxes in the first place.
 */
const PCB_EDITOR = readFileSync(
  fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
  'utf8',
);

describe('PcbEditor routes its cross-probes through the settings', () => {
  it('reads pcbnew’s copy, not the schematic’s', () => {
    // Upstream the frame that RECEIVES the probe owns the settings that decide
    // what it does (pcbnew/cross-probing.cpp:734 `GetPcbNewSettings()`), and
    // Select on PCB is received here.
    expect(PCB_EDITOR).toContain('settings.pcbnew.cross_probing');
    expect(PCB_EDITOR).not.toContain('settings.eeschema.cross_probing');
  });

  it('asks crossProbeSelection rather than selecting the parts directly', () => {
    expect(PCB_EDITOR).toContain('crossProbeSelection(');
    // The un-gated form must not survive anywhere in the editor.
    expect(PCB_EDITOR).not.toContain('findItemsFromSyncSelection(');
  });

  it('asks crossProbeHighlightNet rather than walking the net table itself', () => {
    expect(PCB_EDITOR).toContain('crossProbeHighlightNet(');
  });

  it('asks crossProbeViewChange rather than zooming unconditionally', () => {
    expect(PCB_EDITOR).toContain('crossProbeViewChange(');
    expect(PCB_EDITOR).not.toContain('crossProbeZoomScale(');
  });

  it('honours flash_selection on the timer it starts', () => {
    expect(PCB_EDITOR).toContain('cfg.flash_selection');
    expect(PCB_EDITOR).toContain('crossProbeFlashSelection(');
    expect(PCB_EDITOR).toContain('CROSS_PROBE_FLASH_INTERVAL_MS');
  });
});
