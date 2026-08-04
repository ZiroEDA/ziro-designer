// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule Area Properties (DIALOG_RULE_AREA_PROPERTIES): the five do-not-allow
 * flags, the placement page, and the source patching that carries both into
 * the file.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyRuleAreaValues,
  collectPlacementPage,
  collectPlacementSources,
  collectRuleAreaValues,
  hasKeepoutParametersSet,
  initialRuleAreaPage,
  placementFromPage,
  ruleAreaValuesError,
  uniqueZoneName,
  withPlacementRadio,
  withPlacementSelection,
  type PlacementSources,
  type RuleAreaValues,
} from '@ziroeda/pcbnew/src/rule_area_properties.js';
import { convertToZone } from '@ziroeda/pcbnew/src/convert_shapes.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const zone = (b: Board, i = 0): PcbZone => b.zones[i]!;
const flat = (b: Board): string => serializeBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');

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
  it('takes the do-not-allow sense from the file, not the file spelling', () => {
    // If these ever read back inverted, every DRC keepout rule fires backwards.
    const v = collectRuleAreaValues(zone(load(src())));
    expect(v.doNotAllowTracks).toBe(true);
    expect(v.doNotAllowVias).toBe(true);
    expect(v.doNotAllowPads).toBe(false);
    expect(v.doNotAllowCopperPour).toBe(false);
    expect(v.doNotAllowFootprints).toBe(false);
  });

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

describe('HasKeepoutParametersSet and the opening page', () => {
  const base = collectRuleAreaValues(zone(load(src())));
  const none: RuleAreaValues = {
    ...base,
    doNotAllowTracks: false,
    doNotAllowVias: false,
    doNotAllowPads: false,
    doNotAllowCopperPour: false,
    doNotAllowFootprints: false,
  };

  it('is true when any single flag forbids something', () => {
    expect(hasKeepoutParametersSet(none)).toBe(false);
    // Each flag has to count on its own; an omitted one would hide its page.
    expect(hasKeepoutParametersSet({ ...none, doNotAllowTracks: true })).toBe(true);
    expect(hasKeepoutParametersSet({ ...none, doNotAllowVias: true })).toBe(true);
    expect(hasKeepoutParametersSet({ ...none, doNotAllowPads: true })).toBe(true);
    expect(hasKeepoutParametersSet({ ...none, doNotAllowCopperPour: true })).toBe(true);
    expect(hasKeepoutParametersSet({ ...none, doNotAllowFootprints: true })).toBe(true);
  });

  it('opens on Placement only for an area that forbids nothing', () => {
    expect(initialRuleAreaPage(none)).toBe(0);
    expect(initialRuleAreaPage({ ...none, placementEnabled: true })).toBe(1);
    // Both set: Keepouts still wins.
    expect(initialRuleAreaPage({ ...base, placementEnabled: true })).toBe(0);
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

describe('the placement page', () => {
  const sources: PlacementSources = {
    sheetNames: ['/amp/', '/pwr/'],
    componentClassNames: [],
    groupNames: ['bank A'],
  };
  const values = (over: Partial<RuleAreaValues>): RuleAreaValues => ({
    ...collectRuleAreaValues(zone(load(src()))),
    ...over,
  });

  it('preselects the zone’s own source and ticks its radio', () => {
    const page = collectPlacementPage(
      values({
        placementEnabled: true,
        placementSourceType: 'sheetname',
        placementSource: '/pwr/',
      }),
      sources,
    );

    expect(page.sheet.selected).toBe(1);
    expect(page.enabled).toBe('sheetname');
    expect(page.notFoundName).toBe('');
    // The other combos still default to their first entry, or to nothing.
    expect(page.group.selected).toBe(0);
    expect(page.componentClass.selected).toBe(-1);
  });

  it('remembers a disabled area’s source instead of resetting it', () => {
    const page = collectPlacementPage(
      values({ placementEnabled: false, placementSource: '/amp/' }),
      sources,
    );

    expect(page.enabled).toBeNull();
    // Disabled or not, OK must write the source back; losing it here would
    // silently retarget the area the next time it is switched on.
    expect(placementFromPage(page)).toEqual({
      enabled: false,
      sourceType: 'sheetname',
      source: '/amp/',
    });
  });

  it('keeps a source the board no longer has', () => {
    // The netlist-update case: the sheet is gone, and OK must hand back the
    // stored name rather than the decorated label or the first live sheet.
    const page = collectPlacementPage(values({ placementSource: '/gone/' }), sources);

    expect(page.sheet.options[0]).toBe('Not found on board: /gone/');
    expect(page.sheet.selected).toBe(0);
    expect(page.notFoundName).toBe('/gone/');
    expect(placementFromPage(page).source).toBe('/gone/');
  });

  it('does not smuggle the decorated label into another source type', () => {
    // Index 0 of the *group* list is an ordinary entry, so the not-found
    // restore must not fire once the user has switched type.
    const page = withPlacementRadio(
      collectPlacementPage(values({ placementSource: '/gone/' }), sources),
      'group',
    );

    expect(placementFromPage(page)).toEqual({
      enabled: true,
      sourceType: 'group',
      source: 'bank A',
    });
  });

  it('writes nothing when the chosen combo is empty', () => {
    // No component classes exist, so the combo is at wxNOT_FOUND and there is
    // no string to read; reading options[-1] would be undefined, not ''.
    const page = withPlacementRadio(collectPlacementPage(values({}), sources), 'component_class');
    expect(page.componentClass.selected).toBe(-1);
    expect(placementFromPage(page)).toEqual({
      enabled: true,
      sourceType: 'component_class',
      source: '',
    });
  });

  it('leaves the last-clicked type behind when the area is disabled', () => {
    // "Disabled" has no handler upstream, so m_lastPlacementSourceType keeps
    // the group the user clicked and the source type stays `group`.
    const page = withPlacementRadio(
      withPlacementRadio(collectPlacementPage(values({}), sources), 'group'),
      null,
    );

    expect(page.lastSourceType).toBe('group');
    expect(placementFromPage(page)).toEqual({
      enabled: false,
      sourceType: 'group',
      source: 'bank A',
    });
  });

  it('reads back the combo entry the user picked', () => {
    const page = withPlacementSelection(
      withPlacementRadio(collectPlacementPage(values({}), sources), 'sheetname'),
      'sheetname',
      1,
    );
    expect(placementFromPage(page).source).toBe('/pwr/');
  });
});

describe('validation', () => {
  const base = collectRuleAreaValues(zone(load(src())));

  it('refuses a rule area with no layer, before anything else', () => {
    // The layer check comes first upstream, so a doubly-bad form reports it.
    expect(ruleAreaValuesError({ ...base, layers: [], hatchPitch: 0 })).toEqual({
      field: 'layers',
      kind: 'empty',
      bound: 0,
    });
  });

  it('holds the hatch pitch to ZONE_BORDER_HATCH_{MIN,MAX}DIST_MM', () => {
    expect(ruleAreaValuesError({ ...base, hatchPitch: MM(0.09) })).toEqual({
      field: 'hatchPitch',
      kind: 'min',
      bound: MM(0.1),
    });
    expect(ruleAreaValuesError({ ...base, hatchPitch: MM(2.01) })).toEqual({
      field: 'hatchPitch',
      kind: 'max',
      bound: MM(2.0),
    });
    // The bounds themselves are legal.
    expect(ruleAreaValuesError({ ...base, hatchPitch: MM(0.1) })).toBeNull();
    expect(ruleAreaValuesError({ ...base, hatchPitch: MM(2.0) })).toBeNull();
  });

  it('applies nothing at all when the values are refused', () => {
    const b = load(src());
    expect(applyRuleAreaValues(b, 0, { ...base, layers: [] })).toBe(b);
  });
});

describe('uniqueZoneName', () => {
  const b = load(
    src({ extra: `(zone (net 0) (layer "F.Cu") (name "guard_1") (polygon (pts (xy 0 0))))` }),
  );

  it('leaves a free name, and an empty one, alone', () => {
    expect(uniqueZoneName(b, 'other')).toBe('other');
    expect(uniqueZoneName(b, '')).toBe('');
  });

  it('counts up from the root rather than stacking suffixes', () => {
    // "guard" and "guard_1" are both taken, so the next free root copy is _2.
    expect(uniqueZoneName(b, 'guard')).toBe('guard_2');
    // A name that already ends in _<digits> loses the suffix before counting,
    // which is what stops foo_1 becoming foo_1_1.
    expect(uniqueZoneName(b, 'guard_1')).toBe('guard_2');
  });

  it('only strips an all-digit suffix', () => {
    const c = load(src({ extra: `(zone (net 0) (layer "F.Cu") (name "guard_a"))` }));
    expect(uniqueZoneName(c, 'guard_a')).toBe('guard_a_1');
  });
});

describe('apply', () => {
  const b = load(src());
  const base = collectRuleAreaValues(zone(b));
  const edit = (over: Partial<RuleAreaValues>): Board =>
    applyRuleAreaValues(b, 0, { ...base, ...over });

  it('writes every flag through to the file and back', () => {
    const out = zone(
      roundTrip(
        edit({
          doNotAllowTracks: false,
          doNotAllowVias: false,
          doNotAllowPads: true,
          doNotAllowCopperPour: true,
          doNotAllowFootprints: true,
        }),
      ),
    );

    // A flag that failed to reach the source would come back as it went in.
    expect(out.ruleArea).toEqual({
      tracks: false,
      vias: false,
      pads: true,
      copperPour: true,
      footprints: true,
    });
  });

  it('writes the placement block, disabled area included', () => {
    const out = edit({
      placementEnabled: false,
      placementSourceType: 'group',
      placementSource: 'bank A',
    });

    expect(flat(out)).toContain('(placement (enabled no) (group "bank A"))');
    expect(zone(roundTrip(out)).placementArea).toEqual({
      enabled: false,
      sourceType: 'group',
      source: 'bank A',
    });
  });

  it('replaces the source token when the type changes', () => {
    // Leaving the old (sheetname …) behind would make the parser's
    // last-token-wins read the stale source.
    const out = edit({ placementSourceType: 'component_class', placementSource: 'RF' });
    const text = flat(out);

    expect(text).toContain('(component_class "RF")');
    expect(zone(roundTrip(out)).placementArea?.sourceType).toBe('component_class');
  });

  it('converts a copper zone into a rule area', () => {
    // The dialog's SetIsRuleArea( true ) is unconditional — this is the
    // "Convert to Rule Area" path, and the zone has no (keepout …) yet.
    const copper = load(src({ keepout: '' }));
    const out = applyRuleAreaValues(copper, 0, collectRuleAreaValues(zone(copper)));
    const back = zone(roundTrip(out));

    expect(back.ruleArea).toEqual({
      tracks: true,
      vias: true,
      pads: true,
      copperPour: false,
      footprints: false,
    });
    expect(back.placementArea).toEqual({
      enabled: false,
      sourceType: 'sheetname',
      source: '',
    });
  });

  it('puts the new tokens before the fill, where the writer puts them', () => {
    const text = flat(
      applyRuleAreaValues(load(src({ keepout: '' })), 0, {
        ...base,
        doNotAllowTracks: true,
      }),
    );

    // Appending them at the end would still parse, but would put them after
    // the filled polygons, which no KiCad-written board ever does.
    expect(text.indexOf('(keepout')).toBeLessThan(text.indexOf('(fill'));
    expect(text.indexOf('(placement')).toBeLessThan(text.indexOf('(fill'));
  });

  it('zeroes the priority, which a rule area does not use', () => {
    const withPriority = load(
      src().replace('(min_thickness 0.25)', '(priority 3) (min_thickness 0.25)'),
    );
    expect(zone(withPriority).priority).toBe(3);

    const out = applyRuleAreaValues(withPriority, 0, collectRuleAreaValues(zone(withPriority)));
    // Both the model and the token: a reload would read 0 back either way, so
    // only the in-memory zone can show whether the dialog really zeroed it.
    expect(zone(out).priority).toBe(0);
    expect(flat(out)).not.toContain('(priority');
  });

  it('changes the border style and pitch, and the lock', () => {
    const out = zone(roundTrip(edit({ hatchStyle: 'full', hatchPitch: MM(1), locked: true })));
    expect(out.hatchStyle).toBe('full');
    expect(out.hatchPitch).toBe(MM(1));
    expect(out.locked).toBe(true);
  });

  it('moves the area onto other layers', () => {
    const out = edit({ layers: ['F.Cu', 'B.Cu'] });
    expect(flat(out)).toContain('(layers "F.Cu" "B.Cu")');
    expect(flat(out)).not.toContain('(layer "F.Cu")');
    expect(zone(roundTrip(out)).layers).toEqual(['F.Cu', 'B.Cu']);
  });

  it('leaves a name the user did not touch, even a colliding one', () => {
    // Upstream issue 23131: re-OKing a zone that already shares its name with
    // another must not silently rename it.
    const two = load(
      src({ extra: `(zone (net 0) (layer "F.Cu") (name "guard") (polygon (pts (xy 0 0))))` }),
    );
    const untouched = applyRuleAreaValues(two, 1, collectRuleAreaValues(zone(two, 1)));
    expect(zone(untouched, 1).name).toBe('guard');
  });

  it('uniquifies a name the user typed onto a collision', () => {
    const two = load(
      src({ extra: `(zone (net 0) (layer "F.Cu") (name "other") (polygon (pts (xy 0 0))))` }),
    );
    const typed = applyRuleAreaValues(two, 1, {
      ...collectRuleAreaValues(zone(two, 1)),
      name: 'guard',
    });
    expect(zone(roundTrip(typed), 1).name).toBe('guard_1');

    // A free name is taken as typed.
    const renamed = applyRuleAreaValues(b, 0, { ...base, name: 'shield' });
    expect(zone(roundTrip(renamed)).name).toBe('shield');
  });

  it('writes a placement block for a rule area built from scratch', () => {
    // A converted rule area has no stored source, so the canonical builder
    // runs instead — and upstream's writer emits `(placement …)` for every
    // rule area, not just the ones that came out of a file with one.
    const { board: converted } = convertToZone(load(src()), ['zone:0'], {
      layer: 'F.Cu',
      ruleArea: true,
    });
    const back = zone(roundTrip(converted), 1);

    expect(flat(converted)).toContain('(placement (enabled no) (sheetname ""))');
    expect(back.placementArea).toEqual({
      enabled: false,
      sourceType: 'sheetname',
      source: '',
    });
  });

  it('drops the name token when the field is cleared', () => {
    const out = edit({ name: '' });
    expect(flat(out)).not.toContain('(name ');
    expect(zone(roundTrip(out)).name).toBeUndefined();
  });
});
