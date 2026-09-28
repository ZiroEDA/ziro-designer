// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_TABLE` / `SCH_TABLECELL`, `SCH_BITMAP`, `SCH_GROUP` and `SCH_RULE_AREA` of the
 * live model (eeschema stage E3), against the C++ arithmetic of sch_table.cpp,
 * sch_tablecell.cpp, sch_bitmap.cpp, sch_group.cpp and sch_rule_area.cpp.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_BITMAP } from '@ziroeda/eeschema/sch_bitmap.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import { SCH_DIRECTIVE_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_RULE_AREA } from '@ziroeda/eeschema/sch_rule_area.js';
import { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_TABLECELL } from '@ziroeda/eeschema/sch_tablecell.js';

const table2x2 = (): SCH_TABLE => {
  const t = new SCH_TABLE();
  t.SetColCount(2);
  for (let i = 0; i < 4; i++) {
    const c = new SCH_TABLECELL();
    c.SetStart({ x: 0, y: 0 });
    c.SetEnd({ x: 0, y: 0 });
    t.AddCell(c);
  }
  t.SetColWidth(0, 1000);
  t.SetColWidth(1, 2000);
  t.SetRowHeight(0, 500);
  t.SetRowHeight(1, 700);
  t.Normalize();
  return t;
};

describe('SCH_TABLE', () => {
  it('Normalize lays the cells out on the widths and heights', () => {
    const t = table2x2();
    expect(t.GetRowCount()).toBe(2);
    expect(t.GetCell(1, 1)!.GetStart()).toEqual({ x: 1000, y: 500 });
    expect(t.GetCell(1, 1)!.GetEnd()).toEqual({ x: 3000, y: 1200 });
    expect(t.GetEnd()).toEqual({ x: 3000, y: 1200 });
  });

  it('cells know their address and the ${ROW}/${COL}/${ADDR}/${CELL()} variables', () => {
    const t = table2x2();
    // wide enough that LinebreakText leaves the line whole
    t.SetColWidth(0, 10_000_000);
    t.Normalize();
    const c = t.GetCell(1, 0)!;
    expect(c.GetRow()).toBe(1);
    expect(c.GetColumn()).toBe(0);
    expect(c.GetAddr()).toBe('A1');
    t.GetCell(0, 1)!.SetText('hello');
    c.SetText('${ROW}.${COL} ${ADDR} ${CELL("B0")} ${CELL(9,9)}');
    expect(c.GetShownText(false)).toBe('1.0 A1 hello <Unresolved: Cell J9 not found>');
  });

  it('the copy owns copies of the cells, with their uuids', () => {
    const t = table2x2();
    const c = t.Clone();
    expect(c.GetCells().length).toBe(4);
    expect(c.GetCell(0, 0)).not.toBe(t.GetCell(0, 0));
    expect(c.GetCell(0, 0)!.m_Uuid).toBe(t.GetCell(0, 0)!.m_Uuid);
    expect(c.GetCell(0, 0)!.GetParent()).toBe(c);
    expect(c.equals(t)).toBe(true);
  });

  it('Move moves every cell', () => {
    const t = table2x2();
    t.SetPosition({ x: 100, y: 100 });
    expect(t.GetCell(1, 1)!.GetStart()).toEqual({ x: 1100, y: 600 });
  });
});

describe('SCH_GROUP', () => {
  it('Move moves both ends of a member line and leaves the end flags set', () => {
    const g = new SCH_GROUP();
    const l = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    l.SetEndPoint({ x: 10, y: 0 });
    g.AddItem(l);
    expect(l.GetParentGroup()).toBe(g);
    g.Move({ x: 5, y: 5 });
    expect([l.GetStartPoint(), l.GetEndPoint()]).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
    ]);
  });

  it('equality is the member uuid set', () => {
    const a = new SCH_GROUP();
    const l = new SCH_LINE();
    a.AddItem(l);
    const b = a.Clone();
    expect(b.equals(a)).toBe(true);
    expect(b.Type()).toBe(KICAD_T.SCH_GROUP_T);
  });
});

describe('SCH_BITMAP / SCH_RULE_AREA', () => {
  it('a bitmap moves its reference image', () => {
    const b = new SCH_BITMAP({ x: 10, y: 20 });
    b.Move({ x: 1, y: 2 });
    expect(b.GetPosition()).toEqual({ x: 11, y: 22 });
    expect(b.Clone().GetPosition()).toEqual({ x: 11, y: 22 });
  });

  it('a rule area is a polygon on the rule-area layer, never filled for hit testing', () => {
    const r = new SCH_RULE_AREA();
    expect(r.GetShape()).toBe(SHAPE_T.POLY);
    expect(r.GetLayer()).toBe(SCH_LAYER_ID.LAYER_RULE_AREAS);
    expect(r.IsFilledForHitTesting()).toBe(false);
    r.SetDNP(true);
    expect(r.Clone().GetDNP()).toBe(true);
  });

  it('a directive label caches its rule areas, and the area forgets it on removal', () => {
    const r = new SCH_RULE_AREA();
    const d = new SCH_DIRECTIVE_LABEL();
    d.AddConnectedRuleArea(r);
    expect(d.IsDangling()).toBe(false);
    r.m_directives.add(d);
    r.RemoveDirective(d);
    expect(r.GetDirectives().size).toBe(0);
  });
});
