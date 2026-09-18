// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_rule_parser.h` + `.cpp`: the `.kicad_dru` reader.
 * `DRC_RULES_LEXER` is DSNLEXER over `common/drc_rules.keywords`; here a
 * keyword is its text, so `case 'clearance':` is `case T_clearance:`.
 */
import { DSNLEXER, PARSE_ERROR, T, type Tok } from '@ziroeda/common/src/dsnlexer.js';
import type { EdaDataType, EdaUnits } from '@ziroeda/common/src/eda_units.js';
import {
  type PCB_LAYER_ID,
  PCB_LAYER_ID as LAYER,
  ToLAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import {
  type Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_UNDEFINED,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/src/reporter.js';

import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { COMPONENT_CLASS_ASSIGNMENT_RULE } from '../component_classes/component_class_assignment_rule.js';
import {
  PCBEXPR_EVALUATOR,
  PCBEXPR_UNIT_RESOLVER,
  PCBEXPR_UNITLESS_RESOLVER,
  wxMatches,
} from '../pcbexpr_evaluator.js';
import { ZONE_CONNECTION } from '../zones.js';
import {
  DRC_CONSTRAINT,
  DRC_CONSTRAINT_OPTIONS,
  DRC_CONSTRAINT_T,
  DRC_DISALLOW_T,
  DRC_RULE,
} from './drc_rule.js';
import { DRC_RULE_CONDITION } from './drc_rule_condition.js';

export const DRC_RULE_FILE_VERSION = 20200610;

/** `wxString::BeforeFirst( '|', &rest )` */
function beforeFirstBar(aMessage: string): [string, string] {
  const bar = aMessage.indexOf('|');

  if (bar < 0) return [aMessage, ''];

  return [aMessage.slice(0, bar), aMessage.slice(bar + 1)];
}

export class DRC_RULES_PARSER extends DSNLEXER {
  private m_requiredVersion: number;
  private m_tooRecent: boolean;
  private m_reporter: Reporter | null;

  constructor(aSource: string, aSourceDescr: string) {
    super(aSource, aSourceDescr);
    this.m_requiredVersion = 0;
    this.m_tooRecent = false;
    this.m_reporter = null;
  }

  private reportError(aMessage: string, aOffset = 0): void {
    const [first, rest] = beforeFirstBar(aMessage);

    if (this.m_reporter) {
      const msg = `ERROR: <a href='${this.CurLineNumber()}:${this.CurOffset() + aOffset}'>${first}</a>${rest}`;

      this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
    } else {
      const msg = `ERROR: ${first}${rest}`;

      throw new PARSE_ERROR(
        msg,
        this.CurSource(),
        this.CurLine(),
        this.CurLineNumber(),
        this.CurOffset() + aOffset,
      );
    }
  }

  private reportDeprecation(oldToken: string, newToken: string): void {
    if (this.m_reporter) {
      const msg = `The '${oldToken}' keyword has been deprecated.  Please use '${newToken}' instead.`;

      this.m_reporter.report(msg, RPT_SEVERITY_WARNING);
    }
  }

  private checkUnresolvedTextVariable(): boolean {
    const pos = this.CurText().indexOf('${');

    if (pos < 0) return false;

    this.reportError('Unresolved text variable', pos);
    return true;
  }

  private parseUnknown(): void {
    let depth = 1;

    for (let token = this.NextTok(); token !== T.EOF; token = this.NextTok()) {
      if (token === T.LEFT) depth++;

      if (token === T.RIGHT) {
        if (--depth === 0) break;
      }
    }
  }

  private expected(expectedTokens: string): void {
    let msg: string;

    if (this.CurText().startsWith('${')) msg = 'Unresolved text variable.';
    else msg = `Unrecognized item '${this.CurText()}'.| Expected ${expectedTokens}.`;

    this.reportError(msg);
    this.parseUnknown();
  }

  private parseExpression(): string {
    let expr = '';
    let depth = 1;

    for (let token = this.NextTok(); token !== T.EOF; token = this.NextTok()) {
      if (token === T.LEFT) depth++;

      if (token === T.RIGHT) {
        if (--depth === 0) break;
      }

      if (expr.length > 0) expr += this.CurSeparator();

      this.checkUnresolvedTextVariable();
      expr += this.CurText();
    }

    return expr;
  }

  Parse(aRules: DRC_RULE[], aReporter: Reporter | null): void {
    let haveVersion = false;

    this.m_reporter = aReporter;

    for (let token = this.NextTok(); token !== T.EOF; token = this.NextTok()) {
      if (this.checkUnresolvedTextVariable()) continue;

      if (token !== T.LEFT) this.reportError("Missing '('.");

      token = this.NextTok();

      if (!haveVersion && token !== 'version') {
        this.reportError('Missing version statement.');
        haveVersion = true; // don't keep on reporting it
      }

      switch (token) {
        case 'version':
          haveVersion = true;
          token = this.NextTok();

          if (token === T.RIGHT) {
            this.reportError('Missing version number.');
          } else if (token === T.NUMBER) {
            this.m_requiredVersion = Number.parseInt(this.CurText(), 10);
            this.m_tooRecent = this.m_requiredVersion > DRC_RULE_FILE_VERSION;

            if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
          } else {
            this.expected('version number'); // translate "version number"; it is not a token
          }

          break;

        case 'rule':
          aRules.push(this.parseDRC_RULE());
          break;

        case T.EOF:
          this.reportError('Incomplete statement.');
          break;

        default:
          this.expected('rule or version');
      }
    }

    if (this.m_reporter && !this.m_reporter.hasMessage())
      this.m_reporter.report('No errors found.', RPT_SEVERITY_INFO);

    this.m_reporter = null;
  }

  ParseComponentClassAssignmentRules(
    aRules: COMPONENT_CLASS_ASSIGNMENT_RULE[],
    aReporter: Reporter | null,
  ): void {
    let haveVersion = false;

    this.m_reporter = aReporter;

    for (let token = this.NextTok(); token !== T.EOF; token = this.NextTok()) {
      if (token !== T.LEFT) this.reportError("Missing '('.");

      token = this.NextTok();

      if (!haveVersion && token !== 'version') {
        this.reportError('Missing version statement.');
        haveVersion = true; // don't keep on reporting it
      }

      switch (token) {
        case 'version':
          haveVersion = true;
          token = this.NextTok();

          if (token === T.RIGHT) {
            this.reportError('Missing version number.');
          } else if (token === T.NUMBER) {
            this.m_requiredVersion = Number.parseInt(this.CurText(), 10);
            this.m_tooRecent = this.m_requiredVersion > DRC_RULE_FILE_VERSION;

            if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
          } else {
            this.expected('version number'); // translate "version number"; it is not a token
          }

          break;

        case 'assign_component_class': {
          const rule = this.parseComponentClassAssignment();

          if (rule) aRules.push(rule);

          break;
        }

        case T.EOF:
          this.reportError('Incomplete statement.');
          break;

        default:
          this.expected('assign_component_class or version');
      }
    }

    if (this.m_reporter && !this.m_reporter.hasMessage())
      this.m_reporter.report('No errors found.', RPT_SEVERITY_INFO);

    this.m_reporter = null;
  }

  private parseDRC_RULE(): DRC_RULE {
    const rule = new DRC_RULE();

    let token = this.NextTok();

    if (!DSNLEXER.IsSymbol(token)) this.reportError('Missing rule name.');

    this.checkUnresolvedTextVariable();
    rule.m_Name = this.CurText();

    for (token = this.NextTok(); token !== T.RIGHT && token !== T.EOF; token = this.NextTok()) {
      if (this.checkUnresolvedTextVariable()) continue;

      if (token !== T.LEFT) this.reportError("Missing '('.");

      token = this.NextTok();

      switch (token) {
        case 'constraint':
          this.parseConstraint(rule);
          break;

        case 'condition':
          token = this.NextTok();

          if (token === T.RIGHT) {
            this.reportError('Missing condition expression.');
          } else if (DSNLEXER.IsSymbol(token)) {
            this.checkUnresolvedTextVariable();
            rule.m_Condition = new DRC_RULE_CONDITION(this.CurText());

            if (!rule.m_Condition.Compile(this.m_reporter, this.CurLineNumber(), this.CurOffset()))
              this.reportError(`Could not parse expression '${this.CurText()}'.`);

            if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
          } else {
            this.expected('quoted expression'); // translate "quoted expression"; it is not a token
          }

          break;

        case 'layer': {
          if (!rule.m_LayerCondition.equals(LSET.AllLayersMask()))
            this.reportError("'layer' keyword already present.");

          const source: { value: string } = { value: rule.m_LayerSource };
          rule.m_LayerCondition = this.parseLayer(source);
          rule.m_LayerSource = source.value;
          break;
        }

        case 'severity':
          rule.m_Severity = this.parseSeverity();
          break;

        case T.EOF:
          this.reportError('Incomplete statement.');
          return rule;

        default:
          this.expected('constraint, condition, or disallow');
      }
    }

    if (this.CurTok() !== T.RIGHT) this.reportError("Missing ')'.");

    return rule;
  }

  private parseComponentClassAssignment(): COMPONENT_CLASS_ASSIGNMENT_RULE | null {
    let condition: DRC_RULE_CONDITION | null = null;

    let token = this.NextTok();

    if (!DSNLEXER.IsSymbol(token)) this.reportError('Missing component class name.');

    this.checkUnresolvedTextVariable();
    const componentClass = this.CurText();

    for (token = this.NextTok(); token !== T.RIGHT && token !== T.EOF; token = this.NextTok()) {
      if (token !== T.LEFT) this.reportError("Missing '('.");

      token = this.NextTok();

      switch (token) {
        case 'condition':
          token = this.NextTok();

          if (token === T.RIGHT) {
            this.reportError('Missing condition expression.');
          } else if (DSNLEXER.IsSymbol(token)) {
            this.checkUnresolvedTextVariable();
            condition = new DRC_RULE_CONDITION(this.CurText());

            if (!condition.Compile(this.m_reporter, this.CurLineNumber(), this.CurOffset()))
              this.reportError(`Could not parse expression '${this.CurText()}'.`);

            if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
          } else {
            this.expected('quoted expression'); // translate "quoted expression"; it is not a token
          }

          break;

        case T.EOF:
          this.reportError('Incomplete statement.');
          return null;

        default:
          this.expected('condition');
      }
    }

    if (this.CurTok() !== T.RIGHT) this.reportError("Missing ')'.");

    return new COMPONENT_CLASS_ASSIGNMENT_RULE(componentClass, condition);
  }

  private parseConstraint(aRule: DRC_RULE): void {
    const c = new DRC_CONSTRAINT();
    let value = 0;
    let units: EdaUnits = 'unscaled';
    let unitsType: EdaDataType | 'time' | 'length_delay' = 'unitless';
    let msg: string;
    let allowsTimeDomain = false;

    const validateAndSetValueWithUnits = (
      aValue: number,
      aUnits: EdaUnits,
      aSetter: (aValue: number) => void,
    ): void => {
      const unitsTypeTmp = UNITS_PROVIDER.GetTypeFromUnits(aUnits);

      if (!allowsTimeDomain && unitsTypeTmp === 'time')
        this.reportError('Time based units not allowed for constraint type.');

      if (
        (c.m_Value.HasMin() || c.m_Value.HasMax() || c.m_Value.HasOpt()) &&
        unitsType !== unitsTypeTmp
      ) {
        this.reportError('Mixed units for constraint values.');
      }

      unitsType = unitsTypeTmp;
      aSetter(aValue);

      if (allowsTimeDomain) {
        if (unitsType === 'time') {
          c.SetOption(DRC_CONSTRAINT_OPTIONS.TIME_DOMAIN);
          c.ClearOption(DRC_CONSTRAINT_OPTIONS.SPACE_DOMAIN);
        } else {
          c.SetOption(DRC_CONSTRAINT_OPTIONS.SPACE_DOMAIN);
          c.ClearOption(DRC_CONSTRAINT_OPTIONS.TIME_DOMAIN);
        }
      }
    };

    let token = this.NextTok();

    if (this.checkUnresolvedTextVariable()) return;

    if (token === 'mechanical_clearance') {
      this.reportDeprecation('mechanical_clearance', 'physical_clearance');
      token = 'physical_clearance';
    } else if (token === 'mechanical_hole_clearance') {
      this.reportDeprecation('mechanical_hole_clearance', 'physical_hole_clearance');
      token = 'physical_hole_clearance';
    } else if (token === 'hole') {
      this.reportDeprecation('hole', 'hole_size');
      token = 'hole_size';
    } else if (token === T.RIGHT || token === T.EOF) {
      msg =
        'Missing constraint type.|  Expected ' +
        'assertion, clearance, hole_clearance, edge_clearance, physical_clearance, ' +
        'physical_hole_clearance, courtyard_clearance, silk_clearance, hole_size, ' +
        'hole_to_hole, track_width, track_angle, track_segment_length, annular_width, ' +
        'disallow, zone_connection, thermal_relief_gap, thermal_spoke_width, ' +
        'min_resolved_spokes, solder_mask_expansion, solder_paste_abs_margin, ' +
        'solder_paste_rel_margin, length, skew, via_count, via_dangling, via_diameter, ' +
        'diff_pair_gap or diff_pair_uncoupled.';

      this.reportError(msg);
      return;
    }

    switch (token) {
      case 'assertion':
        c.m_Type = DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT;
        break;
      case 'clearance':
        c.m_Type = DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT;
        break;
      case 'creepage':
        c.m_Type = DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT;
        break;
      case 'hole_clearance':
        c.m_Type = DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT;
        break;
      case 'edge_clearance':
        c.m_Type = DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT;
        break;
      case 'hole_size':
        c.m_Type = DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT;
        break;
      case 'hole_to_hole':
        c.m_Type = DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT;
        break;
      case 'courtyard_clearance':
        c.m_Type = DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT;
        break;
      case 'silk_clearance':
        c.m_Type = DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT;
        break;
      case 'text_height':
        c.m_Type = DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT;
        break;
      case 'text_thickness':
        c.m_Type = DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT;
        break;
      case 'track_width':
        c.m_Type = DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT;
        break;
      case 'track_angle':
        c.m_Type = DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT;
        break;
      case 'track_segment_length':
        c.m_Type = DRC_CONSTRAINT_T.TRACK_SEGMENT_LENGTH_CONSTRAINT;
        break;
      case 'connection_width':
        c.m_Type = DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT;
        break;
      case 'annular_width':
        c.m_Type = DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT;
        break;
      case 'via_diameter':
        c.m_Type = DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT;
        break;
      case 'via_dangling':
        c.m_Type = DRC_CONSTRAINT_T.VIA_DANGLING_CONSTRAINT;
        break;
      case 'zone_connection':
        c.m_Type = DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT;
        break;
      case 'thermal_relief_gap':
        c.m_Type = DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT;
        break;
      case 'thermal_spoke_width':
        c.m_Type = DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT;
        break;
      case 'min_resolved_spokes':
        c.m_Type = DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT;
        break;
      case 'solder_mask_expansion':
        c.m_Type = DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT;
        break;
      case 'solder_mask_sliver':
        c.m_Type = DRC_CONSTRAINT_T.SOLDER_MASK_SLIVER_CONSTRAINT;
        break;
      case 'solder_paste_abs_margin':
        c.m_Type = DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT;
        break;
      case 'solder_paste_rel_margin':
        c.m_Type = DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT;
        break;
      case 'disallow':
        c.m_Type = DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT;
        break;
      case 'length':
        c.m_Type = DRC_CONSTRAINT_T.LENGTH_CONSTRAINT;
        break;
      case 'skew':
        c.m_Type = DRC_CONSTRAINT_T.SKEW_CONSTRAINT;
        break;
      case 'via_count':
        c.m_Type = DRC_CONSTRAINT_T.VIA_COUNT_CONSTRAINT;
        break;
      case 'diff_pair_gap':
        c.m_Type = DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT;
        break;
      case 'diff_pair_uncoupled':
        c.m_Type = DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT;
        break;
      case 'physical_clearance':
        c.m_Type = DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT;
        break;
      case 'physical_hole_clearance':
        c.m_Type = DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT;
        break;
      case 'bridged_mask':
        c.m_Type = DRC_CONSTRAINT_T.BRIDGED_MASK_CONSTRAINT;
        break;
      default:
        this.expected(
          'assertion, clearance, hole_clearance, edge_clearance, physical_clearance, ' +
            'physical_hole_clearance, courtyard_clearance, silk_clearance, hole_size, ' +
            'hole_to_hole, track_width, track_angle, track_segment_length, annular_width, ' +
            'disallow, zone_connection, thermal_relief_gap, thermal_spoke_width, ' +
            'min_resolved_spokes, solder_mask_expansion, solder_mask_sliver, ' +
            'solder_paste_abs_margin, solder_paste_rel_margin, length, skew, via_count, ' +
            'via_dangling, via_diameter, diff_pair_gap, diff_pair_uncoupled or bridged_mask',
        );
        return;
    }

    if (aRule.FindConstraint(c.m_Type)) {
      msg = `Rule already has a '${this.CurText()}' constraint.`;
      this.reportError(msg);
    }

    const unitless =
      c.m_Type === DRC_CONSTRAINT_T.VIA_COUNT_CONSTRAINT ||
      c.m_Type === DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT ||
      c.m_Type === DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT ||
      c.m_Type === DRC_CONSTRAINT_T.VIA_DANGLING_CONSTRAINT ||
      c.m_Type === DRC_CONSTRAINT_T.BRIDGED_MASK_CONSTRAINT;

    allowsTimeDomain =
      c.m_Type === DRC_CONSTRAINT_T.LENGTH_CONSTRAINT ||
      c.m_Type === DRC_CONSTRAINT_T.SKEW_CONSTRAINT;

    if (c.m_Type === DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT) {
      for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
        if (token === T.STRING) token = this.GetCurStrAsToken();

        switch (token) {
          case 'track':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_TRACKS;
            break;
          case 'via':
            c.m_DisallowFlags |=
              DRC_DISALLOW_T.DRC_DISALLOW_THROUGH_VIAS |
              DRC_DISALLOW_T.DRC_DISALLOW_BLIND_VIAS |
              DRC_DISALLOW_T.DRC_DISALLOW_BURIED_VIAS |
              DRC_DISALLOW_T.DRC_DISALLOW_MICRO_VIAS;
            break;
          case 'through_via':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_THROUGH_VIAS;
            break;
          case 'blind_via':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_BLIND_VIAS;
            break;
          case 'buried_via':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_BURIED_VIAS;
            break;
          case 'micro_via':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_MICRO_VIAS;
            break;
          case 'pad':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_PADS;
            break;
          case 'zone':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_ZONES;
            break;
          case 'text':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_TEXTS;
            break;
          case 'graphic':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_GRAPHICS;
            break;
          case 'hole':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_HOLES;
            break;
          case 'footprint':
            c.m_DisallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_FOOTPRINTS;
            break;

          case T.EOF:
            this.reportError("Missing ')'.");
            return;

          default:
            this.expected(
              'track, via, through_via, blind_via, micro_via, buried_via, pad, zone, text, ' +
                'graphic, hole, or footprint.',
            );
            return;
        }
      }

      if (this.CurTok() !== T.RIGHT) this.reportError("Missing ')'.");

      aRule.AddConstraint(c);
      return;
    } else if (c.m_Type === DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT) {
      token = this.NextTok();

      if (token === T.STRING) token = this.GetCurStrAsToken();

      switch (token) {
        case 'solid':
          c.m_ZoneConnection = ZONE_CONNECTION.FULL;
          break;
        case 'thermal_reliefs':
          c.m_ZoneConnection = ZONE_CONNECTION.THERMAL;
          break;
        case 'none':
          c.m_ZoneConnection = ZONE_CONNECTION.NONE;
          break;

        case T.EOF:
          this.reportError("Missing ')'.");
          return;

        default:
          this.expected('solid, thermal_reliefs or none.');
          return;
      }

      if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");

      aRule.AddConstraint(c);
      return;
    } else if (c.m_Type === DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT) {
      // We don't use a min/max/opt structure here because it would give a strong implication
      // that you could specify the optimal number of spokes.  We don't want to open that door
      // because the spoke generator is highly optimized around being able to "cheat" off of a
      // cartesian coordinate system.

      token = this.NextTok();

      if (token === T.NUMBER) {
        value = Number.parseInt(this.CurText(), 10);
        c.m_Value.SetMin(value);

        if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
      } else {
        this.expected('number'); // translate "number"; it is not a token
      }

      aRule.AddConstraint(c);
      return;
    } else if (c.m_Type === DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT) {
      token = this.NextTok();

      if (token === T.RIGHT) this.reportError('Missing assertion expression.');

      if (DSNLEXER.IsSymbol(token)) {
        c.m_Test = new DRC_RULE_CONDITION(this.CurText());
        c.m_Test.Compile(this.m_reporter, this.CurLineNumber(), this.CurOffset());

        if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");
      } else {
        this.expected('quoted expression'); // translate "quoted expression"; it is not a token
      }

      aRule.AddConstraint(c);
      return;
    }

    for (token = this.NextTok(); token !== T.RIGHT && token !== T.EOF; token = this.NextTok()) {
      if (token !== T.LEFT) this.reportError("Missing '('.");

      token = this.NextTok();

      switch (token) {
        case 'within_diff_pairs':
          if (c.m_Type === DRC_CONSTRAINT_T.SKEW_CONSTRAINT)
            c.SetOption(DRC_CONSTRAINT_OPTIONS.SKEW_WITHIN_DIFF_PAIRS);
          else this.reportError('within_diff_pairs option invalid for constraint type.');

          if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");

          break;

        case 'min': {
          const offset = this.CurOffset() + DSNLEXER.GetTokenString(token).length;
          const expr = this.parseExpression();

          if (expr.length === 0) {
            this.reportError('Missing min value.');
            break;
          }

          const parsed = this.parseValueWithUnits(offset, expr, unitless);
          value = parsed.result;
          units = parsed.units;
          validateAndSetValueWithUnits(value, units, (aValue: number) => {
            c.m_Value.SetMin(aValue);
          });

          break;
        }

        case 'max': {
          const offset = this.CurOffset() + DSNLEXER.GetTokenString(token).length;
          const expr = this.parseExpression();

          if (expr.length === 0) {
            this.reportError('Missing max value.');
            break;
          }

          const parsed = this.parseValueWithUnits(offset, expr, unitless);
          value = parsed.result;
          units = parsed.units;
          validateAndSetValueWithUnits(value, units, (aValue: number) => {
            c.m_Value.SetMax(aValue);
          });

          break;
        }

        case 'opt': {
          const offset = this.CurOffset() + DSNLEXER.GetTokenString(token).length;
          const expr = this.parseExpression();

          if (expr.length === 0) {
            this.reportError('Missing opt value.');
            break;
          }

          const parsed = this.parseValueWithUnits(offset, expr, unitless);
          value = parsed.result;
          units = parsed.units;
          validateAndSetValueWithUnits(value, units, (aValue: number) => {
            c.m_Value.SetOpt(aValue);
          });

          break;
        }

        case T.EOF:
          this.reportError('Incomplete statement.');
          return;

        default:
          this.expected('min, max, opt, or within_diff_pairs');
      }
    }

    aRule.AddConstraint(c);
  }

  /** `parseValueWithUnits( aOffset, aExpr, aResult, aUnits, aUnitless )`: the two out-params. */
  private parseValueWithUnits(
    aOffset: number,
    aExpr: string,
    aUnitless = false,
  ): { result: number; units: EdaUnits } {
    let aResult = 0;
    let aUnits: EdaUnits = 'unscaled';

    const errorHandler = (message: string, offset: number): void => {
      const [first, rest] = beforeFirstBar(message);

      if (this.m_reporter) {
        const msg = `ERROR: <a href='${this.CurLineNumber()}:${aOffset + offset}'>${first}</a>${rest}`;

        this.m_reporter.report(msg, RPT_SEVERITY_ERROR);
      } else {
        const msg = `ERROR: ${first}${rest}`;

        throw new PARSE_ERROR(
          msg,
          this.CurSource(),
          this.CurLine(),
          this.CurLineNumber(),
          this.CurOffset() + aOffset,
        );
      }
    };

    const evaluator = new PCBEXPR_EVALUATOR(
      aUnitless ? new PCBEXPR_UNITLESS_RESOLVER() : new PCBEXPR_UNIT_RESOLVER(),
    );
    evaluator.SetErrorCallback(errorHandler);

    if (evaluator.Evaluate(aExpr)) {
      aResult = evaluator.Result();
      aUnits = evaluator.Units();
    }

    return { result: aResult, units: aUnits };
  }

  private parseLayer(aSource: { value: string }): LSET {
    let retVal = new LSET();
    const token = this.NextTok();

    if (token === T.RIGHT) {
      this.reportError('Missing layer name or type.');
      return LSET.AllCuMask();
    } else if (token === 'outer') {
      aSource.value = DSNLEXER.GetTokenString(token);
      retVal = LSET.ExternalCuMask();
    } else if (token === 'inner') {
      aSource.value = DSNLEXER.GetTokenString(token);
      retVal = LSET.InternalCuMask();
    } else {
      const layerName = this.CurText();
      const layerMap = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID').Choices();

      for (let ii = 0; ii < layerMap.GetCount(); ++ii) {
        const entry = layerMap.Item(ii);

        if (wxMatches(entry.GetText(), layerName)) {
          aSource.value = layerName;
          retVal.set(ToLAYER_ID(entry.GetValue()));
        }
      }

      if (!retVal.any()) {
        if (!this.checkUnresolvedTextVariable())
          this.reportError(`Unrecognized layer '${layerName}'.`);

        retVal.set(LAYER.Rescue);
      }
    }

    if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");

    return retVal;
  }

  private parseSeverity(): Severity {
    let retVal: Severity = RPT_SEVERITY_UNDEFINED;

    const token = this.NextTok();

    if (token === T.RIGHT || token === T.EOF) {
      this.reportError('Missing severity name.');
      return RPT_SEVERITY_UNDEFINED;
    }

    switch (token) {
      case 'ignore':
        retVal = RPT_SEVERITY_IGNORE;
        break;
      case 'warning':
        retVal = RPT_SEVERITY_WARNING;
        break;
      case 'error':
        retVal = RPT_SEVERITY_ERROR;
        break;
      case 'exclusion':
        retVal = RPT_SEVERITY_EXCLUSION;
        break;

      default:
        this.expected('ignore, warning, error, or exclusion');
    }

    if (this.NextTok() !== T.RIGHT) this.reportError("Missing ')'.");

    return retVal;
  }
}
