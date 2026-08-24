// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's library buffer, against `SYMBOL_LIBRARY_MANAGER`.
 *
 * Counterpart: `eeschema/symbol_library_manager.cpp` — NOT
 * `symbol_editor/lib_symbol_library_manager.cpp`, which is only the tree-sync
 * and CreateSymbol half of the class.
 *
 * Two of these pin data loss, not parity:
 *
 *   - revert-after-rename DELETED the symbol (`RevertSymbol`, :512-536)
 *   - deleting a base symbol ORPHANED its children (`removeChildSymbols`, :1276)
 *
 * Both are asserted on the buffer's observable contents afterwards — what is
 * still in the library and under which name — rather than on which branch ran.
 */
import { describe, expect, it } from 'vitest';
import { SymbolLibraryManager } from '@ziroeda/designer/src/editors/symbol/libraryManager.js';

/**
 * A library with a root `R` and two symbols derived from it, plus a chain
 * (`R_US` derives from `R_small`, which derives from `R`) so that a
 * grandchild's fate is part of the expectation and not just a direct child's.
 */
const LIB = `(kicad_symbol_lib (version 20231120) (generator "test")
  (symbol "R" (pin_numbers hide) (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
  (symbol "R_small" (extends "R")
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R_small" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
  (symbol "R_US" (extends "R_small")
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R_US" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
  (symbol "C"
    (property "Reference" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
)`;

const managerWithLib = (): SymbolLibraryManager => {
  const m = new SymbolLibraryManager();
  m.addProjectLibrary('Device', 'Device.kicad_sym', LIB);
  return m;
};

const names = (m: SymbolLibraryManager): string[] => m.symbolNames('Device').sort();

describe('RevertSymbol (symbol_library_manager.cpp:512-536)', () => {
  /**
   * ```cpp
   * if( original.GetName() != aSymbolName )
   *     UpdateSymbolAfterRename( &original, aSymbolName, aLibrary );
   * ```
   *
   * Renaming `C` to `C_big` and reverting must give `C` back. Ours looked the
   * original up under `C_big`, found nothing, and deleted the symbol.
   */
  it('renames a renamed symbol BACK rather than deleting it', () => {
    const m = managerWithLib();
    const c = m.getSymbol('Device', 'C')!;
    m.renameSymbol('Device', 'C', { ...c, libId: 'C_big' });
    expect(names(m)).toEqual(['C_big', 'R', 'R_US', 'R_small']);

    const reverted = m.revertSymbol('Device', 'C_big');
    // The symbol is BACK, under its original name, and still in the library.
    expect(reverted?.libId).toBe('C');
    expect(names(m)).toEqual(['C', 'R', 'R_US', 'R_small']);
    expect(m.getSymbol('Device', 'C')).toBeDefined();
    expect(m.getSymbol('Device', 'C_big')).toBeUndefined();
    // ...and it is no longer marked modified under either name.
    expect(m.isSymbolModified('Device', 'C')).toBe(false);
    expect(m.isSymbolModified('Device', 'C_big')).toBe(false);
  });

  /** `symbolBuf->GetSymbol() = original` — the un-renamed branch. */
  it('restores the as-loaded content when the name did not change', () => {
    const m = managerWithLib();
    const c = m.getSymbol('Device', 'C')!;
    m.updateSymbol('Device', { ...c, libId: 'C', extends: 'R' });
    expect(m.getSymbol('Device', 'C')?.extends).toBe('R');
    expect(m.isSymbolModified('Device', 'C')).toBe(true);

    const reverted = m.revertSymbol('Device', 'C');
    expect(reverted?.libId).toBe('C');
    expect(m.getSymbol('Device', 'C')?.extends).toBeUndefined();
    expect(m.isSymbolModified('Device', 'C')).toBe(false);
    expect(names(m)).toEqual(['C', 'R', 'R_US', 'R_small']);
  });

  /**
   * A symbol that was never in the file has no original, so upstream's
   * `wxCHECK( symbolBuf, … )` path leaves nothing to restore and the frame
   * drops it. This is the branch our old code took for EVERY rename.
   */
  it('drops a symbol that was never saved', () => {
    const m = managerWithLib();
    const c = m.getSymbol('Device', 'C')!;
    m.updateSymbol('Device', { ...c, libId: 'BRAND_NEW' });
    expect(m.revertSymbol('Device', 'BRAND_NEW')).toBeUndefined();
    expect(names(m)).toEqual(['C', 'R', 'R_US', 'R_small']);
  });
});

describe('removeChildSymbols (symbol_library_manager.cpp:1276-1300)', () => {
  /**
   * `LIB_BUFFER::DeleteSymbol` calls `removeChildSymbols` before erasing the
   * root, so every symbol that derives from it goes too. Ours erased only the
   * root and left `R_small` and `R_US` with an `extends` pointing at nothing.
   */
  it('deletes the whole derived chain with the base symbol', () => {
    const m = managerWithLib();
    expect(m.derivedSymbolNames('Device', 'R').sort()).toEqual(['R_US', 'R_small']);

    m.removeSymbol('Device', 'R');
    // No orphan is left behind, including the grandchild.
    expect(names(m)).toEqual(['C']);
  });

  /** Deleting a leaf takes nothing else with it. */
  it('leaves the base alone when a derived symbol is deleted', () => {
    const m = managerWithLib();
    m.removeSymbol('Device', 'R_US');
    expect(names(m)).toEqual(['C', 'R', 'R_small']);
  });

  /** A symbol with no children reports none. */
  it('reports no children for a standalone symbol', () => {
    expect(managerWithLib().derivedSymbolNames('Device', 'C')).toEqual([]);
  });
});

describe('SymbolNameInUse (symbol_library_manager.cpp:653-669)', () => {
  /**
   * `candidate.CmpNoCase( UnescapeString( aName ) ) == 0`. Ours was an exact
   * `Map.has` on the escaped name, so a name differing only in case read as
   * free and the collision surfaced later as two symbols KiCad considers one.
   */
  it('matches case-insensitively', () => {
    const m = managerWithLib();
    expect(m.symbolExists('Device', 'R')).toBe(true);
    expect(m.symbolExists('Device', 'r')).toBe(true);
    expect(m.symbolExists('Device', 'r_SMALL')).toBe(true);
    expect(m.symbolExists('Device', 'nope')).toBe(false);
  });

  /**
   * `UnescapeString( aName )`: the tree's names are unescaped, so the candidate
   * has to be unescaped before it is compared. `{slash}` is
   * `string_utils.cpp`'s escape for `/`.
   */
  it('compares the unescaped name', () => {
    const m = managerWithLib();
    const c = m.getSymbol('Device', 'C')!;
    m.renameSymbol('Device', 'C', { ...c, libId: 'A/B' });
    expect(m.symbolExists('Device', 'A{slash}B')).toBe(true);
    expect(m.symbolExists('Device', 'A/B')).toBe(true);
  });
});
