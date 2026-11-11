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

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const messages: Record<string, string> = {};
for (const id of loadMsgids(join(ROOT, 'translation'))) messages[id] = `⟪${id}⟫`;
const PSEUDO = new wxMsgCatalog({ language: 'qps', nplurals: 2, plural: 'n != 1', messages });

beforeEach(() => wxTranslations.Get().SetCatalog(PSEUDO));
afterEach(() => wxTranslations.Get().SetCatalog(null));
