// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every dialog is built from the central wx layer, as every KiCad dialog derives from
 * DIALOG_SHIM and is made of wx controls - it fills in data, it does not draw its own window.
 *
 * The layer is `common/wx/` (Button, CheckBox, StaticLine, HyperlinkCtrl, Combo...) and
 * `common/dialog_shim.tsx` (DialogShim, StdDialogButtons). Anywhere else, each of these is a
 * hand-built copy of something the layer owns:
 *
 *   button     a raw `<button>`            - wxButton is `Button`
 *   checkbox   a raw `type="checkbox"`     - wxCheckBox is `CheckBox`
 *   select     a native `<select>`         - wxChoice is `Combo`
 *   frame      a hand-written title bar    - DIALOG_SHIM's window is `DialogShim`
 *   radio      a raw `type="radio"`        - wxRadioButton is `RadioButton`
 *   entry      a raw text `<input>` or `<textarea>` - wxTextCtrl is `TextCtrl`
 *   sbox       a hand-written `<fieldset>` - wxStaticBoxSizer's box is `StaticBox`
 *
 * The numbers are a ratchet, counted per occurrence and per top-level folder: they may only go
 * down. A new raw control fails here; removing some fails until the baseline is lowered, so the
 * number in this file is always the true one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const AREAS = [
  '3d-viewer',
  'ai',
  'bitmap2component',
  'common',
  'cvpcb',
  'designer',
  'eeschema',
  'gerbview',
  'pagelayout_editor',
  'pcbnew',
] as const;

/** The wx layer itself. */
const EXEMPT = (aRel: string): boolean =>
  aRel.startsWith('external/wx/') || aRel === 'common/dialog_shim.tsx';

const KINDS = {
  button: /<button\b/g,
  checkbox: /type="checkbox"/g,
  select: /<select\b/g,
  frame: /className="ze-modal-header"/g,
  radio: /type="radio"/g,
  entry: null,
  sbox: /<fieldset\b/g,
} as const;
type Kind = keyof typeof KINDS;

/**
 * Text entries: every text-like `<input .../>` and every `<textarea>`. A file, colour or range
 * input is not a wxTextCtrl - a hidden file input is browser plumbing, the other two are the
 * colour swatch and slider widgets - so they do not count.
 */
function countEntries(aText: string): number {
  let n = aText.match(/<textarea\b/g)?.length ?? 0;
  for (const tag of aText.match(/<input\b[\s\S]*?\/>/g) ?? [])
    if (!/type="(?:checkbox|radio|file|color|range|hidden|submit|button)"/.test(tag)) n++;
  return n;
}

/** Raw controls left, per folder. Lower a number when you remove some; never raise one. */
const BASELINE: Record<(typeof AREAS)[number], Record<Kind, number>> = {
  '3d-viewer': { button: 0, checkbox: 0, select: 0, frame: 0, radio: 0, entry: 0, sbox: 0 },
  ai: { button: 7, checkbox: 0, select: 0, frame: 1, radio: 0, entry: 1, sbox: 0 },
  bitmap2component: { button: 4, checkbox: 0, select: 0, frame: 0, radio: 0, entry: 0, sbox: 4 },
  // 10-10 tree move: button 47 -> 45 (the menu drawing went down into external/wx); checkbox
  // 8 -> 9 and radio 2 -> 3 are the Preferences kit's Check/Radio, out of the exempt wx layer into
  // common/dialogs/pref_controls.tsx - not new controls, now counted; the sweep deletes the kit.
  // entry 22 -> 21 (10-21): EDA_LIST_DIALOG's filter and name boxes are TextCtrls.
  common: { button: 41, checkbox: 8, select: 0, frame: 1, radio: 3, entry: 21, sbox: 4 },
  cvpcb: { button: 0, checkbox: 0, select: 0, frame: 1, radio: 0, entry: 1, sbox: 0 },
  designer: { button: 75, checkbox: 2, select: 0, frame: 0, radio: 5, entry: 23, sbox: 13 },
  // checkbox 15 -> 12 (10-15): the record Symbol Fields Table's grid checkboxes.
  // 10-20: checkbox 12 -> 11, the schematic Plot dialog's 'Download a copy' box went with the
  // project route (plots download now); button 9 -> 8, its output-folder browse went too.
  // checkbox 11 -> 9, select 6 -> 2, entry 22 -> 7, sbox 11 -> 9 (10-23): the record Symbol
  // Editor's hand-built dialogs (symbol_editor_dialogs.tsx), deleted for the live window's _base pairs.
  // select 2 -> 0, frame 1 -> 0, entry 7 -> 5 (10-24): the record Symbol Library Browser - its unit
  // and body-style <select>s, its modal and its two filter <input>s - for SYMBOL_VIEWER_FRAME's
  // window on wxChoice / wxSearchCtrl.
  eeschema: { button: 8, checkbox: 9, select: 0, frame: 0, radio: 1, entry: 4, sbox: 9 },
  // checkbox 3 -> 2 (10-12): Print on DIALOG_PRINT_GENERIC_BASE.
  gerbview: { button: 3, checkbox: 2, select: 0, frame: 0, radio: 0, entry: 2, sbox: 2 },
  pagelayout_editor: { button: 4, checkbox: 0, select: 0, frame: 0, radio: 0, entry: 3, sbox: 1 },
  // +9 buttons, +6 checkboxes, +3 frames (10-10): pcb-exports' IPC-2581, ODB++ and VRML export
  // dialogs, merged in after being written before this ratchet existed; their session owns them
  // and moves them onto DialogShim. Not a licence: no other number here has ever gone up.
  // 10-10: the three export dialogs (IPC-2581, ODB++, VRML) on the sizers - 92/64/4/42 before.
  // ... then the drill and position-file dialogs: button 83 -> 81, entry 34 -> 31.
  // ... then DIALOG_PLOT: button 81 -> 79, checkbox 58 -> 42, entry 31 -> 30, sbox 61 -> 54.
  // 10-11: Pad Properties on its _base pair - button 73 -> 70, checkbox 41 -> 39, sbox 45 -> 38;
  // then DRC on its pair - button 70 -> 69.
  // then Push Pad / Swap Layers / Enumerate Pads / Target Properties - button 67, entry 28.
  // then the batch-2 pairs - button 61, checkbox 36, entry 27.
  // then the batch-3 pairs - button 55, checkbox 33, entry 25, sbox 37.
  // then the batch-4 pairs - checkbox 31, entry 24.
  // then the batch-5 pairs - button 51, checkbox 28, entry 23, sbox 32.
  // then Copper Zones and its panel - button 48, checkbox 27, entry 20, sbox 31.
  // then Non-Copper Zones, Rule Area and Position Relative - button 46, checkbox 25, entry 16.
  // then Find, Exchange Footprints, Tuning Pattern and Pad Table - checkbox 24, radio 3.
  // then Global Edit Tracks & Vias and Text & Graphics - checkbox 20, entry 15.
  // then Global Edit Teardrops - button 45, checkbox 18.
  // then Barcode, Layer Selection, GenCAD, Print, Text, Text Box, Dimension.
  // then Shape, Import Graphics, Convert Settings, Complex Shape: no raw select or radio left.
  // then Create Array, 3D Models panel, footprint editor properties, Zone Manager.
  // then Board Statistics; Table Cell and Reannotate are new pairs.
  // then the Custom Rules page.
  pcbnew: { button: 10, checkbox: 6, select: 0, frame: 1, radio: 0, entry: 1, sbox: 0 },
};

function tsxFiles(aDir: string, aOut: string[] = []): string[] {
  for (const name of readdirSync(aDir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(aDir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, aOut);
    else if (name.endsWith('.tsx')) aOut.push(path);
  }
  return aOut;
}

/** Comments name controls without being them. */
function blankComments(aText: string): string {
  return aText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function countRawControls(aArea: string): Record<Kind, number> {
  const counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0])) as Record<Kind, number>;
  for (const file of tsxFiles(join(ROOT, aArea))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (EXEMPT(rel)) continue;
    const text = blankComments(readFileSync(file, 'utf8'));
    for (const kind of Object.keys(KINDS) as Kind[]) {
      const re = KINDS[kind];
      counts[kind] += re ? (text.match(re)?.length ?? 0) : countEntries(text);
    }
  }
  return counts;
}

describe('dialogs are built from the central wx layer', () => {
  const now = Object.fromEntries(AREAS.map((a) => [a, countRawControls(a)])) as typeof BASELINE;

  it('no folder gains a raw control the wx layer owns', () => {
    const grew: string[] = [];
    for (const area of AREAS)
      for (const kind of Object.keys(KINDS) as Kind[])
        if (now[area][kind] > BASELINE[area][kind])
          grew.push(`${area}: ${now[area][kind]} raw ${kind} against ${BASELINE[area][kind]}`);
    expect(grew, 'use common/wx (Button, CheckBox, Combo) and DialogShim').toEqual([]);
  });

  it('and a pass that removes some lowers the number here', () => {
    const fell: string[] = [];
    for (const area of AREAS)
      for (const kind of Object.keys(KINDS) as Kind[])
        if (now[area][kind] < BASELINE[area][kind])
          fell.push(
            `${area}: ${now[area][kind]} raw ${kind} now, baseline says ${BASELINE[area][kind]}`,
          );
    expect(fell, 'lower the baseline').toEqual([]);
  });

  it('the wx layer is where the controls live', () => {
    // A ratchet over the wrong tree passes forever: the exempt layer must hold the real ones.
    const layer = readFileSync(join(ROOT, 'external/wx/controls.tsx'), 'utf8');
    expect(layer).toMatch(/<button\b/);
    expect(layer).toMatch(/type="checkbox"/);
    expect(layer).toMatch(/type="radio"/);
    expect(layer).toMatch(/<textarea\b/);
    expect(layer).toMatch(/<fieldset\b/);
    expect(readFileSync(join(ROOT, 'external/wx/dialog.tsx'), 'utf8')).toContain(
      'className="ze-modal-header"',
    );
  });
});
