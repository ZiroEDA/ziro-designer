// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME::updateTitle` (eeschema/sch_edit_frame.cpp:1819-1862).
 *
 * The editor used to build this string inline as
 * `*<projectName>&nbsp;-&nbsp;Schematic Editor`, which was wrong in six ways at
 * once: the project name instead of the sheet's file, the extension kept, no
 * sheet-path bracket, no read-only suffix, the wrong empty-state placeholder,
 * and an ASCII hyphen where upstream writes an em dash.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fileBaseName,
  pathHumanReadable,
  SCH_FRAME_NAME,
  SCH_NO_DOCUMENT,
  schFrameTitle,
} from '@ziroeda/designer/src/editors/schematic/frame_title.js';

describe('pathHumanReadable', () => {
  /**
   * `PathHumanReadable( false, … )` seeds with the root screen's `GetName()`
   * rather than a bare "/", so the root sheet's path is the root file's base
   * name and nothing else.
   */
  it('is the root file base name alone at the root', () => {
    expect(pathHumanReadable('ecc83', [])).toBe('ecc83');
  });

  /** `s << sheetName << "/"` per sheet, then the trailing separator stripped. */
  it('appends each sheet name below the root, separated by slashes', () => {
    expect(pathHumanReadable('ecc83', ['Power'])).toBe('ecc83/Power');
    expect(pathHumanReadable('ecc83', ['Power', 'Filter'])).toBe('ecc83/Power/Filter');
  });

  /** `aStripTrailingSeparator = true` — no trailing slash on any of them. */
  it('never ends in a separator', () => {
    for (const names of [[], ['A'], ['A', 'B']]) {
      expect(pathHumanReadable('root', names).endsWith('/')).toBe(false);
    }
  });
});

describe('fileBaseName', () => {
  /** `wxFileName::GetName()` drops the last extension. */
  it('drops the extension', () => {
    expect(fileBaseName('ecc83.kicad_sch')).toBe('ecc83');
    expect(fileBaseName('two.dots.kicad_sch')).toBe('two.dots');
  });

  /** A leading dot is not an extension. */
  it('keeps a leading dot', () => {
    expect(fileBaseName('.hidden')).toBe('.hidden');
  });

  it('leaves an extensionless name alone', () => {
    expect(fileBaseName('ecc83')).toBe('ecc83');
  });
});

describe('schFrameTitle', () => {
  /**
   * `if( sheetPath != fn.GetName() ) title += " [" + sheetPath + "]"`
   * (:1846-1848). On the ROOT sheet the two are equal, so the bracket is
   * suppressed — the state the title is in most of the time.
   */
  it('carries no sheet-path bracket on the root sheet', () => {
    const t = schFrameTitle({
      fileName: 'ecc83.kicad_sch',
      sheetPath: pathHumanReadable('ecc83', []),
    });
    expect(t.full).toBe('ecc83 — Schematic Editor');
    expect(t.full).not.toContain('[');
  });

  /** Descend one sheet and BOTH halves change: the file, and the bracket. */
  it('names the sub-sheet file and brackets its path on a sub-sheet', () => {
    const t = schFrameTitle({
      fileName: 'power.kicad_sch',
      sheetPath: pathHumanReadable('ecc83', ['Power']),
    });
    expect(t.full).toBe('power [ecc83/Power] — Schematic Editor');
  });

  /** `if( IsContentModified() ) title = wxT( "*" ); title += fn.GetName();` */
  it('puts the star straight against the name', () => {
    const t = schFrameTitle({ fileName: 'ecc83.kicad_sch', modified: true });
    expect(t.full).toBe('*ecc83 — Schematic Editor');
    expect(t.modified).toBe('*');
  });

  /** `title += wxS( " " ) + _( "[Read Only]" )` — after the bracket, not before. */
  it('appends [Read Only] after the sheet-path bracket', () => {
    const t = schFrameTitle({
      fileName: 'power.kicad_sch',
      sheetPath: 'ecc83/Power',
      readOnly: true,
      modified: true,
    });
    expect(t.full).toBe('*power [ecc83/Power] [Read Only] — Schematic Editor');
  });

  it('omits [Read Only] when the document is writable', () => {
    const t = schFrameTitle({ fileName: 'ecc83.kicad_sch', readOnly: false });
    expect(t.full).not.toContain('[Read Only]');
  });

  /**
   * `title = _( "[no schematic loaded]" )` — and the dash is still appended.
   *
   * Spelled out rather than interpolated from `SCH_NO_DOCUMENT`. Writing
   * `` `${SCH_NO_DOCUMENT} — ${SCH_FRAME_NAME}` `` here is CLAUDE.md's first
   * shape of test that cannot fail — an expectation computed by calling the
   * code under test — and it was not hypothetical: a mutant that changed the
   * constant back to `'No project'` was the ONE survivor of this file's
   * mutation sweep, because it moved both sides of the comparison at once.
   */
  it('uses the bracketed placeholder with no document', () => {
    expect(schFrameTitle({ fileName: null }).full).toBe('[no schematic loaded] — Schematic Editor');
    expect(schFrameTitle({ fileName: '   ' }).full).toBe(
      '[no schematic loaded] — Schematic Editor',
    );
    expect(SCH_NO_DOCUMENT).toBe('[no schematic loaded]');
  });

  /** `title += wxT( " — " )` — an em dash, never a hyphen. */
  it('separates with an em dash', () => {
    const t = schFrameTitle({ fileName: 'ecc83.kicad_sch' });
    expect(t.separator).toBe(' — ');
    expect(t.full).not.toContain(' - ');
  });

  /** The frame name half, `_( "Schematic Editor" )`. */
  it('names the frame', () => {
    expect(SCH_FRAME_NAME).toBe('Schematic Editor');
    expect(schFrameTitle({ fileName: 'x.kicad_sch' }).frameName).toBe('Schematic Editor');
  });
});

/**
 * The editor has to actually USE the builder above. A title assembled inline
 * again would pass every case in this file, because none of them can see the
 * component — so this reads the source.
 */
describe('the editor builds its title through the shared rule', () => {
  const SRC = fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  );
  const text = (): string => readFileSync(SRC, 'utf8');

  it('renders the parts schFrameTitle returns', () => {
    const s = text();
    expect(s).toContain('schFrameTitle({');
    expect(s).toContain('{schTitle.separator}');
    expect(s).toContain('{schTitle.frameName}');
  });

  /** The old title, and the reason `frame_title.test.ts`'s ratchet drops to 4. */
  it('no longer hand-writes a hyphen title', () => {
    expect(text()).not.toContain('&nbsp;-&nbsp;');
  });

  /** Every other editor claims the tab; this one did not. */
  it('claims the browser tab', () => {
    expect(text()).toContain("useDocumentTitle('schematic'");
  });
});
