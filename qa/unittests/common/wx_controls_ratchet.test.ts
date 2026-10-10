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
  aRel.startsWith('common/wx/') || aRel === 'common/dialog_shim.tsx';

const KINDS = {
  button: /<button\b/g,
  checkbox: /type="checkbox"/g,
  select: /<select\b/g,
  frame: /className="ze-modal-header"/g,
} as const;
type Kind = keyof typeof KINDS;

/** Raw controls left, per folder. Lower a number when you remove some; never raise one. */
const BASELINE: Record<(typeof AREAS)[number], Record<Kind, number>> = {
  '3d-viewer': { button: 0, checkbox: 0, select: 0, frame: 0 },
  ai: { button: 7, checkbox: 0, select: 0, frame: 1 },
  bitmap2component: { button: 4, checkbox: 2, select: 0, frame: 0 },
  common: { button: 104, checkbox: 15, select: 0, frame: 15 },
  cvpcb: { button: 6, checkbox: 0, select: 0, frame: 2 },
  designer: { button: 120, checkbox: 5, select: 4, frame: 4 },
  eeschema: { button: 110, checkbox: 74, select: 26, frame: 1 },
  gerbview: { button: 11, checkbox: 4, select: 0, frame: 3 },
  pagelayout_editor: { button: 6, checkbox: 0, select: 0, frame: 1 },
  pcbnew: { button: 138, checkbox: 131, select: 16, frame: 5 },
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
  const counts: Record<Kind, number> = { button: 0, checkbox: 0, select: 0, frame: 0 };
  for (const file of tsxFiles(join(ROOT, aArea))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (EXEMPT(rel)) continue;
    const text = blankComments(readFileSync(file, 'utf8'));
    for (const kind of Object.keys(KINDS) as Kind[])
      counts[kind] += text.match(KINDS[kind])?.length ?? 0;
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
    const layer = readFileSync(join(ROOT, 'common/wx/controls.tsx'), 'utf8');
    expect(layer).toMatch(/<button\b/);
    expect(layer).toMatch(/type="checkbox"/);
    expect(readFileSync(join(ROOT, 'common/dialog_shim.tsx'), 'utf8')).toContain(
      'className="ze-modal-header"',
    );
  });
});
