// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC_ENGINE on the live BOARD (#636 stage 4c): `EvalRules` resolves the
 * clearance a pad clearance ring is drawn from, the way `drc_engine.cpp`
 * does - the board minimum, the netclass rule (sorted by clearance, matched
 * by `A.hasExactNetclass`), a `.kicad_dru` rule over both, the pad's local
 * override under the board minimum, and the netclass-changes-after-load
 * path. The expectations are the C++'s precedence, not the code's output.
 */
import { describe, expect, it } from 'vitest';
import { PARSE_ERROR } from '@ziroeda/common/src/dsnlexer.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/src/pgm_base.js';
import {
  Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/src/reporter.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { DEFAULT_MINCLEARANCE } from '@ziroeda/pcbnew/board_design_settings_defaults.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/drc/drc_item.js';
import { DRC_CONSTRAINT_T, DRC_DISALLOW_T, type DRC_RULE } from '@ziroeda/pcbnew/drc/drc_rule.js';
import { DRC_RULES_PARSER } from '@ziroeda/pcbnew/drc/drc_rule_parser.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB } from '@ziroeda/pcbnew/padstack.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';

const mm = (v: number): number => pcbIUScale.mmToIU(v);

/**
 * The Default class as a `.kicad_pro` carries it: every parameter present
 * (netclass.cpp's defaults), because `addMissingDefaults` copies the
 * Default's values into a composite unconditionally - a Default missing a
 * value would hand the composite a -1.
 */
const DEFAULT_CLASS_JSON = {
  name: 'Default',
  priority: 2147483647,
  clearance: 0.2,
  track_width: 0.2,
  via_diameter: 0.6,
  via_drill: 0.3,
  microvia_diameter: 0.3,
  microvia_drill: 0.1,
  diff_pair_width: 0.2,
  diff_pair_gap: 0.25,
  wire_width: 6,
  bus_width: 12,
  line_style: 0,
};

interface Fixture {
  board: BOARD;
  engine: DRC_ENGINE;
  hvTrack: PCB_TRACK;
  sigTrack: PCB_TRACK;
  pad: PAD;
}

/**
 * A board with two nets - `HV1` in class `HV` (0.5 mm), `SIG` in Default
 * (0.2 mm) - a track on each, and a pad on `SIG`, with a 0.3 mm board
 * minimum. The `.kicad_pro` net_settings arrive as `NET_SETTINGS::LoadFromJson`
 * takes them.
 */
function makeBoard(): Fixture {
  const board = new BOARD();

  // SETTINGS_MANAGER::LoadProject + BOARD::SetProject: the netclasses are the
  // project file's, and a board without a project never syncs them.
  const manager = new SETTINGS_MANAGER();
  manager.LoadProject('/qa/core.kicad_pro', {
    net_settings: {
      classes: [DEFAULT_CLASS_JSON, { name: 'HV', clearance: 0.5, priority: 0 }],
      netclass_patterns: [{ pattern: 'HV*', netclass: 'HV' }],
    },
  });
  board.SetProject(manager.Prj());

  const bds = board.GetDesignSettings();

  bds.m_MinClearance = mm(0.3);

  const hv = new NETINFO_ITEM(board, 'HV1');
  const sig = new NETINFO_ITEM(board, 'SIG');
  board.Add(hv);
  board.Add(sig);

  const hvTrack = new PCB_TRACK(board);
  hvTrack.SetLayer(PCB_LAYER_ID.F_Cu);
  hvTrack.SetStart({ x: 0, y: 0 });
  hvTrack.SetEnd({ x: mm(10), y: 0 });
  hvTrack.SetWidth(mm(0.25));
  hvTrack.SetNet(hv);
  board.Add(hvTrack);

  const sigTrack = new PCB_TRACK(board);
  sigTrack.SetLayer(PCB_LAYER_ID.F_Cu);
  sigTrack.SetStart({ x: 0, y: mm(5) });
  sigTrack.SetEnd({ x: mm(10), y: mm(5) });
  sigTrack.SetWidth(mm(0.25));
  sigTrack.SetNet(sig);
  board.Add(sigTrack);

  const fp = new FOOTPRINT(board);
  fp.SetReference('R1');
  const pad = new PAD(fp);
  pad.SetNumber('1');
  pad.SetNet(sig);
  fp.Add(pad);
  board.Add(fp);

  const engine = new DRC_ENGINE(board, bds);
  bds.m_DRCEngine = engine;

  return { board, engine, hvTrack, sigTrack, pad };
}

const F_Cu = PCB_LAYER_ID.F_Cu;

describe('DRC_ENGINE core', () => {
  it('implicit rules: the netclass clearance, floored by the board minimum', () => {
    const { engine, hvTrack, sigTrack } = makeBoard();
    engine.InitEngine(null);

    expect(engine.RulesValid()).toBe(true);

    // HV1 is in class HV: 0.5 mm, from the netclass rule
    const hv = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, hvTrack, null, F_Cu);
    expect(hv.Value().Min()).toBe(mm(0.5));
    expect(hv.m_ImplicitMin).toBe(true);

    // SIG is in Default: 0.2 mm, which the 0.3 mm board minimum overrides
    const sig = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, sigTrack, null, F_Cu);
    expect(sig.Value().Min()).toBe(mm(0.3));

    // Two items of different classes: the larger clearance wins
    const pair = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, sigTrack, hvTrack, F_Cu);
    expect(pair.Value().Min()).toBe(mm(0.5));
  });

  it('the reporter path names the sources the way the dialog shows them', () => {
    const { engine, sigTrack } = makeBoard();
    engine.InitEngine(null);

    const reporter = new Reporter();
    const c = engine.EvalRules(
      DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
      sigTrack,
      null,
      F_Cu,
      reporter,
    );

    expect(c.Value().Min()).toBe(mm(0.3));
    expect(c.GetName()).toBe('board minimum');

    const lines = reporter.lines.map((l) => l.message);
    // `EscapeHTML( c->constraint.GetName() )`: the quotes come out as entities
    expect(lines).toContain('Checking netclass &apos;Default&apos; clearance: 0.2000 mm.');
    expect(lines).toContain('Board minimum clearance: 0.3000 mm.');
    // The HV rule was checked and its membership not satisfied
    expect(lines).toContain('Membership not satisfied; constraint ignored.');
  });

  it('GetCachedOwnClearance is what the pad clearance ring draws from', () => {
    const { engine, pad, hvTrack } = makeBoard();
    engine.InitEngine(null);

    const source: OutStr = { value: '' };
    expect(engine.GetCachedOwnClearance(pad, F_Cu, source)).toBe(mm(0.3));
    expect(source.value).toBe('board minimum');

    // GetOwnClearance routes through it
    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.3));
    expect(hvTrack.GetOwnClearance(F_Cu)).toBe(mm(0.5));

    // A cache hit returns the cached value without re-evaluating
    engine.InitializeClearanceCache();
    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.3));
  });

  it('a .kicad_dru rule overrides the netclass; its own board-minimum floor still applies', () => {
    const { engine, hvTrack, sigTrack } = makeBoard();
    const dru = `(version 1)
(rule "HV wide"
  (condition "A.NetClass == 'HV'")
  (constraint clearance (min 1mm)))
(rule "tiny"
  (condition "A.hasExactNetclass('Default')")
  (constraint clearance (min 0.1mm)))
`;
    engine.InitEngine(dru, 'test.kicad_dru');

    const hv = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, hvTrack, null, F_Cu);
    expect(hv.Value().Min()).toBe(mm(1));
    expect(hv.m_ImplicitMin).toBe(false);
    expect(hv.GetName()).toBe("rule 'HV wide'");
    expect(hv.GetParentRule()!.IsImplicit()).toBe(false);

    // An explicit 0.1 mm rule wins the rule pass, but the board minimum is
    // applied after it because the rule set the min lower.
    const sig = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, sigTrack, null, F_Cu);
    expect(sig.Value().Min()).toBe(mm(0.1));
    expect(sig.GetName()).toBe("rule 'tiny'");

    expect(engine.HasRulesForConstraintType(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT)).toBe(true);
    expect(engine.HasRulesForConstraintType(DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT)).toBe(false);
    expect(engine.QueryWorstConstraint(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT)!.Value().Min()).toBe(
      mm(1),
    );
  });

  it('a local pad clearance override wins, floored by the board minimum', () => {
    const { engine, pad } = makeBoard();
    engine.InitEngine(null);

    pad.SetLocalClearance(mm(0.8));
    let c = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, pad, null, F_Cu);
    expect(c.Value().Min()).toBe(mm(0.8));
    expect(c.GetName()).toBe('pad');

    pad.SetLocalClearance(mm(0.05));
    c = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, pad, null, F_Cu);
    expect(c.Value().Min()).toBe(mm(0.3));
    expect(c.GetName()).toBe('board minimum');
  });

  it('a broken .kicad_dru throws PARSE_ERROR and leaves the implicit rules in force', () => {
    const { engine, hvTrack } = makeBoard();
    const dru = `(version 1)
(rule "bad" (condition "A.NetClass == 'HV'" (constraint clearance (min 1mm)))
`;
    expect(() => engine.InitEngine(dru, 'test.kicad_dru')).toThrow(PARSE_ERROR);

    // The implicit rules were reloaded; the engine is not marked valid
    expect(engine.RulesValid()).toBe(false);
    const hv = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, hvTrack, null, F_Cu);
    expect(hv.Value().Min()).toBe(mm(0.5));
  });

  it('the parser reports errors through the reporter as the dialog shows them', () => {
    const rules: DRC_RULE[] = [];
    const reporter = new Reporter();
    const parser = new DRC_RULES_PARSER(
      `(version 1)\n(rule "x" (constraint clearance (min 1mm)) (severity bogus))\n`,
      'test.kicad_dru',
    );
    parser.Parse(rules, reporter);

    expect(rules.length).toBe(1);
    expect(rules[0]!.m_Constraints[0]!.m_Value.Min()).toBe(mm(1));
    const errors = reporter.lines
      .filter((l) => l.severity === RPT_SEVERITY_ERROR)
      .map((l) => l.message);
    // `expected()` swallows to the closing paren of `(severity`, so
    // parseSeverity's own NextTok() then eats the rule's `)` and the rule
    // loop runs into EOF: two errors, as the C++ reports.
    expect(errors.length).toBe(2);
    expect(errors[0]).toBe(
      "ERROR: <a href='2:53'>Unrecognized item 'bogus'.</a> Expected ignore, warning, error, or exclusion.",
    );
    expect(errors[1]).toMatch(/^ERROR: <a href='\d+:\d+'>Missing '\)'\.<\/a>$/);
  });

  it('a version-less file and a missing rule name are reported at their positions', () => {
    const rules: DRC_RULE[] = [];
    const reporter = new Reporter();
    new DRC_RULES_PARSER(`(rule (constraint clearance (min 1mm)))\n`, 'test.kicad_dru').Parse(
      rules,
      reporter,
    );

    const errors = reporter.lines
      .filter((l) => l.severity === RPT_SEVERITY_ERROR)
      .map((l) => l.message);
    expect(errors[0]).toBe("ERROR: <a href='1:1'>Missing version statement.</a>");
    expect(errors[1]).toBe("ERROR: <a href='1:6'>Missing rule name.</a>");
  });

  it('a netclass clearance equal to the board minimum keeps the netclass as its source', () => {
    const { board, engine, sigTrack } = makeBoard();
    board.GetDesignSettings().m_MinClearance = mm(0.2);
    engine.InitEngine(null);

    const c = engine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, sigTrack, null, F_Cu);
    expect(c.Value().Min()).toBe(mm(0.2));
    expect(c.GetName()).toBe("netclass 'Default'");
  });

  it('the own-clearance cache holds until InvalidateClearanceCache', () => {
    const { engine, pad } = makeBoard();
    engine.InitEngine(null);

    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.3));

    // The cache does not see the change (the editor invalidates on the
    // property edit); an invalidation does.
    pad.SetLocalClearance(mm(0.8));
    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.3));

    engine.InvalidateClearanceCache(pad.m_Uuid);
    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.8));

    engine.ClearClearanceCache();
    pad.SetLocalClearance(undefined);
    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.3));
  });

  it('HasGeometryDependentRules counts only explicit rules', () => {
    const { board, engine, hvTrack } = makeBoard();

    // A keepout: an implicit rule whose condition is A.intersectsArea('<uuid>')
    const keepout = new ZONE(board);
    keepout.SetIsRuleArea(true);
    keepout.SetDoNotAllowTracks(true);
    keepout.SetLayer(F_Cu);
    keepout.Outline().NewOutline();
    keepout.Outline().Append(mm(0), mm(-1));
    keepout.Outline().Append(mm(2), mm(-1));
    keepout.Outline().Append(mm(2), mm(1));
    keepout.Outline().Append(mm(0), mm(1));
    board.Add(keepout);

    engine.InitEngine(null);
    expect(engine.HasGeometryDependentRules()).toBe(false);
    expect(engine.HasRulesForConstraintType(DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT)).toBe(true);

    // The keepout's disallow resolves for the track that crosses it
    const d = engine.EvalRules(DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT, hvTrack, null, F_Cu);
    expect(d.m_DisallowFlags & DRC_DISALLOW_T.DRC_DISALLOW_TRACKS).not.toBe(0);
    expect(d.GetName()).toBe('keepout area');

    engine.InitEngine(
      `(version 1)\n(rule "geo" (condition "A.intersectsArea('${keepout.m_Uuid}')") (constraint clearance (min 2mm)))\n`,
      'test.kicad_dru',
    );
    expect(engine.HasGeometryDependentRules()).toBe(true);
  });

  it('netclasses changed after load: InitEngine again clears the clearance cache', () => {
    const { board, engine, hvTrack } = makeBoard();
    engine.InitEngine(null);
    expect(hvTrack.GetOwnClearance(F_Cu)).toBe(mm(0.5));

    board.GetDesignSettings().m_NetSettings.LoadFromJson({
      classes: [DEFAULT_CLASS_JSON, { name: 'HV', clearance: 0.7 }],
      netclass_patterns: [{ pattern: 'HV*', netclass: 'HV' }],
    });
    engine.InitEngine(null);

    expect(hvTrack.GetOwnClearance(F_Cu)).toBe(mm(0.7));
  });
});

describe('BOARD_DESIGN_SETTINGS.LoadFromJson', () => {
  it('reads the rules.* PARAM_SCALED values in mm, defaulting what is missing or out of range', () => {
    const bds = new BOARD().GetDesignSettings();
    bds.m_HoleClearance = mm(0.25);
    bds.m_MinClearance = mm(0.1);

    bds.LoadFromJson({
      rules: {
        min_hole_clearance: 0.2,
        min_copper_edge_clearance: 0.372,
        min_clearance: 99, // over the 25 mm max: the default
        min_resolved_spokes: 3,
      },
      rule_severities: { hole_clearance: 'warning', clearance: 'ignore', bogus_key: 'error' },
      track_widths: [0.0, 0.25, 0.5],
      via_dimensions: [
        { diameter: 0.0, drill: 0.0 },
        { diameter: 0.6, drill: 0.3 },
        { diameter: 1 },
      ],
      diff_pair_dimensions: [{ width: 0.2, gap: 0.15, via_gap: 0.0 }],
      drc_exclusions: ['a|b', ['c|d', 'a comment']],
    });

    expect(bds.m_HoleClearance).toBe(mm(0.2));
    expect(bds.m_CopperEdgeClearance).toBe(mm(0.372));
    expect(bds.m_MinClearance).toBe(mm(DEFAULT_MINCLEARANCE));
    // missing: the default, not the previous value
    expect(bds.m_HoleToHoleMin).toBe(mm(0.25));
    expect(bds.m_MinResolvedSpokes).toBe(3);
    expect(bds.GetSeverity(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)).toBe(RPT_SEVERITY_WARNING);
    expect(bds.GetSeverity(PCB_DRC_CODE.DRCE_CLEARANCE)).toBe(RPT_SEVERITY_IGNORE);
    expect(bds.m_TrackWidthList).toEqual([0, mm(0.25), mm(0.5)]);
    expect(bds.m_ViasDimensionsList.map((v) => [v.m_Diameter, v.m_Drill])).toEqual([
      [0, 0],
      [mm(0.6), mm(0.3)],
    ]);
    expect(bds.m_DiffPairDimensionsList.map((d) => [d.m_Width, d.m_Gap, d.m_ViaGap])).toEqual([
      [mm(0.2), mm(0.15), 0],
    ]);
    expect([...bds.m_DrcExclusions]).toEqual(['a|b', 'c|d']);
  });

  it('the NPTH ring is the project hole clearance once the .kicad_pro is loaded', () => {
    const { board, engine, pad } = makeBoard();
    pad.SetAttribute(PAD_ATTRIB.NPTH);
    pad.SetDrillSize({ x: mm(3), y: mm(3) });
    board.GetDesignSettings().LoadFromJson({ rules: { min_hole_clearance: 0.2 } });
    engine.InitEngine(null);

    expect(pad.GetOwnClearance(F_Cu)).toBe(mm(0.2));
  });
});
