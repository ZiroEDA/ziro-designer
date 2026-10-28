// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The symbol editor's grid is `symbol_editor.json`'s, through the machinery every GAL frame
 * shares: COMMON_TOOLS takes `config()->m_Window.grid` (the frame's own SYMBOL_EDITOR_SETTINGS,
 * not eeschema's) and puts the current grid on the GAL; Next / Preset move it; and
 * EE_GRID_HELPER::GetItemGrid applies the symbol editor's per-item overrides.
 */
import { gridSizeToIU } from '@ziroeda/eeschema/eeschema_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
  setSymbolEditorSettingsProvider,
  setUpdateSymbolEditorSettingsProvider,
} from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { EE_GRID_HELPER } from '@ziroeda/eeschema/tools/ee_grid_helper.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

let t: SYMBOL_EDIT_HARNESS;
let cfg: SymbolEditorSettings;

beforeEach(() => {
  cfg = structuredClone(SYMBOL_EDITOR_DEFAULTS);
  setSymbolEditorSettingsProvider(() => cfg);
  setUpdateSymbolEditorSettingsProvider((aMutate) => aMutate(cfg));
});

afterEach(() => {
  t.dispose();
  setSymbolEditorSettingsProvider(() => SYMBOL_EDITOR_DEFAULTS);
  setUpdateSymbolEditorSettingsProvider(() => {});
});

const galGrid = () => t.frame.GetCanvas()!.GetGAL().GetGridSize().x;

it('opens on the file’s current grid, 50 mil by default', () => {
  t = symbolEditHarness();
  expect(galGrid()).toBe(gridSizeToIU('50 mil'));
});

it('opens on whichever grid the file names', () => {
  cfg.window.grid.last_size_idx = 0;
  t = symbolEditHarness();
  expect(galGrid()).toBe(gridSizeToIU(cfg.window.grid.sizes[0]!.x));
});

it('Next and Preset move the grid, and the move sticks', () => {
  t = symbolEditHarness();
  const mgr = t.frame.GetToolManager()!;
  mgr.RunAction(ACTIONS.gridPreset, 0);
  expect(galGrid()).toBe(gridSizeToIU(cfg.window.grid.sizes[0]!.x));
  // From 0, Next is 1: a move that did not stick would start again from 1 and land on 2.
  mgr.RunAction(ACTIONS.gridNext);
  expect(galGrid()).toBe(gridSizeToIU(cfg.window.grid.sizes[1]!.x));
});

it('the idle pass stores the move in symbol_editor.json, and a later ask keeps it', () => {
  t = symbolEditHarness();
  t.frame.GetToolManager()!.RunAction(ACTIONS.gridPreset, 3);
  t.frame.OnIdle();
  expect(cfg.window.grid.last_size_idx).toBe(3);
  expect(t.frame.config()!.m_Window.grid.last_size_idx).toBe(3);
});

it('a preference written to the file reaches the next ask', () => {
  t = symbolEditHarness();
  // The store replaces the slice on every write; the object reloads from the new one.
  cfg = structuredClone(cfg);
  cfg.window.grid.last_size_idx = 2;
  expect(t.frame.config()!.m_Window.grid.last_size_idx).toBe(2);
});

/**
 * EE_GRID_HELPER::GetGridSize reads `override_<kind>` / `_idx` off the frame's settings object;
 * the Grids page writes `overrides.<kind>` in the slice. Text on 10 mil by default, and moved.
 */
it('the per-item overrides reach the grid helper', () => {
  t = symbolEditHarness();
  const helper = new EE_GRID_HELPER(t.frame.GetToolManager()!);
  expect(helper.GetGridSize(GRID_HELPER_GRIDS.GRID_TEXT).x).toBe(gridSizeToIU('10 mil'));

  cfg = structuredClone(cfg);
  cfg.window.grid.overrides.text = { enabled: true, size: '25 mil' };
  t.frame.config();
  expect(helper.GetGridSize(GRID_HELPER_GRIDS.GRID_TEXT).x).toBe(gridSizeToIU('25 mil'));

  // The first row of the list, index 0, is a row like any other.
  cfg = structuredClone(cfg);
  cfg.window.grid.overrides.text = { enabled: true, size: cfg.window.grid.sizes[0]!.x };
  t.frame.config();
  expect(helper.GetGridSize(GRID_HELPER_GRIDS.GRID_TEXT).x).toBe(
    gridSizeToIU(cfg.window.grid.sizes[0]!.x),
  );

  cfg = structuredClone(cfg);
  cfg.window.grid.overrides.text = { enabled: false, size: '25 mil' };
  t.frame.config();
  expect(helper.GetGridSize(GRID_HELPER_GRIDS.GRID_TEXT).x).toBe(galGrid());
});

/** COMMON_TOOLS::GridFast1 / GridFast2 / GridFastCycle, on the file's two fast grids. */
it('the fast grids are the file’s, and the cycle swaps between them', () => {
  cfg.window.grid.fast_grid_1 = 0;
  cfg.window.grid.fast_grid_2 = 3;
  t = symbolEditHarness();
  const mgr = t.frame.GetToolManager()!;
  const size = (i: number) => gridSizeToIU(cfg.window.grid.sizes[i]!.x);

  mgr.RunAction(ACTIONS.gridFast2);
  expect(galGrid()).toBe(size(3));
  mgr.RunAction(ACTIONS.gridFast1);
  expect(galGrid()).toBe(size(0));
  mgr.RunAction(ACTIONS.gridFastCycle);
  expect(galGrid()).toBe(size(3));
  mgr.RunAction(ACTIONS.gridFastCycle);
  expect(galGrid()).toBe(size(0));
});

/**
 * EE_GRID_HELPER::BestSnapAnchor takes a VECTOR2I: the event's VECTOR2D is truncated on the way
 * in. With the grid off the origin comes back as it went in, and a fraction left there threw in
 * the BigInt of IsPointOnSegment while a bus was drawn (Sentry JAVASCRIPT-REACT-14).
 */
it('snaps from the truncated point, so a fraction never comes back', () => {
  t = symbolEditHarness();
  const helper = new EE_GRID_HELPER(t.frame.GetToolManager()!);
  helper.SetUseGrid(false);
  helper.SetSnap(false);
  expect(
    helper.BestSnapAnchor({ x: 326369.38, y: -1270.7 }, GRID_HELPER_GRIDS.GRID_WIRES, null),
  ).toEqual({ x: 326369, y: -1270 });
});
