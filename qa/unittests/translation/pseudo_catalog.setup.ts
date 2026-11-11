// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A pseudo-language for the file tests: every KiCad message translates to
 * `⟪message⟫`. Installed before each test of `vitest.pseudo.config.ts`.
 *
 * Interface text is translated; what a file holds is not. KiCad keeps the two
 * apart by marking keywords `_HKI()` (English stored, translated only when
 * shown) and leaving tokens bare. A port that marks the wrong literal `_()`
 * writes German into a German user's `.kicad_sch` - and every English test
 * still passes, because with no catalog `_()` is the identity. Under this
 * catalog the same oracle and round-trip tests must produce byte-identical
 * files; a `⟪` in any output is a message that leaked into data.
 */
import { afterEach, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wxMsgCatalog, wxTranslations } from '@ziroeda/wx/translation.js';
import { loadMsgids } from './untranslated_literals.js';

/**
 * Messages KiCad itself writes into output in the user's language, so the
 * English oracle cannot hold them under any translation. They are left out of
 * the pseudo-language - each one a `_( )` in KiCad's own output path - and
 * everything else in the same files is still checked.
 */
export const KICAD_TRANSLATES_INTO_OUTPUT: ReadonlyMap<string, string> = new Map([
  // eeschema_helpers.cpp:135 and files-io.cpp:361: the unnamed root sheet is `_( "Root" )`,
  // and the netlist exporters write it as the root's Sheetname.
  ['Root', 'the root sheet name'],
  // sch_label.cpp:1591 and sch_symbol.cpp:3407: PDF bookmark groups.
  ['Hierarchical Labels', 'a PDF bookmark group'],
  ['Symbols', 'a PDF bookmark group'],
  // pcb_dimension.cpp:1369: a new leader's override text is `_( "Leader" )`, and the Eagle
  // importer makes one per leader, so the board file holds it in the user's language.
  ['Leader', "a leader dimension's text"],
]);

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const messages: Record<string, string> = {};
for (const id of loadMsgids(join(ROOT, 'translation'))) {
  if (!KICAD_TRANSLATES_INTO_OUTPUT.has(id)) messages[id] = `⟪${id}⟫`;
}
const PSEUDO = new wxMsgCatalog({ language: 'qps', nplurals: 2, plural: 'n != 1', messages });

beforeEach(() => wxTranslations.Get().SetCatalog(PSEUDO));
afterEach(() => wxTranslations.Get().SetCatalog(null));
