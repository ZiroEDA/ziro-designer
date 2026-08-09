// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Creating a netclass directive label, traced against
 * `SCH_DRAWING_TOOLS::createNewLabel`'s `case LAYER_NETCLASS_REFS`:
 *
 *     labelItem = new SCH_DIRECTIVE_LABEL( aPosition );
 *     labelItem->SetShape( m_lastNetClassFlagShape );
 *     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Netclass" ) );
 *     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Component Class" ) );
 *     labelItem->GetFields().back().SetItalic( true );
 *     labelItem->GetFields().back().SetVisible( true );
 *
 * and the constructor it starts from:
 *
 *     m_shape       = LABEL_FLAG_SHAPE::F_ROUND;
 *     m_pinLength   = schIUScale.MilsToIU( 100 );
 *     m_symbolSize  = schIUScale.MilsToIU( 20 );
 *
 * Note that upstream hands the *item itself* to the dialog, so everything the
 * fields grid ends up holding travels onto the placed label. Ours rebuilt the
 * label from a summary that carried only the netclass, which threw away every
 * other field the dialog collected.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeDirectiveLabel } from '@ziroeda/eeschema/src/tools/build.js';
import {
  DIRECTIVE_SYMBOL_SIZE,
  directiveGraphic,
} from '@ziroeda/eeschema/src/tools/directive_label.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const AT = { x: mmToIU(100), y: mmToIU(100) };

describe('the defaults a new directive label is born with', () => {
  const d = makeDirectiveLabel(AT);

  it('is a round flag on a 100 mil pin', () => {
    expect(d.shape).toBe('round');
    // schIUScale.MilsToIU( 100 ) — 100 mils is 2.54 mm.
    expect(d.pinLength).toBe(mmToIU(2.54));
  });

  it('and its flag glyph is 20 mils, not 50', () => {
    // `m_symbolSize = schIUScale.MilsToIU( 20 )`. This was 12700 IU (50 mils),
    // so every netclass flag drew two and a half times too large.
    expect(DIRECTIVE_SYMBOL_SIZE).toBe(mmToIU(0.508));
  });

  it('which is the size the drawn shape actually uses', () => {
    const g = directiveGraphic(d);
    expect(g.circle?.radius).toBe(DIRECTIVE_SYMBOL_SIZE);
  });

  it('carries no text of its own', () => {
    // A directive label's value lives in a field; the text is always empty.
    expect(d.text).toBe('');
  });
});

describe('the fields it is created with', () => {
  it('keeps the netclass row even when nothing else is given', () => {
    const d = makeDirectiveLabel(AT, { netclass: 'HV' });
    expect(d.fields.map((f) => f.key)).toEqual(['Netclass']);
    expect(d.fields[0]!.value).toBe('HV');
  });

  it('carries every other field the dialog collected', () => {
    const d = makeDirectiveLabel(AT, {
      netclass: 'HV',
      fields: [
        { key: 'Netclass', value: 'HV' },
        { key: 'Component Class', value: 'PowerFET', effects: { hidden: false, italic: true } },
      ],
    });
    expect(d.fields.map((f) => f.key)).toEqual(['Netclass', 'Component Class']);
    expect(d.fields[1]!.value).toBe('PowerFET');
    // "GetFields().back().SetItalic( true )".
    expect(d.fields[1]!.effects?.italic).toBe(true);
  });

  it('drops the empty ones, which are not written out', () => {
    const d = makeDirectiveLabel(AT, {
      netclass: 'HV',
      fields: [
        { key: 'Netclass', value: 'HV' },
        { key: 'Component Class', value: '   ' },
      ],
    });
    expect(d.fields.map((f) => f.key)).toEqual(['Netclass']);
  });

  it('and the netclass argument still wins over the row', () => {
    // The caller passes both; the resolver reads the field by name, so they
    // must not disagree.
    const d = makeDirectiveLabel(AT, {
      netclass: 'HV',
      fields: [{ key: 'Netclass', value: 'stale' }],
    });
    expect(d.fields[0]!.value).toBe('HV');
  });
});

describe('and it round-trips through the file', () => {
  const withLabel = (): Schematic => {
    const doc = readSchematic(parse('(kicad_sch (version 20250114) (lib_symbols))'));
    return {
      ...doc,
      directiveLabels: [
        makeDirectiveLabel(AT, {
          netclass: 'HV',
          fields: [
            { key: 'Netclass', value: 'HV' },
            { key: 'Component Class', value: 'PowerFET', effects: { hidden: false, italic: true } },
          ],
        }),
      ],
    };
  };

  it('both fields survive being written and read back', () => {
    const back = readSchematic(parse(serializeSchematic(withLabel())));
    const d = (back.directiveLabels ?? [])[0]!;
    expect(d).toBeDefined();
    const byKey = new Map(d.fields.map((f) => [f.key, f.value]));
    expect(byKey.get('Netclass')).toBe('HV');
    expect(byKey.get('Component Class')).toBe('PowerFET');
  });

  it('with the shape and pin length intact', () => {
    const back = readSchematic(parse(serializeSchematic(withLabel())));
    const d = (back.directiveLabels ?? [])[0]!;
    expect(d.shape).toBe('round');
    expect(d.pinLength).toBe(mmToIU(2.54));
  });
});
