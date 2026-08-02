// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Clearance and Constraints Resolution, assembled for display.
 * Counterpart: `BOARD_INSPECTION_TOOL::reportClearance` / `InspectConstraints`.
 *
 * The rule walk is the engine's and is tested with it. What this covers is the
 * part upstream keeps in the tool rather than the engine: *which* constraints
 * a given pair of items is asked about, and how each section is headed.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  buildClearanceReport,
  buildConstraintsReport,
  formatInspectReport,
  type InspectItem,
} from '@ziroeda/pcbnew/src/drc/drc_inspect.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { DrcItemType } from '@ziroeda/pcbnew/src/drc/drc_rules_engine.js';

const MM = (n: number): number => mmToIU(n);

const item = (type: DrcItemType, desc: string, netClasses = ['Default']): InspectItem => ({
  desc,
  eval: { type, layer: 'F.Cu', netName: 'N1', netClasses },
});

const RULES = parseDrcRules(`(version 1)
  (rule "wide" (constraint clearance (min 0.5mm)))`);

describe('clearance report', () => {
  const track = item('Track', 'Track [N1] on F.Cu');
  const pad = item('Pad', 'Pad 1 of U1');
  const zone = item('Zone', 'Zone [GND]');

  it('asks only about clearance for two ordinary items', () => {
    const s = buildClearanceReport(RULES, track, pad, 'F.Cu');

    expect(s).toHaveLength(1);
    expect(s[0]!.title).toBe('Clearance resolution for:');
  });

  it('heads each section with the layer and both items', () => {
    const s = buildClearanceReport(RULES, track, pad, 'F.Cu');

    expect(s[0]!.subjects).toEqual(['Layer F.Cu', 'Track [N1] on F.Cu', 'Pad 1 of U1']);
  });

  it('carries the engine’s reasoning and its conclusion', () => {
    const text = buildClearanceReport(RULES, track, pad, 'F.Cu')[0]!.lines.join('\n');

    expect(text).toContain('Checking wide.');
    expect(text).toContain(`Resolved clearance: min ${MM(0.5)}.`);
  });

  it('asks about the thermal constraints for a pad against a zone', () => {
    // The zone connection decides whether the other three even apply, so it
    // comes first — that ordering is upstream's and is what makes the page
    // readable top to bottom.
    const s = buildClearanceReport(RULES, pad, zone, 'F.Cu');

    expect(s.map((x) => x.title)).toEqual([
      'Zone connection resolution for:',
      'Thermal-relief gap resolution for:',
      'Thermal-relief spoke width resolution for:',
      'Thermal-relief min spoke count resolution for:',
      'Clearance resolution for:',
    ]);
  });

  it('recognises the pad/zone pair in either order', () => {
    expect(buildClearanceReport(RULES, zone, pad, 'F.Cu')).toHaveLength(5);
  });

  it('does not treat two zones as a pad/zone pair', () => {
    expect(buildClearanceReport(RULES, zone, zone, 'F.Cu')).toHaveLength(1);
  });

  it('reports a local override and stops consulting rules', () => {
    // Consulting rules whose answer cannot be used would suggest they were
    // involved in the outcome.
    const text = buildClearanceReport(RULES, track, pad, 'F.Cu', MM(0.9))[0]!.lines.join('\n');

    expect(text).toContain('Local override');
    expect(text).not.toContain('Checking wide.');
  });

  it('applies the override only to clearance, not the thermal sections', () => {
    // A pad's own clearance says nothing about its thermal relief.
    const s = buildClearanceReport(RULES, pad, zone, 'F.Cu', MM(0.9));
    const gap = s.find((x) => x.title.startsWith('Thermal-relief gap'))!;

    expect(gap.lines.join('\n')).not.toContain('Local override');
  });
});

describe('constraints report', () => {
  it('asks a via about its own dimensions', () => {
    const s = buildConstraintsReport(RULES, item('Via', 'Via [N1]'), 'F.Cu');

    expect(s.map((x) => x.title)).toEqual([
      'via_diameter resolution for:',
      'hole_size resolution for:',
      'annular_width resolution for:',
    ]);
  });

  it('asks a track about its width, length and angle', () => {
    const s = buildConstraintsReport(RULES, item('Track', 'Track [N1]'), 'F.Cu');

    expect(s.map((x) => x.title)).toEqual([
      'track_width resolution for:',
      'track_segment_length resolution for:',
      'track_angle resolution for:',
    ]);
  });

  it('asks text about its height and thickness', () => {
    const s = buildConstraintsReport(RULES, item('Text', "Text 'REV'"), 'F.SilkS');

    expect(s.map((x) => x.title)).toEqual([
      'text_height resolution for:',
      'text_thickness resolution for:',
    ]);
  });

  it('heads a single-item section with just that item', () => {
    const s = buildConstraintsReport(RULES, item('Via', 'Via [N1]'), 'F.Cu');

    expect(s[0]!.subjects).toEqual(['Layer F.Cu', 'Via [N1]']);
  });

  it('says so when a constraint has nothing defining it', () => {
    const s = buildConstraintsReport(RULES, item('Via', 'Via [N1]'), 'F.Cu');

    expect(s[0]!.lines.join('\n')).toContain('No via_diameter constraints defined.');
  });
});

describe('formatting', () => {
  it('renders a section as its title, subjects and lines', () => {
    const text = formatInspectReport(
      buildClearanceReport(RULES, item('Track', 'T'), item('Pad', 'P'), 'F.Cu'),
    );

    expect(text).toContain('Clearance resolution for:');
    expect(text).toContain('  - Layer F.Cu');
    expect(text).toContain('  Checking wide.');
  });

  it('separates sections by a blank line', () => {
    const text = formatInspectReport(
      buildClearanceReport(RULES, item('Pad', 'P'), item('Zone', 'Z'), 'F.Cu'),
    );

    expect(text).toContain('\n\n');
  });
});
