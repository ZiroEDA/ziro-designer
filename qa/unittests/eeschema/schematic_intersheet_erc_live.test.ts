// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCHEMATIC's inter-sheet references and ERC exclusions on the live model
 * (schematic.cpp:557, :1196, :1349, :1375), and SCH_EDIT_FRAME as its
 * SCHEMATIC_HOLDER. Every expectation is read off the C++.
 */
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { ERC_ITEM } from '@ziroeda/eeschema/erc/erc_item.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_GLOBALLABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_MARKER } from '@ziroeda/eeschema/sch_marker.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// SCH_EDIT_FRAME asks Prj() in its constructor, as KiCad's does: KiCad always has a PGM_BASE.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  syncSelection: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

function setup() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.SetSchematic(schematic);
  return { schematic, sheet, screen: sheet.LastScreen()!, frame };
}

describe('SCHEMATIC::RecomputeIntersheetRefs', () => {
  it('maps each global label to the pages it is on, and shows the references when asked', () => {
    const { schematic, sheet, screen, frame } = setup();
    const a = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'SIG');
    const b = new SCH_GLOBALLABEL({ x: 100000, y: 0 }, 'SIG');
    screen.Append(a);
    screen.Append(b);
    const updated: unknown[] = [];
    frame.IntersheetRefUpdate = (l) => {
      updated.push(l);
    };

    schematic.Settings().m_IntersheetRefsShow = false;
    schematic.RecomputeIntersheetRefs();
    expect([...(schematic.GetPageRefsMap().get('SIG') ?? [])]).toEqual([
      sheet.GetVirtualPageNumber(),
    ]);
    expect(a.GetFields()[0]!.IsVisible()).toBe(false);
    expect(updated).toEqual([]);

    schematic.Settings().m_IntersheetRefsShow = true;
    schematic.RecomputeIntersheetRefs();
    expect(a.GetFields()[0]!.IsVisible()).toBe(true);
    // Shown labels are refreshed through the holder (the frame), each once.
    expect(updated).toEqual([a, b]);
  });

  it('runs on every connection recalculation while the references are shown', () => {
    const { schematic, screen } = setup();
    screen.Append(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'NET1'));
    schematic.Settings().m_IntersheetRefsShow = true;
    schematic.GetPageRefsMap().clear();
    schematic.RecalculateConnections(null, 0);
    expect(schematic.GetPageRefsMap().has('NET1')).toBe(true);
  });
});

describe('SCHEMATIC ERC exclusions', () => {
  const excludedMarkerOn = (junction: SCH_JUNCTION, sheet: ReturnType<typeof setup>['sheet']) => {
    const item = ERC_ITEM.Create(ERCE_T.ERCE_LABEL_NOT_CONNECTED)!;
    item.SetItems(junction.m_Uuid);
    item.SetItemsSheetPaths(sheet);
    return new SCH_MARKER(item, { x: 0, y: 0 });
  };

  it('records excluded markers with their comments, and resolves them back onto the markers', () => {
    const { schematic, sheet, screen } = setup();
    const j = new SCH_JUNCTION({ x: 0, y: 0 });
    screen.Append(j);
    const marker = excludedMarkerOn(j, sheet);
    marker.SetExcluded(true, 'intended');
    screen.Append(marker);

    schematic.RecordERCExclusions();
    const serialized = marker.SerializeToString();
    expect([...schematic.ErcSettings().m_ErcExclusions]).toEqual([serialized]);
    expect(schematic.ErcSettings().m_ErcExclusionComments.get(serialized)).toBe('intended');

    marker.SetExcluded(false);
    const fresh = schematic.ResolveERCExclusions();
    // Matched to the marker that is still there: excluded again, nothing new to place.
    expect(fresh).toEqual([]);
    expect(marker.IsExcluded()).toBe(true);
    expect(marker.GetComment()).toBe('intended');
    expect(schematic.ErcSettings().m_ErcExclusions.size).toBe(0);
  });

  it('places a marker for an exclusion whose marker is gone, then records it again', () => {
    const { schematic, sheet, screen } = setup();
    const j = new SCH_JUNCTION({ x: 0, y: 0 });
    screen.Append(j);
    const marker = excludedMarkerOn(j, sheet);
    const serialized = marker.SerializeToString();
    schematic.ErcSettings().m_ErcExclusions.add(serialized);
    schematic.ErcSettings().m_ErcExclusionComments.set(serialized, 'kept');

    schematic.ResolveERCExclusionsPostUpdate();

    const placed = screen.Items().OfType(KICAD_T.SCH_MARKER_T) as unknown as SCH_MARKER[];
    expect(placed).toHaveLength(1);
    expect(placed[0]!.IsExcluded()).toBe(true);
    expect(placed[0]!.GetComment()).toBe('kept');
    // RecordERCExclusions ran after: the project keeps it before any save.
    expect([...schematic.ErcSettings().m_ErcExclusions]).toEqual([serialized]);
  });
});

describe('SCH_EDIT_FRAME as the SCHEMATIC_HOLDER', () => {
  it('registers itself when given a schematic', () => {
    const { schematic, frame } = setup();
    expect(schematic.GetSchematicHolder()).toBe(frame);
  });
});
