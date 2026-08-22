// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB editor's four toolbars against
 * `PCB_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig` (`toolbars_pcb_editor.cpp:141`).
 *
 * The expected lists are transcribed from that switch, never derived from the
 * tables under test.
 */
import { describe, expect, it } from 'vitest';
import {
  PCB_TOP_TOOLBAR,
  PCB_AUX_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
  PCB_CONTROL,
} from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import { BITMAP } from '@ziroeda/designer/src/ui/toolbar_bitmaps.js';
import type { ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

/** One rendered slot: a button id, `GROUP:name`, `CTRL:name`, or a separator. */
const slots = (entries: readonly ToolEntry[]): string[] =>
  entries.map((e) => {
    if (e === 'sep') return '---';
    if ('group' in e) return `GROUP:${e.group}`;
    if ('control' in e) return `CTRL:${e.control}`;
    if ('spacer' in e) return `SPACER:${e.spacer}`;
    return e.id;
  });

const groupOf = (entries: readonly ToolEntry[], name: string): string[] => {
  const g = entries.find((e) => e !== 'sep' && 'group' in e && e.group === name);
  expect(g, `group ${name} is missing`).toBeDefined();
  if (g === undefined || g === 'sep' || !('group' in g)) return [];
  return g.actions.map((a) => a.id);
};

describe('TOOLBAR_LOC::RIGHT is the config, slot for slot', () => {
  it('renders 24 slots and 3 separators, in upstream order', () => {
    expect(slots(PCB_RIGHT_TOOLBAR)).toEqual([
      'GROUP:Selection modes',
      'localRatsnestTool',
      '---',
      'placeFootprint',
      'GROUP:Track routing tools',
      'GROUP:Track tuning tools',
      'drawVia',
      'drawZone',
      'drawRuleArea',
      '---',
      'drawLine',
      'drawArc',
      'drawRectangle',
      'drawCircle',
      'drawPolygon',
      'drawBezier',
      'placeReferenceImage',
      'placeText',
      'drawTextBox',
      'drawTable',
      'GROUP:Dimension objects',
      'placeBarcode',
      'deleteTool',
      '---',
      'GROUP:PCB origins and points',
      'placePoint',
      'measureTool',
    ]);
  });

  it('has exactly the five groups upstream declares', () => {
    const groups = slots(PCB_RIGHT_TOOLBAR).filter((s) => s.startsWith('GROUP:'));
    expect(groups).toEqual([
      'GROUP:Selection modes',
      'GROUP:Track routing tools',
      'GROUP:Track tuning tools',
      'GROUP:Dimension objects',
      'GROUP:PCB origins and points',
    ]);
  });

  it.each([
    ['Selection modes', ['selectSetRect', 'selectSetLasso']],
    ['Track routing tools', ['routeSingleTrack', 'routeDiffPair']],
    ['Track tuning tools', ['tuneSingleTrack', 'tuneDiffPair', 'tuneSkew']],
    [
      'Dimension objects',
      [
        'drawOrthogonalDimension',
        'drawAlignedDimension',
        'drawCenterDimension',
        'drawRadialDimension',
        'drawLeader',
      ],
    ],
    ['PCB origins and points', ['gridSetOrigin', 'drillOrigin']],
  ])('group %s holds exactly its AddAction list', (name, members) => {
    expect(groupOf(PCB_RIGHT_TOOLBAR, name)).toEqual(members);
  });
});

describe('the five inventions are gone, each named', () => {
  const ids = new Set(
    PCB_RIGHT_TOOLBAR.flatMap((e) =>
      e === 'sep' ? [] : 'group' in e ? e.actions.map((a) => a.id) : 'id' in e ? [e.id] : [],
    ),
  );
  const groups = new Set(slots(PCB_RIGHT_TOOLBAR).filter((s) => s.startsWith('GROUP:')));

  // Each of these returns ZERO files from a grep of the whole 10.0.5 tree,
  // while drawArc/drawCircle/placeText/drawTextBox/tuneSkew return 6-23. One
  // assertion each, because a single "the bar contains none of them" check
  // would pass while a sibling survived.
  it.each([
    'showDiffPhaseSkew',
    'drawEllipseArc',
    'drawEllipse',
    'addConstraintCoincident',
    'addConstraintPointOnLine',
    'addConstraintMidpoint',
    'addConstraintSymmetric',
    'addConstraintParallel',
    'addConstraintPerpendicular',
    'addConstraintCollinear',
    'addConstraintHorizontal',
    'addConstraintVertical',
    'addConstraintTangent',
    'addConstraintEqualLength',
    'addConstraintEqualRadius',
    'addConstraintConcentric',
    'addConstraintFixedLength',
    'addConstraintFixedRadius',
    'addConstraintArcAngle',
    'addConstraintAngular',
  ])('%s is not a button', (id) => {
    expect(ids.has(id)).toBe(false);
  });

  it.each([
    'GROUP:Arc',
    'GROUP:Circle',
    'GROUP:Constraints',
    'GROUP:Text objects',
  ])('%s is not a group', (g) => {
    expect(groups.has(g)).toBe(false);
  });

  it('keeps the real actions those groups had wrapped, flat', () => {
    // Upstream AppendActions them; only a group renders as one button.
    for (const id of ['drawArc', 'drawCircle', 'placeText', 'drawTextBox']) {
      expect(slots(PCB_RIGHT_TOOLBAR)).toContain(id);
    }
  });

  it('leaves no bitmap behind for an action that does not exist', () => {
    for (const id of ['showDiffPhaseSkew', 'drawEllipseArc', 'drawEllipse']) {
      expect(BITMAP).not.toHaveProperty(id);
    }
    expect(Object.keys(BITMAP).filter((k) => k.startsWith('addConstraint'))).toEqual([]);
  });
});

describe('TOOLBAR_LOC::TOP_AUX is a toolbar, not a row of loose widgets', () => {
  it('is the five controls, two actions and five separators, in order', () => {
    expect(slots(PCB_AUX_TOOLBAR)).toEqual([
      `CTRL:${PCB_CONTROL.trackWidth}`,
      'autoTrackWidth',
      '---',
      `CTRL:${PCB_CONTROL.viaDiameter}`,
      '---',
      `CTRL:${PCB_CONTROL.layerSelector}`,
      'selectLayerPair',
      '---',
      `CTRL:${PCB_CONTROL.gridSelect}`,
      '---',
      `CTRL:${PCB_CONTROL.zoomSelect}`,
      '---',
      `CTRL:${PCB_CONTROL.overrideLocks}`,
    ]);
  });

  it('puts no separator between the track width box and its toggle', () => {
    const s = slots(PCB_AUX_TOOLBAR);
    expect(s[s.indexOf('autoTrackWidth') - 1]).toBe(`CTRL:${PCB_CONTROL.trackWidth}`);
  });

  it('marks autoTrackWidth a toggle, as its TOOLBAR_STATE::TOGGLE says', () => {
    const b = PCB_AUX_TOOLBAR.find((e) => e !== 'sep' && 'id' in e && e.id === 'autoTrackWidth');
    expect(b).toBeDefined();
    if (b === undefined || b === 'sep' || !('id' in b)) return;
    expect(b.toggle).toBe(true);
  });
});

describe('TOOLBAR_LOC::TOP_MAIN closes with the variant choice', () => {
  it('ends on showEeschema then the currentVariant control', () => {
    const s = slots(PCB_TOP_TOOLBAR);
    expect(s.slice(-2)).toEqual(['showEeschema', `CTRL:${PCB_CONTROL.currentVariant}`]);
  });

  it('emits nothing for ipcScripting, which needs wxPython to render', () => {
    // Its factory only adds a separator and showPythonConsole
    // `if( scriptingAvailable || haveApiPlugins )`. A browser has neither.
    expect(slots(PCB_TOP_TOOLBAR)).not.toContain('showPythonConsole');
    expect(slots(PCB_TOP_TOOLBAR)).not.toContain('CTRL:ipcScripting');
  });

  it('shows no New/Open: this frame is not Kiface().IsSingle()', () => {
    expect(slots(PCB_TOP_TOOLBAR)).not.toContain('doNew');
    expect(slots(PCB_TOP_TOOLBAR)).not.toContain('open');
  });
});

describe('two ids wore the wrong bitmap', () => {
  it('runDRC declares BITMAPS::erc, which pcbnew shares with eeschema', () => {
    expect(BITMAP.runDRC).toBe('erc');
  });

  it('unlock declares BITMAPS::unlocked, not toggleLock’s lock_unlock', () => {
    expect(BITMAP.unlock).toBe('unlocked');
    expect(BITMAP.lock).toBe('locked');
  });
});
