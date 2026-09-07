// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Common page's appearance settings, on the reader side.
 *
 * Each of these spent a long time written but not read — the control moved the
 * stored value and nothing anywhere asked for it, which looks exactly like a
 * working preference until you try it. So what is asserted here is the READING:
 * that the number the panel writes reaches the thing it is supposed to move.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOOLBAR_ICON_MAX,
  TOOLBAR_ICON_MIN,
  TOOLBAR_ICON_SIZES,
  applyCommonAppearance,
} from '@ziroeda/designer/src/ui/common_appearance.js';
import {
  COMMON_DEFAULTS,
  type CommonSettings,
  migrateCommonSettings,
  settings,
} from '@ziroeda/designer/src/prefs/settings.js';

const PANEL_SRC = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelCommonSettings.tsx'),
  'utf8',
);
import {
  HI_CONTRAST_FACTOR,
  edgeCutsContrastFactor,
  hiContrastColor,
  hiContrastFactorFor,
} from '@ziroeda/common/src/render_settings.js';
import { parseColor4d } from '@ziroeda/common/src/color4d.js';
import {
  GAL_SCREEN_DPI,
  scaleForZoomFactor,
  zoomFactorForScale,
} from '@ziroeda/designer/src/ui/status_format.js';
import { BASE_SCREEN_DPI } from '@ziroeda/designer/src/widgets/zoom_correction_ctrl.js';

/** Enough of an element for `applyCommonAppearance`; no DOM needed. */
function fakeRoot(): HTMLElement {
  const props = new Map<string, string>();
  return {
    dataset: {} as DOMStringMap,
    style: {
      setProperty: (k: string, v: string) => void props.set(k, v),
      getPropertyValue: (k: string) => props.get(k) ?? '',
    },
  } as unknown as HTMLElement;
}

beforeEach(() => {
  settings.common.appearance = structuredClone(COMMON_DEFAULTS.appearance);
});

describe('appearance.toolbar_icon_size', () => {
  it("is KiCad's own int, and the radios write the three values its panel writes", () => {
    // `PARAM<int>( "appearance.toolbar_icon_size", …, 24, 16, 64 )` and
    // `panel_common_settings.cpp:206-211`. It was an enum here, which made our
    // common.json something KiCad could not read.
    expect(COMMON_DEFAULTS.appearance.toolbar_icon_size).toBe(24);
    expect(TOOLBAR_ICON_SIZES).toEqual({ small: 16, normal: 24, large: 32 });
  });

  it('drives the token every toolbar metric derives from', () => {
    // `ACTION_TOOLBAR::AddAction` asks `KiBitmapBundleDef( icon, iconSize )` and
    // derives its padding from it; ours states that derivation once in CSS, so
    // this one property is the whole of the setting's effect.
    const root = fakeRoot();
    settings.common.appearance.toolbar_icon_size = TOOLBAR_ICON_SIZES.large;
    applyCommonAppearance(root);
    expect(root.style.getPropertyValue('--toolbar-icon-size')).toBe('32px');

    settings.common.appearance.toolbar_icon_size = TOOLBAR_ICON_SIZES.small;
    applyCommonAppearance(root);
    expect(root.style.getPropertyValue('--toolbar-icon-size')).toBe('16px');
  });

  it('honours a value that is none of the three, as the toolbars do', () => {
    // The panel's switch has no `default:`, so 40 leaves all three radios
    // unselected — and the toolbars still use 40.
    const root = fakeRoot();
    settings.common.appearance.toolbar_icon_size = 40;
    applyCommonAppearance(root);
    expect(root.style.getPropertyValue('--toolbar-icon-size')).toBe('40px');
  });

  it('clamps to the PARAM range rather than trusting the store', () => {
    // localStorage is editable by hand and survives across versions; a toolbar
    // button an inch tall is worse than one that ignores the setting.
    const root = fakeRoot();
    settings.common.appearance.toolbar_icon_size = 4000;
    applyCommonAppearance(root);
    expect(root.style.getPropertyValue('--toolbar-icon-size')).toBe(`${TOOLBAR_ICON_MAX}px`);

    settings.common.appearance.toolbar_icon_size = 1;
    applyCommonAppearance(root);
    expect(root.style.getPropertyValue('--toolbar-icon-size')).toBe(`${TOOLBAR_ICON_MIN}px`);
  });
});

describe('appearance.grid_striping', () => {
  it('is off by default, as PARAM<bool>( …, false ) says', () => {
    expect(COMMON_DEFAULTS.appearance.grid_striping).toBe(false);
    const root = fakeRoot();
    applyCommonAppearance(root);
    expect(root.dataset.gridStriping).toBeUndefined();
  });

  it('marks the root when on, and unmarks it again when turned off', () => {
    // The second half is the one that breaks: an attribute that is only ever
    // added leaves every grid striped for the rest of the session.
    const root = fakeRoot();
    settings.common.appearance.grid_striping = true;
    applyCommonAppearance(root);
    expect(root.dataset.gridStriping).toBe('1');

    settings.common.appearance.grid_striping = false;
    applyCommonAppearance(root);
    expect(root.dataset.gridStriping).toBeUndefined();
  });

  it('stripes the ODD grid rows, which is the even <tr>', () => {
    // `if( !( row % 2 ) ) return cellAttr.release();` — row 0 is left alone
    // "to allow for the header row" (`wx_grid.cpp:180-183`). Getting this
    // backwards is invisible until you compare against KiCad side by side.
    const css = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
    const rule = css
      .split('[data-grid-striping="1"] .ze-grid tbody tr:nth-child(even) > td {')[1]
      ?.split('}')[0];
    expect(rule, 'no striping rule').toBeDefined();
    // The colour is the cell token shifted, never a hex of its own:
    // `aBaseColor.ChangeLightness( 105 )` is 5% of white over it.
    expect(rule).toMatch(/color-mix\(in srgb, var\(--grid-cell-bg\) 95%, #fff\)/);
  });
});

describe('appearance.hicontrast_dimming_factor', () => {
  it("is a FRACTION in the store and a percentage in the field, as KiCad's is", () => {
    // `PARAM<double>( …, 0.8f )`, with `SetValue( factor * 100 )` and
    // `= percent / 100` around the control (`panel_common_settings.cpp:224-226`,
    // `:330-331`). We stored 80, which made `1.0 - factor` come out at -79 —
    // a mix clamped to zero, i.e. every inactive layer painted as bare
    // background. Invisible for as long as nothing read the setting.
    expect(COMMON_DEFAULTS.appearance.hicontrast_dimming_factor).toBe(0.8);
    expect(PANEL_SRC).toMatch(/hicontrast_dimming_factor \* 100/);
    expect(PANEL_SRC).toMatch(/hicontrast_dimming_factor = v \/ 100/);
  });

  it('converts a percentage already in the store, so a live board does not go blank', () => {
    // Anyone who has opened this app has 80 written down; `deepMerge` keeps it,
    // because it is a number where a number belongs.
    const stored = { appearance: { hicontrast_dimming_factor: 80 } } as unknown as CommonSettings;
    expect(migrateCommonSettings(stored, 4)).toBe(true);
    expect(stored.appearance.hicontrast_dimming_factor).toBeCloseTo(0.8, 10);

    // ...and a value that is already a fraction is left alone, twice over.
    const ok = { appearance: { hicontrast_dimming_factor: 0.4 } } as unknown as CommonSettings;
    expect(migrateCommonSettings(ok, 4)).toBe(false);
    expect(ok.appearance.hicontrast_dimming_factor).toBe(0.4);
    // 1.0 is a legal fraction AND the percentage meaning the same thing, so it
    // is the one value the migration must not touch.
    const one = { appearance: { hicontrast_dimming_factor: 1 } } as unknown as CommonSettings;
    migrateCommonSettings(one, 4);
    expect(one.appearance.hicontrast_dimming_factor).toBe(1);
  });

  it('is INVERTED on the way to the painter', () => {
    // `m_hiContrastFactor = 1.0f - hicontrast_dimming_factor`. Wiring the
    // setting straight through would run the control backwards and still look
    // plausible: 80 dimming and 80 surviving are both "a number near the top".
    expect(hiContrastFactorFor(0.8)).toBeCloseTo(0.2, 10);
    expect(hiContrastFactorFor(0.4)).toBeCloseTo(0.6, 10);
    // The shipped default is the constant the painters used to hardcode.
    expect(hiContrastFactorFor(COMMON_DEFAULTS.appearance.hicontrast_dimming_factor)).toBeCloseTo(
      HI_CONTRAST_FACTOR,
      10,
    );
  });

  it('dims by MIXING toward the background, not by going transparent', () => {
    // `color = color.Mix( backgroundColor, m_hiContrastFactor )`
    // (`pcb_painter.cpp:544`). The board renderer used `globalAlpha`, which
    // composites against whatever is underneath — so two dimmed layers
    // overlapping came out brighter than either, and the result was opaque
    // where KiCad's is a solid dimmed colour.
    const layer = parseColor4d('#ff0000');
    const bg = parseColor4d('#000000');
    const dim = hiContrastColor(layer, bg, 0.2);
    expect(dim.r).toBeCloseTo(0.2, 6);
    // Opacity is untouched: the layer keeps it and loses its saturation.
    expect(dim.a).toBeCloseTo(layer.a, 10);
  });

  it('floors Edge.Cuts at 0.3 so it survives a heavy dim', () => {
    // `dim_factor_Edge_Cuts = std::max( m_hiContrastFactor, 0.3f )`
    // (`pcb_painter.cpp:518`), and it applies in HIDDEN mode too — Edge.Cuts is
    // the one inactive layer that is never cleared.
    expect(edgeCutsContrastFactor(0.2)).toBeCloseTo(0.3, 10);
    expect(edgeCutsContrastFactor(0.6)).toBeCloseTo(0.6, 10);
  });
});

describe('appearance.zoom_correction_factor', () => {
  /**
   * `GAL::computeWorldScale` (`graphics_abstraction_layer.h:1066-1074`):
   *
   *     m_worldScale = m_screenDPI * m_worldUnitLength * m_zoomFactor;
   *     m_worldScale *= …zoom_correction_factor;
   *
   * The correction sits between the zoom factor and the world scale, which is
   * the whole design: the canvas scale moves so a millimetre drawn is a
   * millimetre measured, and the zoom the status bar reports does not.
   */
  const DPR = 1;

  it('scales the canvas and leaves the reported zoom alone', () => {
    const at = (f: number): number => {
      settings.common.appearance.zoom_correction_factor = f;
      // What `settings.subscribe` runs on a Preferences OK.
      applyCommonAppearance(fakeRoot());
      return scaleForZoomFactor(2, DPR);
    };
    const plain = at(1);
    const corrected = at(1.5);

    expect(corrected / plain).toBeCloseTo(1.5, 10);
    // ...and the zoom that scale reports back is still 2.00, not 3.00.
    expect(zoomFactorForScale(corrected, DPR)).toBeCloseTo(2, 10);
  });

  it('round-trips, so the zoom selector picks the entry it just set', () => {
    for (const f of [0.5, 1, 2.75]) {
      settings.common.appearance.zoom_correction_factor = f;
      applyCommonAppearance(fakeRoot());
      expect(zoomFactorForScale(scaleForZoomFactor(3.5, DPR), DPR), `factor ${f}`).toBeCloseTo(
        3.5,
        10,
      );
    }
  });

  it('ignores a stored value outside PARAM<double>( …, 1.0, 0.1, 10.0 )', () => {
    // A zero would divide the zoom readout by zero and print Infinity in the
    // status bar; localStorage is hand-editable and this is the only guard.
    settings.common.appearance.zoom_correction_factor = 0;
    applyCommonAppearance(fakeRoot());
    const zeroed = scaleForZoomFactor(2, DPR);
    settings.common.appearance.zoom_correction_factor = 1;
    applyCommonAppearance(fakeRoot());
    expect(zeroed).toBeCloseTo(scaleForZoomFactor(2, DPR), 10);
  });

  it('is ONE number shared with the ruler, not two copies of 91', () => {
    // `m_screenDPI` is what the world scale multiplies by AND what the
    // Scaling control divides a measured PPI by. They were written out
    // separately, so a change to either would have made the ruler measure one
    // thing and the board draw another.
    expect(BASE_SCREEN_DPI).toBe(GAL_SCREEN_DPI);
  });
});

describe('the board painter dims the way pcb_painter does', () => {
  /**
   * A source check, and file-level on purpose: what is being pinned is that
   * this renderer has no second, alpha-shaped way of dimming a layer. One
   * surviving `globalAlpha = 0.2` would be invisible in a unit test of the
   * colour helper and perfectly visible on a board.
   */
  const RENDER = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/pcb/renderBoard.ts'),
    'utf8',
  );

  it('mixes toward the background rather than reducing opacity', () => {
    expect(RENDER).toMatch(/hiContrastColor\(/);
    expect(RENDER).toMatch(/edgeCutsContrastFactor\(/);
    // The old shape: a per-layer opacity carrying the dimming factor.
    expect(RENDER).not.toMatch(/return opts\.contrastMode === 'dim' \? 0\.2 : 0;/);
  });

  it('takes the factor from the caller, defaulting to KiCad’s own fallback', () => {
    // `PCB_PAINTER` uses `1.0f - 0.8f` when there is no program object to ask
    // (`pcb_painter.cpp:178`), which is `HI_CONTRAST_FACTOR`.
    expect(RENDER).toMatch(/opts\.hiContrastFactor \?\? HI_CONTRAST_FACTOR/);
  });

  it('is passed by every frame that has a high-contrast mode', () => {
    for (const frame of [
      'designer/src/editors/pcb/PcbEditor.tsx',
      'designer/src/editors/footprint/FootprintEditor.tsx',
      'designer/src/editors/gerbview/GerberViewer.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), '..', frame), 'utf8');
      expect(src, frame).toMatch(
        /hiContrastFactorFor\(settings\.common\.appearance\.hicontrast_dimming_factor\)/,
      );
    }
  });
});
