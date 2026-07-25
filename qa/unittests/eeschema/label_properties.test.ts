/**
 * The model side of DIALOG_LABEL_PROPERTIES: a label's orientation
 * (SPIN_STYLE), its fields (`(property …)` children, the same grid the symbol
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
  pinSpinStyle,
  setLabelFields,
  spinOfAngle,
  wireLabelDriverName,
} from '@ziroeda/eeschema/src/tools/label_properties.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { makeLabel as buildLabel } from '@ziroeda/eeschema/src/tools/build.js';
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

describe('pin orientation (GetPinSpinStyle)', () => {
  it('faces the label away from the pin body', () => {
    // PIN_RIGHT -> LEFT, PIN_LEFT -> RIGHT, PIN_UP -> BOTTOM, PIN_DOWN -> UP.
    expect(pinSpinStyle(0, 0, undefined)).toBe('left');
    expect(pinSpinStyle(180, 0, undefined)).toBe('right');
    expect(pinSpinStyle(90, 0, undefined)).toBe('bottom');
    expect(pinSpinStyle(270, 0, undefined)).toBe('up');
  });

  it('follows the symbol rotation and mirroring', () => {
    expect(pinSpinStyle(0, 90, undefined)).toBe('bottom'); // LEFT rotated 90
    expect(pinSpinStyle(0, 270, undefined)).toBe('up'); // LEFT rotated 270
    expect(pinSpinStyle(0, 180, undefined)).toBe('right'); // LEFT flipped
    expect(pinSpinStyle(0, 0, 'y')).toBe('right'); // mirrored across Y
    expect(pinSpinStyle(90, 0, 'x')).toBe('up'); // BOTTOM mirrored across X
  });
});

describe('naming a label from the wire under it', () => {
  const at = (x: number, y: number): { x: number; y: number } => ({ x: mmToIU(x), y: mmToIU(y) });

  it('takes the net name when the wire is driven by a label', () => {
    const base = load();
    const sch: Schematic = {
      ...base,
      labels: [buildLabel('label', 'CLK', at(50, 50))],
      lines: [makeWire(at(50, 50), at(60, 50))],
    };
    const netlist = computeNetlist(sch, new Map());
    expect(wireLabelDriverName(sch, netlist, at(55, 50))).toBe('CLK');
  });

  it('asks (returns nothing) where no wire runs, or where none is label-driven', () => {
    const base = load();
    const bare: Schematic = { ...base, labels: [], lines: [makeWire(at(50, 50), at(60, 50))] };
    const netlist = computeNetlist(bare, new Map());
    expect(wireLabelDriverName(bare, netlist, at(55, 50))).toBe('');
    expect(wireLabelDriverName(bare, netlist, at(90, 90))).toBe('');
  });
});

describe('free text', () => {
  it('round-trips the exclude-from-simulation flag', () => {
    const sch = load();
    const text = { ...buildLabel('text', 'note', { x: 0, y: 0 }), excludedFromSim: true };
    const out = serializeSchematic({ ...sch, labels: [text] });
    expect(out).toContain('(exclude_from_sim yes)');
    expect(readSchematic(parse(out)).labels[0]?.excludedFromSim).toBe(true);
  });
});
