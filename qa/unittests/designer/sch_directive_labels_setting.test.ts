// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Display Options > "Show directive labels",
 * `EESCHEMA_SETTINGS::m_Appearance.show_directive_labels`
 * (`eeschema_settings.cpp:210-211`, default true).
 *
 * It was drawn and dead: the box stored a value and no painter read it. The
 * rule is one line of `SCH_PAINTER::draw( const SCH_DIRECTIVE_LABEL* )`:
 *
 *     if( !eeconfig()->m_Appearance.show_directive_labels && !aLabel->IsSelected() )
 *         return;                                    (sch_painter.cpp:3266-3267)
 *
 * — note the second half. A SELECTED directive label draws whatever the
 * setting says, which is what stops one disappearing under the pointer while
 * it is being edited. A port that only checked the flag would pass a naive
 * test and lose the label mid-drag.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

/** Records every colour that reached the canvas. */
function spy(): { colors: Set<string>; ctx: CanvasRenderingContext2D } {
  const colors = new Set<string>();
  const noop = (): void => {};
  const st = { strokeStyle: '', fillStyle: '' };
  const ctx = {
    get strokeStyle() {
      return st.strokeStyle;
    },
    set strokeStyle(v: string) {
      st.strokeStyle = v;
    },
    get fillStyle() {
      return st.fillStyle;
    },
    set fillStyle(v: string) {
      st.fillStyle = v;
    },
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeRect: noop,
    fill: () => colors.add(st.fillStyle),
    fillRect: () => colors.add(st.fillStyle),
    stroke: () => colors.add(st.strokeStyle),
  };
  return { colors, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** One netclass directive label on a wire, with a known uuid. */
const UUID = '00000000-0000-0000-0000-0000000000d1';
const DOC = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (wire (pts (xy 40 40) (xy 60 40)) (stroke (width 0.1524) (type solid)))
    (netclass_flag "HV" (length 2.54) (shape round) (at 50 40 0) (uuid "${UUID}")
      (effects (font (size 1.27 1.27)) (justify left))))`),
);

const paint = (showDirectiveLabels: boolean, selected?: string): Set<string> => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      DOC,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      900,
      600,
      selected === undefined ? undefined : new Set([selected]),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showDirectiveLabels,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.colors;
};

describe('the flag is drawn only when the setting says so', () => {
  it('draws it when the setting is on', () => {
    // LAYER_NETCLASS_REFS is the flag's own colour, and nothing else in this
    // document uses it — the wire is LAYER_WIRE.
    expect(paint(true)).toContain(KICAD_DEFAULT.netclassFlag);
  });

  it('drops it when the setting is off', () => {
    const off = paint(false);
    expect(off).not.toContain(KICAD_DEFAULT.netclassFlag);
    // ...and the rest of the sheet is untouched: the wire is still there.
    expect(off).toContain(KICAD_DEFAULT.wire);
  });

  it('draws it anyway while it is SELECTED, which is the second half of the rule', () => {
    // `&& !aLabel->IsSelected()`. Without this a label vanishes under the
    // pointer the moment it is picked up.
    expect(paint(false, UUID)).toContain(KICAD_DEFAULT.netclassFlag);
  });
});

describe('the default matches the PARAM, on both sides', () => {
  it('is true in the renderer and in the settings', () => {
    // `PARAM<bool>( "appearance.show_directive_labels", …, true )`.
    expect(DEFAULT_RENDER_OPTS.showDirectiveLabels).toBe(true);
    expect(EESCHEMA_DEFAULTS.appearance.show_directive_labels).toBe(true);
  });
});
