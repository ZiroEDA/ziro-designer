// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A board filled the way pcbnew fills it: parsed, its project (when given)
 * loaded, the DRC engine built on its rules, connectivity built, then
 * `ZONE_FILLER::Fill` over every zone - `KI_TEST::LoadBoard` and
 * `ZONE_FILLER_TOOL::FillAllZones` without a frame.
 */
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_FILLER } from '@ziroeda/pcbnew/zone_filler.js';

/** Parse `aText`, give it `aProject` (a .kicad_pro's JSON) and `aRules` (.kicad_dru text). */
export function loadForFill(aText: string, aProject?: JsonValue, aRules?: string): BOARD {
  const board = ParseBoard(aText);

  if (aProject !== undefined) {
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('fill_test.kicad_pro', aProject);
    board.SetProject(manager.Prj());
  }

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());
  engine.InitEngine(aRules ?? null);
  board.GetDesignSettings().m_DRCEngine = engine;

  board.BuildListOfNets();
  board.BuildConnectivity();

  return board;
}

/** `ZONE_FILLER::Fill` over every zone of `aBoard`; returns the board. */
export function fillAll(aBoard: BOARD): BOARD {
  new ZONE_FILLER(aBoard).Fill([...aBoard.Zones()]);
  return aBoard;
}

/** `loadForFill` then `fillAll`. */
export function fillLive(aText: string, aProject?: JsonValue, aRules?: string): BOARD {
  return fillAll(loadForFill(aText, aProject, aRules));
}

/** The area of a zone's fill, every layer summed (IU²). */
export function filledArea(aZone: ZONE): number {
  let area = 0;

  for (const layer of aZone.GetLayerSet().Seq())
    if (aZone.HasFilledPolysForLayer(layer)) area += aZone.GetFilledPolysList(layer).Area();

  return area;
}

/** A zone's fill on `aLayer` as rings of points, or [] when it has none. */
export function filledRings(
  aZone: ZONE,
  aLayer = aZone.GetFirstLayer(),
): { x: number; y: number }[][] {
  if (!aZone.HasFilledPolysForLayer(aLayer)) return [];

  const polys = aZone.GetFilledPolysList(aLayer);
  const out: { x: number; y: number }[][] = [];

  for (let i = 0; i < polys.OutlineCount(); i++)
    out.push(
      polys
        .Outline(i)
        .CPoints()
        .map((p) => ({ x: p.x, y: p.y })),
    );

  return out;
}
