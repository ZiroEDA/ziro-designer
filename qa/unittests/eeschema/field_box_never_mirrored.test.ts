// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A schematic field is never mirrored, so its box never takes the mirrored arm.
 *
 * `EDA_TEXT::GetTextBox` guards two of its three horizontal arms on
 * `IsMirrored()` (`common/eda_text.cpp`):
 *
 *     case GR_TEXT_H_ALIGN_LEFT:
 *         if( IsMirrored() ) bbox.SetX( bbox.GetX() - ( bbox.GetWidth() - italicOffset ) );
 *         break;
 *     case GR_TEXT_H_ALIGN_RIGHT:
 *         if( !IsMirrored() ) bbox.SetX( bbox.GetX() - ( bbox.GetWidth() - italicOffset ) );
 *         break;
 *
 * Reading only that, our `fieldTextBox` looks as though it is missing a case:
 * it always takes the unmirrored branch. It is not. The eeschema parser reads
 * the `mirror` token inside `(justify …)` and deliberately DISCARDS it
 * (`sch_io_kicad_sexpr_parser.cpp:862-863`):
 *
 *     // Do not set mirror property for schematic text elements
 *     case T_mirror: break;
 *
 * so `IsMirrored()` is false for every `SCH_FIELD` and only the unmirrored arms
 * are reachable. Adding the guards would make us differ from KiCad, not match
 * it — a symbol field carrying the token would jump a full text width sideways.
 *
 * This matters because the token IS reachable on our side: `read-schematic.ts`
 * stores `effects.justify` as the file's argument list verbatim, mirror
 * included, so it arrives at the switch. The behaviour is pinned here because
 * the alternative — a comment alone — is exactly what a later reader "fixes".
 */
import { describe, expect, it } from 'vitest';
import { fieldTextBox } from '@ziroeda/eeschema/src/fieldbox.js';
import type { SchField } from '@ziroeda/eeschema/src/types.js';

const SIZE = 1270000;

const field = (justify: string[]): SchField =>
  ({
    key: 'Value',
    value: 'VCC',
    at: { x: 0, y: 0 },
    angle: 0,
    effects: { fontSize: [SIZE, SIZE] as [number, number], justify },
  }) as unknown as SchField;

describe('the mirror token does not move a field box', () => {
  it('a left-justified field is boxed to the right of its anchor, mirror or not', () => {
    const plain = fieldTextBox(field(['left']), 'VCC');
    const mirrored = fieldTextBox(field(['left', 'mirror']), 'VCC');
    expect(plain.x).toBe(0); // LEFT, unmirrored: the origin stays on the anchor
    expect(mirrored.x).toBe(plain.x);
    expect(mirrored.w).toBe(plain.w);
  });

  it('a right-justified field is boxed to the left of its anchor, mirror or not', () => {
    const plain = fieldTextBox(field(['right']), 'VCC');
    const mirrored = fieldTextBox(field(['right', 'mirror']), 'VCC');
    expect(plain.x).toBe(-plain.w); // RIGHT, unmirrored: shifted a full width
    expect(mirrored.x).toBe(plain.x);
  });

  // Centre is unguarded upstream — it moves whether mirrored or not — so this
  // arm is the control: it proves the two cases above are not both no-ops
  // because the token is simply being dropped before the switch.
  it('and a centred field is centred either way, as the unguarded arm says', () => {
    const plain = fieldTextBox(field(['mirror']), 'VCC');
    expect(plain.x).toBe(-Math.trunc(plain.w / 2));
  });
});
