// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule Area Properties (DIALOG_RULE_AREA_PROPERTIES): the five do-not-allow
 * flags, the placement page, and the source patching that carries both into
 * the file.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  collectPlacementPage,
  collectPlacementSources,
  hasKeepoutParametersSet,
  initialRuleAreaPage,
  placementFromPage,
  ruleAreaValuesError,
  withPlacementRadio,
  withPlacementSelection,
  type PlacementSources,
  type RuleAreaValues,
} from '@ziroeda/pcbnew/dialogs/dialog_rule_area_properties.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/types.js';
import { writtenItems } from './support/written_node.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const zone = (b: Board, i = 0): PcbZone => b.zones[i]!;
/** The written items, one line, header excluded. */
const flat = (b: Board): string => writtenItems(b);

const KEEPOUT = `(keepout (tracks not_allowed) (vias not_allowed) (pads allowed)
    (copperpour allowed) (footprints allowed))`;

/** One rule area, plus whatever extra zone/footprint text a case needs. */
const src = (opts: { keepout?: string; placement?: string; extra?: string } = {}): string => `
(kicad_pcb (version 20240108) (generator test)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (zone (net 0) (net_name "") (layer "F.Cu") (uuid "ra") (name "guard") (hatch edge 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    ${opts.keepout ?? KEEPOUT}
    ${opts.placement ?? ''}
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
  ${opts.extra ?? ''}
)`;

describe('reading a rule area', () => {
  it('treats a zone carrying only (placement …) as a rule area', () => {
    // Upstream's parser calls SetIsRuleArea from the placement case too. If
    // this regressed, such a zone would be poured as copper.
    const b = load(
      src({ keepout: '', placement: '(placement (enabled yes) (sheetname "/pwr/"))' }),
    );
    expect(zone(b).ruleArea).toEqual({
      tracks: true,
      vias: true,
      pads: true,
      copperPour: false,
      footprints: false,
    });
    expect(zone(b).placementArea).toEqual({
      enabled: true,
      sourceType: 'sheetname',
      source: '/pwr/',
    });
  });

  it('leaves a plain copper zone alone', () => {
    const b = load(src({ keepout: '' }));
    expect(zone(b).ruleArea).toBeUndefined();
    expect(zone(b).placementArea).toBeUndefined();
  });

  it('reads each placement source token, and defaults a bare (placement)', () => {
    const of = (p: string) => zone(load(src({ placement: p }))).placementArea;

    expect(of('(placement (enabled no) (component_class "RF"))')).toEqual({
      enabled: false,
      sourceType: 'component_class',
      source: 'RF',
    });
    expect(of('(placement (enabled yes) (group "bank A"))')).toEqual({
      enabled: true,
      sourceType: 'group',
      source: 'bank A',
    });
    // No name token at all: the ZONE constructor's SHEETNAME and "" stand.
    expect(of('(placement)')).toEqual({ enabled: false, sourceType: 'sheetname', source: '' });
  });

  it('passes the placement block through the writer untouched', () => {
    // The writer emits a stored source verbatim; if it ever rebuilt the node
    // from the model, an unmodelled placement token would vanish on save.
    const b = load(src({ placement: '(placement (enabled yes) (group "bank A"))' }));
    expect(flat(b)).toContain('(placement (enabled yes) (group "bank A"))');
  });
});

describe('collectPlacementSources', () => {
  const board = load(
    src({
      extra: `
  (footprint "R" (layer "F.Cu") (at 1 1) (uuid "f1") (sheetname "/pwr/"))
  (footprint "C" (layer "F.Cu") (at 2 2) (uuid "f2") (sheetname "/amp/"))
  (footprint "L" (layer "F.Cu") (at 3 3) (uuid "f3") (sheetname "/pwr/"))
  (footprint "U" (layer "F.Cu") (at 4 4) (uuid "f4"))
  (group "bank A" (uuid "g1") (members "f1" "f2"))
  (group "" (uuid "g2") (members "f4"))
  (group "unused" (uuid "g3") (members "zz"))`,
    }),
  );

  it('offers each sheet once, sorted, including the nameless one', () => {
    // A footprint with no sheet contributes the empty string upstream; drop it
    // and a board of loose footprints offers nothing at all.
    expect(collectPlacementSources(board).sheetNames).toEqual(['', '/amp/', '/pwr/']);
  });

  it('offers only named groups that actually hold a footprint', () => {
    // "unused" holds no footprint and "" has no name, so neither is offered.
    expect(collectPlacementSources(board).groupNames).toEqual(['bank A']);
  });
});
