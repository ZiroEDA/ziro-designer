/**
 * The model side of DIALOG_LABEL_PROPERTIES: a label's orientation
 * (SPIN_STYLE), its fields (`(property …)` children — the same grid the symbol
 * dialog edits), and the auto-rotate-on-placement rule
 * (SCH_SCREEN::GetLabelOrientationForPoint).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { makeLabel, makeWire } from '@ziroeda/eeschema/src/tools/build.js';
import {
  SPIN_ANGLE,
  cleanLabelFields,
  labelFields,
  labelOrientationForPoint,
  setLabelFields,
  spinOfAngle,
} from '@ziroeda/eeschema/src/tools/label_properties.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema")
  (global_label "VCC" (shape input) (at 50 50 0)
    (effects (font (size 1.27 1.27)) (justify left))
    (uuid "aaaa")
    (property "Intersheetrefs" "\${INTERSHEET_REFS}" (at 50 50 0)
      (effects (font (size 1.27 1.27)) (justify left) (hide yes)))
  )
)`;

const load = (): Schematic => readSchematic(parse(SHEET));

describe('label orientation', () => {
  it('round-trips SPIN_STYLE through the stored angle', () => {
    for (const spin of ['right', 'up', 'left', 'bottom'] as const) {
      expect(spinOfAngle(SPIN_ANGLE[spin])).toBe(spin);
    }
    expect(spinOfAngle(0)).toBe('right');
    expect(spinOfAngle(360)).toBe('right');
    expect(spinOfAngle(-90)).toBe('bottom');
  });
});

describe('label fields', () => {
  it("reads the label's (property …) children", () => {
    const label = load().labels[0]!;
    const fields = labelFields(label);
    expect(fields.map((f) => f.key)).toEqual(['Intersheetrefs']);
    expect(fields[0]?.effects?.hidden).toBe(true);
  });

  it('patches an edited field in place and keeps the rest byte-stable', () => {
    const sch = load();
    const label = sch.labels[0]!;
    const fields = labelFields(label);
    const next = setLabelFields(label, [{ ...fields[0]!, value: 'shown' }]);
    const text = serialize(next.source);
    expect(text).toContain('"shown"');
    expect(text).toContain('(hide yes)'); // untouched parts survive
    expect(labelFields(next)).toHaveLength(1);
  });

  it('appends a new field and drops a removed one', () => {
    const sch = load();
    const label = sch.labels[0]!;
    const added = setLabelFields(label, [
      ...labelFields(label),
      { key: 'Netclass', value: 'HV', angle: 0, effects: { hidden: false } },
    ]);
    expect(labelFields(added).map((f) => f.key)).toEqual(['Intersheetrefs', 'Netclass']);

    const removed = setLabelFields(added, []);
    expect(labelFields(removed)).toEqual([]);
    expect(serialize(removed.source)).not.toContain('property');
  });

  it('survives a whole-schematic write', () => {
    const sch = load();
    const label = setLabelFields(sch.labels[0]!, [
      { key: 'Netclass', value: 'HV', angle: 0, effects: { hidden: false } },
    ]);
    const out = serializeSchematic({ ...sch, labels: [label] });
    expect(out).toContain('(property "Netclass" "HV"');
    expect(labelFields(readSchematic(parse(out)).labels[0]!).map((f) => f.value)).toEqual(['HV']);
  });

  it('drops empty rows and names a nameless one, as TransferDataFromWindow does', () => {
    const rows = [
      { key: '', value: '', angle: 0, effects: { hidden: false } },
      { key: '', value: 'orphan', angle: 0, effects: { hidden: false } },
      { key: 'Netclass', value: 'HV', angle: 0, effects: { hidden: false } },
    ];
    expect(cleanLabelFields(rows).map((f) => f.key)).toEqual(['untitled', 'Netclass']);
  });
});

describe('auto-rotate on placement', () => {
  const at = (x: number, y: number): { x: number; y: number } => ({ x: mmToIU(x), y: mmToIU(y) });
  const withWire = (a: { x: number; y: number }, b: { x: number; y: number }): Schematic => ({
    ...load(),
    lines: [makeWire(a, b)],
  });

  it('points a label at the right-hand end of a horizontal wire', () => {
    const sch = withWire(at(50, 50), at(60, 50));
    expect(labelOrientationForPoint(sch, at(60, 50), 'right')).toBe('right');
    expect(labelOrientationForPoint(sch, at(50, 50), 'right')).toBe('left');
  });

  it('points a label up or down along a vertical wire', () => {
    const sch = withWire(at(50, 50), at(50, 60));
    expect(labelOrientationForPoint(sch, at(50, 60), 'right')).toBe('bottom');
    expect(labelOrientationForPoint(sch, at(50, 50), 'right')).toBe('up');
  });

  it('keeps the current orientation where no wire runs', () => {
    const sch = withWire(at(50, 50), at(60, 50));
    expect(labelOrientationForPoint(sch, at(80, 80), 'up')).toBe('up');
  });
});

describe('placed labels', () => {
  it("carries the dialog's orientation into the stored angle", () => {
    const label = makeLabel('global_label', 'VCC', { x: 0, y: 0 }, { angle: SPIN_ANGLE.left });
    expect(label.angle).toBe(180);
    expect(spinOfAngle(label.angle)).toBe('left');
  });
});
