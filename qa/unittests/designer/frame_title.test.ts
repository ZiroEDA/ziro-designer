// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The frame title, against every `SetTitle` in KiCad 10.0.5 that builds one.
 * The full survey is `docs/frame-titles.md`; the citations below are its rows.
 *
 * Twelve of the thirteen frames end `+= wxT( " — " ) + <Frame Name>` — an
 * em dash with a space either side. Ours wrote an ASCII hyphen at six call
 * sites and the em dash at two.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  FRAME_TITLE_SEPARATOR,
  frameTitle,
  frameTitleName,
  READ_ONLY_SUFFIX,
  UNSAVED_SUFFIX,
} from '@ziroeda/designer/src/ui/useDocumentTitle.js';
import { gerbviewFrameTitle } from '@ziroeda/designer/src/editors/gerbview/gerberAuxControls.js';
import type { GERBER_FILE_IMAGE } from '@ziroeda/gerbview';

describe('the separator', () => {
  /** `wxT( " — " )`, U+2014 with one ASCII space either side. */
  it('is an em dash with a space either side, not a hyphen', () => {
    expect(FRAME_TITLE_SEPARATOR).toBe(' — ');
    expect(FRAME_TITLE_SEPARATOR).not.toContain('-');
    expect([...FRAME_TITLE_SEPARATOR]).toEqual([' ', '—', ' ']);
  });
});

describe('frameTitle', () => {
  /** `pcb_edit_frame.cpp:2180-2192` — the general shape. */
  it('is star, document, suffixes, dash, frame name', () => {
    const t = frameTitle({
      frameName: 'PCB Editor',
      document: 'board',
      modified: true,
      suffixes: [READ_ONLY_SUFFIX],
    });
    expect(t.full).toBe('*board [Read Only] — PCB Editor');
  });

  /** `if( IsContentModified() ) title = wxT( "*" ); title += fn.GetName();` */
  it('puts the star straight against the name, with no space', () => {
    const t = frameTitle({ frameName: 'X', document: 'doc', modified: true });
    expect(t.full.startsWith('*doc')).toBe(true);
  });

  /** `title += wxS( " " ) + _( "[Read Only]" )` — the suffix owns its space. */
  it('gives each suffix its own leading space, in the order given', () => {
    const t = frameTitle({
      frameName: 'X',
      document: 'doc',
      suffixes: [READ_ONLY_SUFFIX, UNSAVED_SUFFIX],
    });
    expect(t.document).toBe('doc [Read Only] [Unsaved]');
  });

  /** `title = _( "[no schematic loaded]" ); ... title += " — " + name;` */
  it('substitutes a bracketed placeholder and still appends the dash', () => {
    const t = frameTitle({
      frameName: 'Schematic Editor',
      document: null,
      placeholder: '[no schematic loaded]',
    });
    expect(t.full).toBe('[no schematic loaded] — Schematic Editor');
  });

  /**
   * The Gerber Viewer / Image Converter branch: no document and no placeholder
   * means the frame name stands ALONE. `SetTitle( _( "Gerber Viewer" ) )` is one
   * string at `gerbview_frame.cpp:667`, and `bitmap2cmp_frame.cpp:357-360`
   * builds its `" — "` inside the non-empty branch.
   */
  it('prints the frame name alone, with no dash, when there is no placeholder', () => {
    const t = frameTitle({ frameName: 'Gerber Viewer', document: null });
    expect(t.full).toBe('Gerber Viewer');
    expect(t.separator).toBe('');
    expect(t.full).not.toContain('—');
  });

  /**
   * The exact bug this replaced. Passing the frame name as the placeholder
   * appends it twice — which is the "Gerber Viewer  -  Gerber Viewer" on the
   * 2026-08-20 capture.
   */
  it('does not repeat the frame name when the document is empty', () => {
    const t = frameTitle({ frameName: 'Gerber Viewer', document: null });
    expect(t.full.match(/Gerber Viewer/g)).toHaveLength(1);
  });

  it('ignores a whitespace-only document the way an empty one is ignored', () => {
    expect(frameTitle({ frameName: 'X', document: '   ' }).full).toBe('X');
  });

  it('drops the star when the document is modified but absent', () => {
    // There is no document half for a star to prefix.
    expect(frameTitle({ frameName: 'X', document: null, modified: true }).full).toBe('X');
  });
});

describe('frameTitleName, wxFileName::GetName', () => {
  /** Nine of the thirteen frames use GetName(), which drops the extension. */
  it('drops the extension', () => {
    expect(frameTitleName('board.kicad_pcb', '[none]')).toBe('board');
  });

  it('falls back to the placeholder when there is no name', () => {
    expect(frameTitleName('', '[no schematic loaded]')).toBe('[no schematic loaded]');
  });
});

describe('GerbView’s own two titles', () => {
  /**
   * Through `gerbviewFrameTitle`, the real call site, not through `frameTitle`
   * with hand-written arguments. That distinction is the point: while this
   * lived inside the `.tsx`, mutants that stripped the extension and that
   * dropped the X2 suffix both SURVIVED a sweep, with this very block claiming
   * to cover them.
   */
  const image = (fileName: string, fileFunction: string | null = null) =>
    ({ fileName, fileFunction }) as GERBER_FILE_IMAGE;

  /**
   * `title = filename.GetFullName();` (`gerbview_frame.cpp:684`) — WITH the
   * extension. GerbView and the Image Converter are the only two of the
   * thirteen frames that keep it, so a helper that always strips would be
   * wrong for both.
   */
  it('keeps the file extension, unlike nine of the thirteen frames', () => {
    expect(gerbviewFrameTitle(image('top.gbr')).full).toBe('top.gbr — Gerber Viewer');
    expect(gerbviewFrameTitle(image('top.gbr')).document).toBe('top.gbr');
  });

  /** `title += wxS( " " ) + _( "(with X2 attributes)" );` (`:686-688`). */
  it('flags an X2 file before the dash', () => {
    expect(gerbviewFrameTitle(image('top.gbr', 'Copper,L1,Top')).full).toBe(
      'top.gbr (with X2 attributes) — Gerber Viewer',
    );
  });

  /** m_IsX2_file is set only once a %TF FILE FUNCTION parses (`rs274x.cpp:390-397`). */
  it('does not flag a file with no file function', () => {
    expect(gerbviewFrameTitle(image('top.gbr')).full).not.toContain('X2');
  });

  /** `SetTitle( _("Gerber Viewer") );` (`:667`) — one string, no dash. */
  it('is the bare frame name with nothing loaded', () => {
    const t = gerbviewFrameTitle(null);
    expect(t.full).toBe('Gerber Viewer');
    expect(t.separator).toBe('');
    expect(t.document).toBe('');
  });

  /**
   * The document half is the ACTIVE LAYER's file name. Ours passed the project
   * name, which this title has nothing to do with.
   */
  it('follows the active image, so switching layer changes the title', () => {
    expect(gerbviewFrameTitle(image('top.gbr')).document).toBe('top.gbr');
    expect(gerbviewFrameTitle(image('bottom.gbl')).document).toBe('bottom.gbl');
  });
});

// ---------------------------------------------------------------------------
// the source sweep
// ---------------------------------------------------------------------------

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

function sources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p))
        out.push({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') });
    }
  })(SRC);
  return out;
}

/**
 * Every place a title is assembled with an ASCII hyphen, ONE ROW PER
 * OCCURRENCE.
 *
 * CLAUDE.md lists "a file-level check where the rule is per-occurrence" as one
 * of the four shapes of test that cannot fail, so this does not ask whether a
 * FILE contains a hyphen title — it lists each one, with its line, and compares
 * the whole list. A second hyphen appearing in an already-listed file fails,
 * which a `toContain` on the file would not catch.
 */
const HYPHEN_TITLE = /&nbsp;-&nbsp;/g;

function hyphenTitleSites(): string[] {
  const sites: string[] = [];
  for (const { rel, text } of sources()) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const _ of line.matchAll(HYPHEN_TITLE)) sites.push(`${rel}:${i + 1}`);
    });
  }
  return sites.sort();
}

describe('the hyphen titles still to migrate', () => {
  /**
   * Six call sites wrote `&nbsp;-&nbsp;<Frame Name>` where upstream writes an
   * em dash. GerbView's is gone; the rest are a separate pass, and this list is
   * the checklist for it. It fails on a NEW one and on a STALE one, so removing
   * a site means lowering this list in the same commit.
   */
  it('are exactly these, and gerbview is no longer among them', () => {
    expect(hyphenTitleSites()).toEqual([
      'editors/footprint/FootprintEditor.tsx:1136',
      'editors/pcb/PcbEditor.tsx:7515',
      'editors/pcb/PcbEditor.tsx:8302',
      'editors/schematic/SchematicEditor.tsx:7214',
      'editors/symbol/SymbolEditor.tsx:1696',
    ]);
  });

  it('does not include any gerbview file', () => {
    expect(hyphenTitleSites().filter((s) => s.startsWith('editors/gerbview/'))).toEqual([]);
  });
});
