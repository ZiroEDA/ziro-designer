// COMPONENT_CLASS / COMPONENT_CLASS_MANAGER / COMPONENT_CLASS_CACHE_PROXY
// (issue 636, stage 2). Oracle: python pcbnew 10.0.5 loading
// component_classes_in.kicad_pcb (ecc83-pp with `(component_classes (class
// "Zeta") (class "alpha") (class "Beta"))` on C1 and `(class "Beta")` on
// C2) — GetComponentClassAsString() gives 'Beta,Zeta,alpha' and 'Beta', and
// its re-save (component_classes_resave.kicad_pcb) writes the classes in
// that order. The DRC-language strings are the C++ format strings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import {
  COMPONENT_CLASS_ASSIGNMENT_DATA,
  CONDITION_TYPE,
  CONDITIONS_OPERATOR,
} from '@ziroeda/common/project/component_class_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { COMPONENT_CLASS, USAGE } from '@ziroeda/pcbnew/component_classes/component_class.js';
import { COMPONENT_CLASS_MANAGER } from '@ziroeda/pcbnew/component_classes/component_class_manager.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';

const DATA = fileURLToPath(new URL('../../data/pcbnew/', import.meta.url));

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('component classes', () => {
  it('the parser resolves (component_classes) through the manager and the formatter writes them back sorted', () => {
    const f = `${DATA}component_classes_in.kicad_pcb`;
    const board = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
    const c1 = board.Footprints().find((fp) => fp.GetReference() === 'C1')!;
    const c2 = board.Footprints().find((fp) => fp.GetReference() === 'C2')!;
    const c3 = board.Footprints().find((fp) => fp.GetReference() === 'P5')!;

    expect(c1.GetComponentClassAsString()).toBe('Beta,Zeta,alpha');
    expect(c2.GetComponentClassAsString()).toBe('Beta');
    expect(c3.GetComponentClassAsString()).toBe('');
    expect(c3.GetComponentClass()).toBe(board.GetComponentClassManager().GetNoneComponentClass());

    // The constituent "Beta" is one object shared by both footprints' classes
    const beta = c2.GetStaticComponentClass()!;
    expect(c1.GetStaticComponentClass()!.GetConstituentClass('Beta')).toBe(beta);
    expect(beta.GetUsageContext()).toBe(USAGE.STATIC);
    expect(c1.GetStaticComponentClass()!.GetUsageContext()).toBe(USAGE.EFFECTIVE);
    expect(c1.GetComponentClass()!.GetHumanReadableName()).toBe('Beta, Zeta and alpha');
    expect(c2.GetComponentClass()!.GetHumanReadableName()).toBe('Beta');

    const theirs = readFileSync(`${DATA}component_classes_resave.kicad_pcb`, 'utf8');
    const ours = FormatBoard(board, 'pcbnew');
    expect(ours).toBe(theirs);
  });

  it('human-readable names for 2, 3 and more constituents', () => {
    const two = new COMPONENT_CLASS('a,b', USAGE.EFFECTIVE);
    two.AddConstituentClass(new COMPONENT_CLASS('a', USAGE.STATIC));
    two.AddConstituentClass(new COMPONENT_CLASS('b', USAGE.STATIC));
    expect(two.GetHumanReadableName()).toBe('a and b');
    const four = new COMPONENT_CLASS('a,b,c,d', USAGE.EFFECTIVE);
    for (const n of ['a', 'b', 'c', 'd'])
      four.AddConstituentClass(new COMPONENT_CLASS(n, USAGE.STATIC));
    expect(four.GetHumanReadableName()).toBe('a, b and 2 more');
    expect(new COMPONENT_CLASS('', USAGE.STATIC).GetHumanReadableName()).toBe('<None>');
  });

  it('a netlist update retires static-only classes and demotes shared ones to dynamic', () => {
    const f = `${DATA}component_classes_in.kicad_pcb`;
    const board = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
    const mgr = board.GetComponentClassManager();
    const c1 = board.Footprints().find((fp) => fp.GetReference() === 'C1')!;
    expect([...mgr.GetClassNames()].sort()).toEqual(['Beta', 'Zeta', 'alpha']);

    mgr.InitNetlistUpdate();
    // the update keeps only Beta on C1
    c1.ResolveComponentClassNames(board, new Set(['Beta']));
    mgr.FinishNetlistUpdate();

    expect([...mgr.GetClassNames()]).toEqual(['Beta']);
    expect(c1.GetComponentClassAsString()).toBe('Beta');
    // the effective class "Beta,Zeta,alpha" is gone with its constituents
    expect(COMPONENT_CLASS_MANAGER.GetFullClassNameForConstituents(new Set(['b', 'a']))).toBe(
      'a,b',
    );
  });

  it('GetAssignmentInDRCLanguage is the C++ format string', () => {
    const a = new COMPONENT_CLASS_ASSIGNMENT_DATA();
    expect(a.GetAssignmentInDRCLanguage()).toBe('');
    a.SetComponentClass('Power');
    expect(a.GetAssignmentInDRCLanguage()).toBe('(version 1) (assign_component_class "Power")');
    a.AddCondition(CONDITION_TYPE.REFERENCE, ' R1, R2 ', '');
    a.AddCondition(CONDITION_TYPE.SIDE, 'Front', '');
    a.AddCondition(CONDITION_TYPE.ROTATION, 'Any', '');
    a.AddCondition(CONDITION_TYPE.FOOTPRINT_FIELD, 'Value', '10k');
    expect(a.GetAssignmentInDRCLanguage()).toBe(
      `(version 1) (assign_component_class "Power" (condition "( A.Reference == 'R1' || A.Reference == ' R2' ) && ( A.Layer == 'F.Cu' ) && ( A.getField('Value') == '10k' )" ) )`,
    );
    a.SetConditionsOperation(CONDITIONS_OPERATOR.ANY);
    expect(a.GetAssignmentInDRCLanguage()).toContain(' || ( A.Layer');
    const s = new COMPONENT_CLASS_ASSIGNMENT_DATA();
    s.SetComponentClass('Sheet');
    s.AddCondition(CONDITION_TYPE.SHEET_NAME, '/Power/', '');
    expect(s.GetAssignmentInDRCLanguage()).toBe(
      `(version 1) (assign_component_class "Sheet" (condition "( A.memberOfSheet('/Power/') )" ) )`,
    );
    expect(COMPONENT_CLASS_ASSIGNMENT_DATA.GetConditionType('CUSTOM')).toBe(CONDITION_TYPE.CUSTOM);
    expect(COMPONENT_CLASS_ASSIGNMENT_DATA.GetConditionName(CONDITION_TYPE.FOOTPRINT_FIELD)).toBe(
      'FOOTPRINT_FIELD',
    );
  });
});
