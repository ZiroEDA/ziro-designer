// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tools > Rescue Symbols reaches the editor, and behaves as `RescueProject`
 * does on the on-demand path.
 *
 * Read as source: `qa`'s tsconfig cannot compile a `.tsx`, which is the same
 * reason `clipboard_wired`, `canvas_props_wired` and `sch_swap_pins_wired`
 * read theirs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');
const MENUBAR = read('../../../designer/src/editors/schematic/menubar.ts');
const DIALOG = read('../../../designer/src/editors/schematic/dialogs/dialog_rescue_each.tsx');
const PANEL = read('../../../designer/src/editors/schematic/prefs/PanelEeschemaEditingOptions.tsx');
const ICONS = read('../../../designer/src/ui/icons.tsx');

describe('the menu entry', () => {
  it('is live, not a stub', () => {
    expect(MENUBAR).toContain("act('Rescue Symbols...', 'rescue', 'rescueSymbols')");
    expect(MENUBAR).not.toContain("stub('Rescue Symbols...')");
  });

  /** `.Icon( BITMAPS::rescue )` — the action carries one, so the menu shows one. */
  it('has the icon its action names', () => {
    expect(ICONS).toMatch(/^\s{2}rescue: \(/m);
  });

  it('reaches the handler', () => {
    expect(EDITOR).toContain("id === 'rescueSymbols'");
    expect(EDITOR).toContain('void runRescueSymbols()');
  });

  /** Remap Legacy Library Symbols stays a stub: it is the KiCad 4 path, and
   *  `HasNoFullyDefinedLibIds()` is never true for a `.kicad_sch`. */
  it('leaves Remap Legacy Library Symbols alone', () => {
    expect(MENUBAR).toContain("stub('Remap Legacy Library Symbols...')");
  });
});

describe('the on-demand path', () => {
  /**
   * `RescueProject( …, aRunningOnDemand )` only raises "This project has
   * nothing to rescue." when it is true, and from the Tools menu it always is.
   */
  it('reports an empty result, because it was asked for', () => {
    expect(EDITOR).toContain("setRescueMessage('This project has nothing to rescue.')");
  });

  it('reports a cancelled one too, as upstream does', () => {
    // "He might have clicked cancel by mistake, and should have some
    // indication of that."
    expect([...EDITOR.matchAll(/setRescueMessage\('No symbols were rescued\.'\)/g)]).toHaveLength(
      2,
    );
  });

  /** `aAskShowAgain = !aRunningOnDemand`. */
  it('hides Never Show Again, since the tool was run deliberately', () => {
    expect(EDITOR).toContain('askShowAgain={false}');
  });

  /** `PROJECT_SCH::LegacySchLibs`, which is the OTHER half of the comparison. */
  it('reads the project’s legacy cache library, so the other arms can fire', () => {
    expect(EDITOR).toContain('legacyCacheFileNames(');
    expect(EDITOR).toContain('readLegacySymbolLibrary(file.text)');
    expect(EDITOR).toContain('cache: legacyCache()');
    // The `.kicad_pro`'s name, not the root sheet's: `CacheName` takes
    // `aProject->GetProjectFullName()`.
    expect(EDITOR).toContain('/\\.kicad_pro$/i.test(f.name)');
  });

  it('runs the rescue anyway when that cache will not parse', () => {
    // `AddLibrary` throws, `LoadAllLibraries` logs and carries on.
    const at = EDITOR.indexOf('const legacyCache');
    expect(at).toBeGreaterThan(-1);
    expect(EDITOR.slice(at, at + 1400)).toContain('failed to load.');
    expect(EDITOR.slice(at, at + 1400)).toContain('return new Map();');
  });

  it('resolves each id through the library, never the sheet’s own cache', () => {
    const at = EDITOR.indexOf('const runRescueSymbols');
    expect(at).toBeGreaterThan(-1);
    const body = EDITOR.slice(at, at + 1400);
    expect(body).toContain('repairSourceLibs(');
    expect(body).toContain('loadSymbol,');
    // `hierarchyLibs` is built from `doc.libSymbols`, which is the other half
    // of the comparison; passing it would compare the cache against itself.
    expect(body).not.toContain('hierarchyLibs');
  });
});

describe('the rescue itself', () => {
  it('writes the library file and registers it in the project table', () => {
    expect(EDITOR).toContain('rescueLibraryFileName(project.current.root)');
    expect(EDITOR).toContain('rescueLibraryNickname(project.current.root)');
    expect(EDITOR).toContain('saveProjectSymLibTable(');
    expect(EDITOR).toContain('uri: `\\${KIPRJMOD}/${libFile}`');
  });

  /** `OpenRescueLibrary` copies an existing rescue library in first, "so we do
   *  not lose any previous rescues". */
  it('keeps what an earlier rescue already put in that library', () => {
    expect(EDITOR).toContain('readSymbolLib(parse(existing.text))');
    expect(EDITOR).toContain('!kept.some((k) => k.libId === d.libId)');
  });

  it('lands as one edit over every sheet it reaches', () => {
    expect(EDITOR).toContain('rescueDocumentCommand(chosen)');
    expect(EDITOR).toContain('if (edit.size > 0) runProject(edit)');
  });

  /** `m_frame->ClearUndoRedoList()` once the rescues are done. */
  it('clears the undo history afterwards', () => {
    expect(EDITOR).toContain('pendingClearHistory.current = true');
    expect(EDITOR).toContain('history.current.clear()');
  });
});

describe('the dialog', () => {
  /** `data.push_back( wxVariant( true ) )` — every row starts accepted. */
  it('starts every candidate accepted', () => {
    expect(DIALOG).toContain('new Set(candidates.map((c) => c.requestedId))');
  });

  it('offers the two previews the dialog is built around', () => {
    expect(DIALOG).toContain('Cached Symbol:');
    expect(DIALOG).toContain('Library Symbol:');
  });

  it('asks before Never Show Again, and then rescues nothing', () => {
    expect(DIALOG).toContain('Stop showing this tool?');
    expect(DIALOG).toContain("if (r === 'yes') onNeverShowAgain()");
  });

  it('passes on only the candidates still ticked', () => {
    expect(DIALOG).toContain('candidates.filter((c) => accepted.has(c.requestedId))');
  });
});

describe('the preference', () => {
  /**
   * It stays greyed, and the reason is now narrower than it was: the TOOL is
   * live, but this flag never gated the tool — `RescueSymbols` passes
   * `aRunningOnDemand = true` and does not read it.
   */
  it('is still disabled, and says why in terms of the prompt, not the tool', () => {
    const at = PANEL.indexOf('Never show Rescue Symbols tool');
    expect(at).toBeGreaterThan(-1);
    const props = PANEL.slice(at, PANEL.indexOf('/>', at));
    expect(props).toMatch(/\bdisabled\b/);
    expect(props).toContain('aRunningOnDemand = true');
  });

  it('no longer claims the tool itself can find nothing', () => {
    // The claim this replaced was wrong: it described LEGACY_RESCUER's
    // candidate finder, and the on-demand path uses SYMBOL_LIB_TABLE_RESCUER's.
    expect(PANEL).not.toContain('every candidate needs a `cache_match`');
  });
});
