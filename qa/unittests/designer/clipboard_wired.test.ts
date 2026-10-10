// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `SchematicEditor` hands the clipboard, and what it refuses to cut.
 *
 * `parsePastedText`'s options carry the three things `SCH_EDITOR_CONTROL::Paste`
 * reads off the frame — the paste mode the annotation toggle implies
 * (sch_editor_control.cpp:2203), the whole hierarchy that reference uniqueness
 * is measured against (:2222/:2249), and the project's annotation settings
 * (:2604-2606). All three default to something sane inside eeschema, which is
 * exactly what makes a missed call site invisible: plain Ctrl+V used to pass no
 * options at all, so it silently re-annotated with the wrong settings against
 * the wrong sheet set, and no type error or test said so.
 *
 * The file is read as text because `qa`'s tsconfig cannot compile a `.tsx`;
 * `canvas_props_wired.test.ts` covers the same blind spot the same way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITOR = readFileSync(
  fileURLToPath(new URL('../../../eeschema/sch_edit_frame_ui.tsx', import.meta.url)),
  'utf8',
);

describe('every paste path goes through pasteOptions()', () => {
  it('has the one record call site left, Import Sheet', () => {
    // Ctrl+V, Paste, Paste Special and Duplicate run the live SCH_EDITOR_CONTROL now.
    expect([...EDITOR.matchAll(/parsePastedText\(/g)].length).toBeGreaterThanOrEqual(1);
  });

  it('and not one of them calls parsePastedText without them', () => {
    // Each call is either `parsePastedText(text, doc, pasteOptions(...))` on one
    // line, or broken across lines with `pasteOptions(` as the third argument.
    const calls = [...EDITOR.matchAll(/parsePastedText\((?:[^()]|\([^()]*\))*\)/g)].map(
      (m) => m[0],
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) expect(call, call).toContain('pasteOptions(');
  });
});

describe('pasteOptions derives the mode from the annotation toggle', () => {
  it("is 'unique' with automatic annotation on and 'remove' with it off", () => {
    // `pasteMode = annotateAutomatic ? UNIQUE_ANNOTATIONS : REMOVE_ANNOTATIONS`
    // (:2203). With the toggle off KiCad clears the pasted designators rather
    // than renumbering them.
    expect(EDITOR).toMatch(
      /defaultMode: PasteMode = es\.annotation\.automatic \? 'unique' : 'remove'/,
    );
  });

  it('passes the hierarchy, not just the open sheet', () => {
    expect(EDITOR).toMatch(/hierarchy: annotateSheets\('all', true\)/);
  });

  it('and the project annotation settings and designator tracker', () => {
    const body = EDITOR.slice(EDITOR.indexOf('const pasteOptions = useCallback'));
    expect(body).toContain('setup.annotation.sortOrder');
    expect(body).toContain('setup.annotation.firstFreeAfter');
    expect(body).toContain('tracker');
  });
});

describe('the browser clipboard events run the live SCH_EDITOR_CONTROL', () => {
  // Cut, Copy and Paste are the live tool's, as pcbnew's frame wires them: doCopy carries a cut
  // sheet in m_supplementaryClipboard (:1667), so the record era's refusal to cut a sheet is gone.
  const handler = (aName: string): string => {
    const i = EDITOR.indexOf(`const ${aName} = (e: ClipboardEvent)`);
    expect(i, `the frame must install ${aName}`).toBeGreaterThan(-1);
    return EDITOR.slice(i, EDITOR.indexOf('\n    };', i));
  };

  it('copies and cuts through the live actions', () => {
    expect(handler('onCopy')).toContain('runLiveAction(ACTIONS.copy)');
    expect(handler('onCut')).toContain('runLiveAction(ACTIONS.cut)');
  });

  it('pastes the event\u2019s clipboard through the live Paste', () => {
    const body = handler('onPaste');
    expect(body).toContain('SetClipboardFromPaste(e.clipboardData)');
    expect(body).toContain('runLiveAction(ACTIONS.paste)');
  });

  it('leaves the system clipboard alone when the copy saved nothing', () => {
    expect(handler('onCopy')).toContain('if (!text) return;');
  });
});
