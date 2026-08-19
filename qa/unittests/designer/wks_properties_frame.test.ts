// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_FRAME` (pagelayout_editor/dialogs/properties_frame.cpp) — which
 * of its fields are range-checked, and what every row is called.
 *
 * The audit found no validation at all on our side: any finite number was
 * applied, an emptied field became 0, and the sheet's default text size could
 * be set to 0 — which upstream refuses, because a 0 default has nothing left
 * to fall back to.
 *
 * `properties_frame.cpp` checks exactly five fields and leaves the rest alone
 * on purpose (the four page margins, both positions, the text constraints and
 * the repeat steps take whatever is typed). Getting that list right in both
 * directions is the point of this file: a range added where upstream has none
 * is as wrong as a range missing where it has one.
 *
 * WHAT THIS FILE CANNOT DO: there is no DOM test environment in this repo, so
 * it cannot type into a field and watch the box appear. It reads the panel's
 * declarations; the behaviour behind them is tested over the pure functions in
 * `unit_binder.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx');

/** Every `<UnitField …/>` in the panel, keyed by the model value it edits. */
const FIELDS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const tag of PANEL.split('<UnitField').slice(1)) {
    const body = tag.slice(0, tag.indexOf('/>'));
    const value = /value=\{([^}]*)\}/.exec(body)?.[1];
    if (value) out[value] = body;
  }
  return out;
})();

/** The `range={…}` a field declares, or `''` when it declares none. */
const rangeOf = (value: string): string => {
  const body = FIELDS[value];
  expect(body, `no UnitField edits ${value}`).toBeDefined();
  return /range=\{(\w+)\}/.exec(body as string)?.[1] ?? '';
};

describe('validateMM call sites', () => {
  it('checks an item’s pen width against 0..10 mm', () => {
    // properties_frame.cpp:529 — validateMM( m_lineWidth, 0.0, 10.0 ), for
    // line, rect, text and polygon alike (m_lineWidth is one binder).
    expect(rangeOf('shape.lineWidth')).toBe('LINE_WIDTH_RANGE');
    expect(rangeOf('t.lineWidth')).toBe('LINE_WIDTH_RANGE');
    expect(rangeOf('poly.lineWidth')).toBe('LINE_WIDTH_RANGE');
  });

  it('checks an item’s text size against 0..100 mm', () => {
    // :611 and :614 — 0.0 to DLG_MAX_TEXTSIZE. Zero is legal and means
    // "use the sheet default".
    expect(rangeOf('t.fontW')).toBe('ITEM_TEXT_SIZE_RANGE');
    expect(rangeOf('t.fontH')).toBe('ITEM_TEXT_SIZE_RANGE');
  });

  it('checks the sheet’s default line width against 0..10 mm', () => {
    // :204 — validateMM( m_defaultLineWidth, 0.0, 10.0 ).
    expect(rangeOf('setup.lineWidth')).toBe('LINE_WIDTH_RANGE');
  });

  it('checks the sheet’s default text size against 0.01..100 mm', () => {
    // :207 and :210 — DLG_MIN_TEXTSIZE, not 0. This is the one that stops an
    // emptied field zeroing the default.
    expect(rangeOf('setup.textW')).toBe('DEFAULT_TEXT_SIZE_RANGE');
    expect(rangeOf('setup.textH')).toBe('DEFAULT_TEXT_SIZE_RANGE');
  });

  it('checks the sheet’s default text thickness against 0..5 mm', () => {
    // :213 — validateMM( m_defaultTextThickness, 0.0, 5.0 ).
    expect(rangeOf('setup.textLineWidth')).toBe('DEFAULT_TEXT_THICKNESS_RANGE');
  });

  it('spells the five ranges the way properties_frame.cpp does', () => {
    expect(PANEL).toContain('const DLG_MIN_TEXTSIZE = 0.01;');
    expect(PANEL).toContain('const DLG_MAX_TEXTSIZE = 100.0;');
    expect(PANEL).toContain('const LINE_WIDTH_RANGE: UnitRange = { min: 0.0, max: 10.0 };');
    expect(PANEL).toContain(
      'const ITEM_TEXT_SIZE_RANGE: UnitRange = { min: 0.0, max: DLG_MAX_TEXTSIZE };',
    );
    expect(PANEL).toContain(
      'const DEFAULT_TEXT_SIZE_RANGE: UnitRange = { min: DLG_MIN_TEXTSIZE, max: DLG_MAX_TEXTSIZE };',
    );
    expect(PANEL).toContain(
      'const DEFAULT_TEXT_THICKNESS_RANGE: UnitRange = { min: 0.0, max: 5.0 };',
    );
  });
});

describe('the fields upstream deliberately does NOT check', () => {
  it('leaves the four page margins unvalidated', () => {
    // CopyPrmsFromPanelToGeneral (:216-219) assigns all four with no
    // validateMM call. A range here would refuse layouts KiCad accepts.
    for (const m of [
      'setup.leftMargin',
      'setup.rightMargin',
      'setup.topMargin',
      'setup.bottomMargin',
    ])
      expect(rangeOf(m)).toBe('');
  });

  it('leaves positions, constraints and repeat steps unvalidated', () => {
    // :535-556 assign m_textPos*/m_textEnd*/m_textStep* straight through, and
    // :617-618 the two m_constraint* binders.
    for (const v of ['point.x', 'point.y', 't.maxlen', 't.maxheight', 'item.incrx', 'item.incry'])
      expect(rangeOf(v)).toBe('');
  });

  it('checks five fields and no more', () => {
    const withRange = Object.keys(FIELDS).filter((v) => rangeOf(v) !== '');
    expect(withRange.sort()).toEqual(
      [
        'poly.lineWidth',
        'setup.lineWidth',
        'setup.textH',
        'setup.textLineWidth',
        'setup.textW',
        'shape.lineWidth',
        't.fontH',
        't.fontW',
        't.lineWidth',
      ].sort(),
    );
  });
});

describe('a failed check is reported, not swallowed', () => {
  it('shows DisplayErrorMessage’s box', () => {
    // UNIT_BINDER::delayedFocusHandler calls DisplayErrorMessage, which is one
    // shared KICAD_MESSAGE_DIALOG (common/confirm.cpp) — so ours is the shared
    // ui/ dialog, not a box hand-rolled in this panel.
    expect(PANEL).toContain("import { MessageDialogError } from '../../ui/dialog_message.js'");
    expect(PANEL).toContain(
      '{error && <MessageDialogError message={error} onClose={() => setError(null)} />}',
    );
  });

  it('gives every validated field somewhere to report to', () => {
    for (const [value, body] of Object.entries(FIELDS)) {
      if (/range=\{/.test(body)) expect(body, value).toContain('onError={onError}');
    }
  });
});
