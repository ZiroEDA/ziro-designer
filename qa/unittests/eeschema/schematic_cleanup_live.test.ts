// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCHEMATIC::CleanUp on the live model (schematic.cpp:1525), run the way the editor
 * runs it: from RecalculateConnections with a cleanup flag, the frame as holder.
 */
import { STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_NO_CONNECT } from '@ziroeda/eeschema/sch_no_connect.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// SCH_EDIT_FRAME asks Prj() in its constructor, as KiCad's does: KiCad always has a PGM_BASE.
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

function setup(withFrame = true) {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  const frame = new SCH_EDIT_FRAME(hooks);
  if (withFrame) frame.SetSchematic(schematic);
  return { schematic, screen: sheet.LastScreen()!, frame };
}

const wire = (x0: number, y0: number, x1: number, y1: number) => {
  const w = new SCH_LINE({ x: x0, y: y0 }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: x1, y: y1 });
  return w;
};
const wiresOn = (screen: ReturnType<typeof setup>['screen']) =>
  (screen.Items().OfType(KICAD_T.SCH_LINE_T) as unknown as SCH_LINE[]).map(
    (l) =>
      `${l.GetStartPoint().x},${l.GetStartPoint().y}-${l.GetEndPoint().x},${l.GetEndPoint().y}`,
  );

describe('SCHEMATIC::CleanUp, through RecalculateConnections', () => {
  it('merges two colinear wires that touch with no junction into one', () => {
    const { schematic, screen, frame } = setup();
    screen.Append(wire(0, 0, 1000, 0));
    screen.Append(wire(1000, 0, 3000, 0));
    frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.LOCAL_CLEANUP);
    expect(wiresOn(screen)).toHaveLength(1);
    const [only] = screen.Items().OfType(KICAD_T.SCH_LINE_T) as unknown as SCH_LINE[];
    expect([only!.GetStartPoint().x, only!.GetEndPoint().x].sort((a, b) => a - b)).toEqual([
      0, 3000,
    ]);
    void schematic;
  });

  it('merges an overlap, removes an identical wire and a null one', () => {
    const { screen, frame } = setup();
    screen.Append(wire(0, 0, 2000, 0));
    screen.Append(wire(1000, 0, 3000, 0)); // overlaps the first
    screen.Append(wire(0, 5000, 2000, 5000));
    screen.Append(wire(2000, 5000, 0, 5000)); // the same wire, reversed
    screen.Append(wire(7000, 7000, 7000, 7000)); // null
    frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.LOCAL_CLEANUP);
    expect(wiresOn(screen)).toHaveLength(2);
  });

  it('keeps wires that only touch at a junction, and a junction three wires need', () => {
    const { screen, frame } = setup();
    screen.Append(wire(0, 0, 1000, 0));
    screen.Append(wire(1000, 0, 2000, 0));
    screen.Append(wire(1000, 0, 1000, 1000));
    screen.Append(new SCH_JUNCTION({ x: 1000, y: 0 }));
    frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.LOCAL_CLEANUP);
    expect(wiresOn(screen)).toHaveLength(3);
    expect(screen.Items().OfType(KICAD_T.SCH_JUNCTION_T)).toHaveLength(1);
  });

  it('drops a junction nothing needs, and duplicate junctions and no-connects', () => {
    const { screen, frame } = setup();
    screen.Append(new SCH_JUNCTION({ x: 50000, y: 50000 })); // on nothing
    screen.Append(wire(0, 0, 1000, 0));
    screen.Append(wire(1000, 0, 1000, 1000));
    screen.Append(wire(1000, 0, 2000, 0));
    screen.Append(new SCH_JUNCTION({ x: 1000, y: 0 }));
    screen.Append(new SCH_JUNCTION({ x: 1000, y: 0 })); // duplicate
    screen.Append(new SCH_NO_CONNECT({ x: 9000, y: 9000 }));
    screen.Append(new SCH_NO_CONNECT({ x: 9000, y: 9000 })); // duplicate
    frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.LOCAL_CLEANUP);
    expect(screen.Items().OfType(KICAD_T.SCH_JUNCTION_T)).toHaveLength(1);
    expect(screen.Items().OfType(KICAD_T.SCH_NO_CONNECT_T)).toHaveLength(1);
  });

  it('does nothing with NO_CLEANUP', () => {
    const { screen, frame } = setup();
    screen.Append(wire(0, 0, 1000, 0));
    screen.Append(wire(1000, 0, 3000, 0));
    frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);
    expect(wiresOn(screen)).toHaveLength(2);
  });

  it('records the changes in the commit it is given', () => {
    const { screen, frame, schematic } = setup();
    screen.Append(wire(0, 0, 1000, 0));
    screen.Append(wire(1000, 0, 3000, 0));
    const commit = new SCH_COMMIT(frame);
    schematic.CleanUp(commit, screen);
    // two removed, one merged line added
    expect(commit.Empty()).toBe(false);
  });

  it('with no holder (headless), flags the removed items but leaves them on the screen', () => {
    const { schematic, screen } = setup(false);
    const a = wire(0, 0, 1000, 0);
    const b = wire(0, 0, 1000, 0);
    screen.Append(a);
    screen.Append(b);
    schematic.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);
    // Upstream removes from the screen only through m_schematicHolder.
    expect(wiresOn(screen)).toHaveLength(2);
    expect(b.GetFlags() & STRUCT_DELETED).toBe(STRUCT_DELETED);
    expect(a.GetFlags() & STRUCT_DELETED).toBe(0);
  });
});
