// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A field's "Allow automatic placement" flag, the last thing
 * DIALOG_FIELD_PROPERTIES edits that we did not model.
 *
 * `saveField` writes it as `(do_not_autoplace yes)`, inverted from
 * SCH_FIELD::CanAutoplace, and only when set — so a file that never carried the
 * token keeps not carrying it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic, replaceSymbol } from '@ziroeda/eeschema';

const doc = (extra: string) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols)
      (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "s1")
        (property "Reference" "R1" (at 10 8 0) ${extra})
        (property "Value" "10k" (at 10 12 0))))`),
  );

describe('do_not_autoplace', () => {
  it('is absent by default, meaning the field may autoplace', () => {
    expect(doc('').symbols[0]!.fields[0]!.doNotAutoplace).toBeUndefined();
  });

  it('reads the token when present', () => {
    expect(doc('(do_not_autoplace yes)').symbols[0]!.fields[0]!.doNotAutoplace).toBe(true);
    expect(doc('(do_not_autoplace no)').symbols[0]!.fields[0]!.doNotAutoplace).toBe(false);
  });

  it('round-trips once set', () => {
    const d = doc('');
    const sym = d.symbols[0]!;
    const next = replaceSymbol(0, {
      ...sym,
      fields: sym.fields.map((f, i) => (i === 0 ? { ...f, doNotAutoplace: true } : f)),
    }).apply(d);
    const text = serializeSchematic(next);
    expect(text).toMatch(/\(do_not_autoplace\s+yes\)/);
    expect(readSchematic(parse(text)).symbols[0]!.fields[0]!.doNotAutoplace).toBe(true);
  });

  it('is not written for a field that never had it', () => {
    // The writer's rule everywhere: a token appears only once the model carries
    // a non-default, so an untouched file round-trips byte-for-byte.
    expect(serializeSchematic(doc(''))).not.toMatch(/do_not_autoplace/);
  });

  it('clears back to absent', () => {
    const d = doc('(do_not_autoplace yes)');
    const sym = d.symbols[0]!;
    const off = replaceSymbol(0, {
      ...sym,
      fields: sym.fields.map((f, i) => (i === 0 ? { ...f, doNotAutoplace: false } : f)),
    }).apply(d);
    expect(serializeSchematic(off)).not.toMatch(/do_not_autoplace/);
  });
});
