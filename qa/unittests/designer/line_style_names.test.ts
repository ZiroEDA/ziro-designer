// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The line-style names come from one table, the way KiCad's do.
 *
 * KiCad declares `lineTypeNames` exactly once — `common/stroke_params.cpp:39` —
 * and every dialog in eeschema, pcbnew and the symbol editor fills its combo by
 * iterating that one map, then indexes back into it by the selection index. We
 * had eleven hand-written copies, and they had already drifted apart in three
 * separate ways:
 *
 *  - nine of them offered a leading "Default" entry that `lineTypeNames` does
 *    not contain. Upstream only `DIALOG_WIRE_BUS_PROPERTIES` offers one, it is
 *    `DEFAULT_WIRE_STYLE_LABEL`, and it is *appended* after the five
 *    (dialog_wire_bus_properties.cpp:56-59) — because only a wire or bus takes
 *    its style from its net class.
 *  - three of them showed the raw file token to the user, so the board's text
 *    box and table dialogs and the schematic's global-edit dialog listed
 *    "dash_dot_dot" where KiCad lists "Dash-Dot-Dot".
 *  - the leading "Default" also shifted every style by one against the C++
 *    combo index, which is the index the file format stores.
 *
 * The last `describe` is the one that matters most: it reads each call site and
 * fails if any of them grows its own list again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LINE_STYLE_LABEL,
  DEFAULT_WIRE_STYLE_LABEL,
  LINE_STYLE,
  LINE_STYLE_CHOICES,
  LINE_STYLE_NAMES,
  WIRE_STYLE_CHOICES,
  WIRE_STYLE_NAMES,
  lineStyleComboValue,
  lineStyleLabel,
} from '@ziroeda/common/src/stroke_params.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const D = '../../../designer/src/editors/';

/** Every place that used to carry its own copy of the list. */
const CALL_SITES: Record<string, string> = {
  'schematic/dialogs/dialog_shape_properties.tsx': read(
    `${D}schematic/dialogs/dialog_shape_properties.tsx`,
  ),
  'schematic/dialogs/dialog_line_properties.tsx': read(
    `${D}schematic/dialogs/dialog_line_properties.tsx`,
  ),
  'schematic/dialogs/dialog_text_properties.tsx': read(
    `${D}schematic/dialogs/dialog_text_properties.tsx`,
  ),
  'schematic/dialogs/dialog_table_properties.tsx': read(
    `${D}schematic/dialogs/dialog_table_properties.tsx`,
  ),
  'schematic/dialogs/dialog_global_edit_text_and_graphics.tsx': read(
    `${D}schematic/dialogs/dialog_global_edit_text_and_graphics.tsx`,
  ),
  'schematic/net_overrides.ts': read(`${D}schematic/net_overrides.ts`),
  'schematic/schematic_settings.ts': read(`${D}schematic/schematic_settings.ts`),
  'pcb/dialogs/dialog_graphic_properties.tsx': read(
    `${D}pcb/dialogs/dialog_graphic_properties.tsx`,
  ),
  'pcb/dialogs/dialog_textbox_properties.tsx': read(
    `${D}pcb/dialogs/dialog_textbox_properties.tsx`,
  ),
  'pcb/dialogs/dialog_table_properties.tsx': read(`${D}pcb/dialogs/dialog_table_properties.tsx`),
  // Was `pcb/PcbEditor.tsx`. The Line Style row moved with the rest of the PCB
  // property grid when pcbnew stopped keeping a private copy of
  // PROPERTIES_PANEL: the rows are built in the pcbnew package now, so that is
  // where the list is consumed and that is where this rule has to hold.
  'pcbnew/src/properties_panel.ts': read('../../../pcbnew/src/properties_panel.ts'),
  'symbol/components/dialogs.tsx': read(`${D}symbol/components/dialogs.tsx`),
};

describe('lineTypeNames (common/stroke_params.cpp:39)', () => {
  it('is the five styles, in map order, with the upstream display names', () => {
    expect(LINE_STYLE_NAMES.map((d) => d.label)).toEqual([
      'Solid',
      'Dashed',
      'Dotted',
      'Dash-Dot',
      'Dash-Dot-Dot',
    ]);
  });

  it('has no DEFAULT row: the map is keyed from SOLID = 0 up', () => {
    // A leading sixth entry would shift every style against the index the
    // dialogs use to read the selection back out (dialog_line_properties.cpp:140).
    expect(LINE_STYLE_NAMES.some((d) => d.style === LINE_STYLE.DEFAULT)).toBe(false);
    expect(LINE_STYLE_NAMES.some((d) => d.value === 'default')).toBe(false);
    expect(LINE_STYLE_NAMES).toHaveLength(5);
  });

  it('numbers the styles the way the file format does', () => {
    expect(LINE_STYLE_NAMES.map((d) => d.style)).toEqual([0, 1, 2, 3, 4]);
    expect(LINE_STYLE_NAMES.map((d) => d.value)).toEqual([
      'solid',
      'dash',
      'dot',
      'dash_dot',
      'dash_dot_dot',
    ]);
  });
});

describe('the wire/bus combo', () => {
  it('appends "Default" after the five, as DIALOG_WIRE_BUS_PROPERTIES does', () => {
    // dialog_wire_bus_properties.cpp:56-59 — the Append() comes after the loop.
    expect(WIRE_STYLE_NAMES).toHaveLength(6);
    expect(WIRE_STYLE_NAMES.at(-1)?.label).toBe(DEFAULT_WIRE_STYLE_LABEL);
    expect(WIRE_STYLE_NAMES.at(-1)?.value).toBe('default');
    expect(WIRE_STYLE_NAMES.slice(0, 5)).toEqual(LINE_STYLE_NAMES);
  });

  it('puts "Default" first in the properties manager, which registers it first', () => {
    // ENUM_MAP<WIRE_STYLE> — eeschema/sch_line.cpp:1234. Upstream really is
    // inconsistent about the position between the dialog and the panel.
    expect(WIRE_STYLE_CHOICES[0]).toEqual(['default', 'Default']);
  });
});

describe('a stroke with no style of its own', () => {
  it('selects Solid, because the combo cannot say DEFAULT', () => {
    // dialog_shape_properties.cpp:147, pcbnew/dialog_shape_properties.cpp:1132.
    expect(lineStyleComboValue('default')).toBe('solid');
    expect(lineStyleComboValue(undefined)).toBe('solid');
    expect(lineStyleLabel('default')).toBe(DEFAULT_WIRE_STYLE_LABEL);
    expect(DEFAULT_LINE_STYLE_LABEL).toBe('Solid');
  });

  it('leaves a style it does have alone', () => {
    for (const d of LINE_STYLE_NAMES) expect(lineStyleComboValue(d.value)).toBe(d.value);
  });
});

describe('the properties manager choices', () => {
  it('are ENUM_MAP<LINE_STYLE>: the five, no DEFAULT (common/eda_shape.cpp:2833)', () => {
    expect(LINE_STYLE_CHOICES).toEqual([
      ['solid', 'Solid'],
      ['dash', 'Dashed'],
      ['dot', 'Dotted'],
      ['dash_dot', 'Dash-Dot'],
      ['dash_dot_dot', 'Dash-Dot-Dot'],
    ]);
  });
});

describe('every dialog that lists line styles', () => {
  it('takes them from the shared table', () => {
    for (const [name, src] of Object.entries(CALL_SITES)) {
      expect(src, name).toMatch(/from '@ziroeda\/common\/src\/stroke_params\.js'/);
      expect(src, name).toMatch(/LINE_STYLE_NAMES|WIRE_STYLE_NAMES|LINE_STYLE_CHOICES/);
    }
  });

  it('does not restate the names itself', () => {
    // Any file that spells a display name out again has started a twelfth copy.
    for (const [name, src] of Object.entries(CALL_SITES)) {
      expect(src, name).not.toContain('Dash-Dot-Dot');
      expect(src, name).not.toContain("'dash_dot_dot'");
      expect(src, name).not.toContain('"dash_dot_dot"');
    }
  });

  it('offers "Default" only in the wire/bus dialog', () => {
    // DIALOG_WIRE_BUS_PROPERTIES is the only one upstream that can express it,
    // and ours lives in dialog_line_properties.tsx (see its header comment).
    for (const [name, src] of Object.entries(CALL_SITES)) {
      if (name === 'schematic/dialogs/dialog_line_properties.tsx') {
        expect(src, name).toContain('WIRE_STYLE_NAMES');
      } else {
        expect(src, name).not.toContain('WIRE_STYLE_NAMES');
      }
    }
  });

  it('shows the display name, never the raw file token', () => {
    // Three of them rendered the token straight into the <option>, so the
    // board's text box and table dialogs listed "dash_dot_dot" to the user.
    for (const [name, src] of Object.entries(CALL_SITES)) {
      for (const m of src.matchAll(/(?:LINE|WIRE)_STYLE_NAMES\.map\(/g)) {
        const body = src.slice(m.index, m.index + 220);
        expect(body, name).toContain('.label');
      }
    }
  });
});

describe('the global-edit dialog', () => {
  const SRC = CALL_SITES['schematic/dialogs/dialog_global_edit_text_and_graphics.tsx'] as string;

  it('appends "-- leave unchanged --" after the styles, not before', () => {
    // dialog_global_edit_text_and_graphics.cpp:96 appends INDETERMINATE_ACTION
    // to a choice already holding the five names (…_base.cpp:368).
    const body = SRC.slice(SRC.indexOf('const lineStyleChoice'));
    const styles = body.indexOf('LINE_STYLE_NAMES.map');
    const indeterminate = body.indexOf('<option value={INDETERMINATE}>');
    expect(styles).toBeGreaterThan(-1);
    expect(indeterminate).toBeGreaterThan(styles);
  });
});
