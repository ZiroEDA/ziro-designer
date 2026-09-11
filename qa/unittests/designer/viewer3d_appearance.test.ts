// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `APPEARANCE_CONTROLS_3D` and `BOARD_ADAPTER::Get/SetVisibleLayers`,
 * `GetLayerColors` (3d-viewer/dialogs/appearance_controls_3D.cpp,
 * 3d_canvas/board_adapter.cpp:598-985) — the pane's model.
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import { F_Cu, F_Mask, F_SilkS, User_1 } from '@ziroeda/pcbnew/src/layer_ids.js';
import { pcbLayerIdOf } from '@ziroeda/designer/src/editors/pcb/board_3d_layers.js';
import {
  APPEARANCE_ROWS_3D,
  FOLLOW_PCB,
  FOLLOW_PLOT_SETTINGS,
  IN_STACKUP_COLORS,
  RENDER_SHOW_DEFAULTS,
  colorSwatchChanged,
  defaultColors3d,
  defaultVisibleLayers3d,
  layerColors3d,
  layerVisibilityChanged,
  legacyColorsPreset,
  pcbLayerOfFlag,
  presetComboItems3d,
  presetComboValue,
  renderFlagsFromVisible,
  syncLayerPresetSelection,
  themeColors3d,
  userFlag,
  viewportComboItems3d,
  visibleLayers3d,
} from '@ziroeda/designer/src/editors/pcb/viewer3d_appearance.js';

describe('s_layerSettings — the rows', () => {
  it('is the C++ table in order: 14 named layers, 45 user, spacer, 6 model rows, spacer, 4 text rows, spacer, navigator + 2 backgrounds', () => {
    const labels = APPEARANCE_ROWS_3D.map((r) => (r ? r.label : '—'));
    expect(labels.slice(0, 4)).toEqual(['Board Body', 'Plated Barrels', 'F.Cu', 'B.Cu']);
    expect(labels[14]).toBe('User.1');
    expect(labels[58]).toBe('User.45');
    expect(labels[59]).toBe('—');
    expect(labels.slice(60, 66)).toEqual([
      'Through-hole Models',
      'SMD Models',
      'Virtual Models',
      'Models not in POS File',
      'Models marked DNP',
      'Model Bounding Boxes',
    ]);
    expect(labels[66]).toBe('—');
    expect(labels.slice(67, 71)).toEqual([
      'Values',
      'References',
      'Footprint Text',
      'Off-board Silkscreen',
    ]);
    expect(labels[71]).toBe('—');
    expect(labels.slice(72)).toEqual(['3D Navigator', 'Background Start', 'Background End']);
    expect(APPEARANCE_ROWS_3D).toHaveLength(75);
  });

  it('maps the board-layer rows to the PCB layer whose board name they show', () => {
    expect(pcbLayerOfFlag('LAYER_3D_SILKSCREEN_TOP')).toBe('F.SilkS');
    expect(pcbLayerOfFlag('LAYER_3D_ADHESIVE')).toBe('F.Adhes');
    expect(pcbLayerOfFlag(userFlag(7))).toBe('User.7');
    expect(pcbLayerOfFlag('LAYER_3D_BOARD')).toBeUndefined();
    expect(pcbLayerIdOf('User.1')).toBe(User_1);
    expect(pcbLayerIdOf('F.Mask')).toBe(F_Mask);
  });
});

describe('GetVisibleLayers', () => {
  const plot = {
    layers: new Set([F_Cu, F_SilkS]),
    plotReference: false,
    plotValue: true,
    plotFPText: true,
  };
  it('FOLLOW_PLOT_SETTINGS: the plot layer set decides the layers, the render flags the rest', () => {
    const v = visibleLayers3d(
      RENDER_SHOW_DEFAULTS,
      FOLLOW_PLOT_SETTINGS,
      [],
      plot,
      undefined,
      pcbLayerIdOf,
    );
    expect(v.has('LAYER_3D_COPPER_TOP')).toBe(true);
    expect(v.has('LAYER_3D_COPPER_BOTTOM')).toBe(false);
    expect(v.has('LAYER_3D_SILKSCREEN_TOP')).toBe(true);
    expect(v.has('LAYER_3D_SOLDERMASK_TOP')).toBe(false);
    expect(v.has('LAYER_3D_BOARD')).toBe(true); // always, in the follow branches
    expect(v.has('LAYER_FP_REFERENCES')).toBe(false); // plotreference no
    expect(v.has('LAYER_3D_MODELS_MARKED_DNP')).toBe(false); // show_footprints_dnp default
    expect(v.has('LAYER_3D_NAVIGATOR')).toBe(true);
  });
  it('FOLLOW_PCB: the board editor’s visibility; with no board editor, the plain flags', () => {
    const pcb = {
      layers: new Set(['B.Cu', 'F.Mask']),
      fpReferences: true,
      fpValues: false,
      fpText: true,
    };
    const v = visibleLayers3d(RENDER_SHOW_DEFAULTS, FOLLOW_PCB, [], plot, pcb, pcbLayerIdOf);
    expect(v.has('LAYER_3D_COPPER_TOP')).toBe(false);
    expect(v.has('LAYER_3D_COPPER_BOTTOM')).toBe(true);
    expect(v.has('LAYER_3D_SOLDERMASK_TOP')).toBe(true);
    expect(v.has('LAYER_FP_VALUES')).toBe(false);
    const bare = visibleLayers3d(
      RENDER_SHOW_DEFAULTS,
      FOLLOW_PCB,
      [],
      plot,
      undefined,
      pcbLayerIdOf,
    );
    expect(bare.has('LAYER_3D_COPPER_TOP')).toBe(true);
  });
  it('a saved preset is its own set; "" (custom) is the render flags', () => {
    const preset = { name: 'p', layers: ['LAYER_3D_BOARD' as const], colors: {} };
    expect([
      ...visibleLayers3d(RENDER_SHOW_DEFAULTS, 'p', [preset], plot, undefined, pcbLayerIdOf),
    ]).toEqual(['LAYER_3D_BOARD']);
    const custom = visibleLayers3d(
      { ...RENDER_SHOW_DEFAULTS, show_copper_top: false },
      '',
      [preset],
      plot,
      undefined,
      pcbLayerIdOf,
    );
    expect(custom.has('LAYER_3D_COPPER_TOP')).toBe(false);
    expect(custom.has('LAYER_3D_COPPER_BOTTOM')).toBe(true);
  });
  it('SetVisibleLayers writes every flag back, User_N by index', () => {
    const r = renderFlagsFromVisible(
      RENDER_SHOW_DEFAULTS,
      new Set([userFlag(3), 'LAYER_3D_NAVIGATOR']),
    );
    expect(r.show_board_body).toBe(false);
    expect(r.show_user[2]).toBe(true);
    expect(r.show_user[1]).toBe(false);
    expect(r.show_navigator).toBe(true);
    expect(r.show_user).toHaveLength(45);
  });
  it('GetDefaultVisibleLayers hides the four user layers, DNP, not-in-POS, bboxes and off-board silk', () => {
    const d = defaultVisibleLayers3d();
    expect(d.has('LAYER_3D_USER_COMMENTS')).toBe(false);
    expect(d.has('LAYER_3D_MODELS_NOT_IN_POS')).toBe(false);
    expect(d.has('LAYER_3D_BOUNDING_BOXES')).toBe(false);
    expect(d.has('LAYER_3D_ADHESIVE')).toBe(true);
    expect(d.has('LAYER_FP_TEXT')).toBe(true);
  });
});

describe('OnLayerVisibilityChanged', () => {
  const all = defaultVisibleLayers3d();
  it('Footprint Text off takes References and Values with it, and breaks a Follow preset', () => {
    const r = layerVisibilityChanged(all, 'LAYER_FP_TEXT', false);
    expect(r.visible.has('LAYER_FP_REFERENCES')).toBe(false);
    expect(r.visible.has('LAYER_FP_VALUES')).toBe(false);
    expect(r.visible.has('LAYER_FP_TEXT')).toBe(false);
    expect(r.killFollow).toBe(true);
  });
  it('References on turns Footprint Text back on', () => {
    const off = layerVisibilityChanged(all, 'LAYER_FP_TEXT', false).visible;
    const r = layerVisibilityChanged(off, 'LAYER_FP_REFERENCES', true);
    expect(r.visible.has('LAYER_FP_TEXT')).toBe(true);
    expect(r.visible.has('LAYER_FP_VALUES')).toBe(false);
  });
  it('a model row is a fast refresh that leaves the Follow preset alone; a board layer kills it', () => {
    const m = layerVisibilityChanged(all, 'LAYER_3D_SMD_MODELS', false);
    expect(m.fastRefresh).toBe(true);
    expect(m.killFollow).toBe(false);
    const b = layerVisibilityChanged(all, 'LAYER_3D_SOLDERMASK_TOP', false);
    expect(b.killFollow).toBe(true);
    expect(b.fastRefresh).toBe(false);
    const u = layerVisibilityChanged(all, userFlag(2), true);
    expect(u.killFollow).toBe(true);
    const nav = layerVisibilityChanged(all, 'LAYER_3D_NAVIGATOR', false);
    expect(nav.killFollow).toBe(false);
  });
});

describe('GetLayerColors', () => {
  it('the theme’s 3d_viewer.* entries, copper bottom copying top, the four user layers UNSPECIFIED', () => {
    const c = themeColors3d();
    expect(c.get('LAYER_3D_COPPER_TOP')).toEqual(BUILTIN_DEFAULT_THEME.LAYER_3D_COPPER_TOP);
    expect(c.get('LAYER_3D_USER_DRAWINGS')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(c.get(userFlag(1))).toEqual(BUILTIN_DEFAULT_THEME.User_1);
    const l = layerColors3d(undefined, false, undefined, new Map());
    expect(l.get('LAYER_3D_COPPER_BOTTOM')).toEqual(l.get('LAYER_3D_COPPER_TOP'));
  });
  it('the stackup replaces silk/mask/body/copper only when asked; a swatch override wins over both', () => {
    const stackup = {
      silkTop: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      silkBottom: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
      maskTop: { r: 0.3, g: 0.3, b: 0.3, a: 0.83 },
      maskBottom: { r: 0.4, g: 0.4, b: 0.4, a: 0.83 },
      copper: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    };
    const off = layerColors3d(undefined, false, stackup, new Map());
    expect(off.get('LAYER_3D_SILKSCREEN_TOP')).toEqual(
      BUILTIN_DEFAULT_THEME.LAYER_3D_SILKSCREEN_TOP,
    );
    const on = layerColors3d(undefined, true, stackup, new Map());
    expect(on.get('LAYER_3D_SILKSCREEN_TOP')).toEqual(stackup.silkTop);
    expect(on.get('LAYER_3D_COPPER_BOTTOM')).toEqual(stackup.copper);
    expect(on.get('LAYER_3D_BOARD')).toEqual(BUILTIN_DEFAULT_THEME.LAYER_3D_BOARD); // no body colour set
    const ov = layerColors3d(
      undefined,
      true,
      stackup,
      new Map([['LAYER_3D_SILKSCREEN_TOP', { r: 1, g: 0, b: 0, a: 1 }]]),
    );
    expect(ov.get('LAYER_3D_SILKSCREEN_TOP')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
  it('the three copper swatches are one colour', () => {
    const next = colorSwatchChanged(new Map(), 'LAYER_3D_PLATED_BARRELS', {
      r: 0,
      g: 1,
      b: 0,
      a: 1,
    });
    expect(next.get('LAYER_3D_COPPER_TOP')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(next.get('LAYER_3D_COPPER_BOTTOM')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    const silk = colorSwatchChanged(new Map(), 'LAYER_3D_SILKSCREEN_TOP', {
      r: 0,
      g: 1,
      b: 0,
      a: 1,
    });
    expect(silk.size).toBe(1);
  });
  it('inStackupColors is the eight the checkbox locks; GetDefaultColors is the g_Default table', () => {
    expect(IN_STACKUP_COLORS).toHaveLength(8);
    expect(IN_STACKUP_COLORS).not.toContain('LAYER_3D_BACKGROUND_TOP');
    const d = defaultColors3d();
    expect(d.get('LAYER_3D_COPPER_TOP')).toEqual({ r: 0.75, g: 0.61, b: 0.23, a: 1 });
    expect(d.get('LAYER_3D_BOARD')).toEqual({ r: 0.43, g: 0.45, b: 0.3, a: 0.9 });
  });
});

describe('presets and viewports', () => {
  it('the combo: the two Follow entries, the user’s after a separator, then the commands', () => {
    expect(presetComboItems3d([])).toEqual([
      'Follow PCB Editor',
      'Follow PCB Plot Settings',
      '---',
      'Save preset...',
      'Delete preset...',
    ]);
    expect(presetComboItems3d(['legacy colors'])).toEqual([
      'Follow PCB Editor',
      'Follow PCB Plot Settings',
      '---',
      'legacy colors',
      '---',
      'Save preset...',
      'Delete preset...',
    ]);
    expect(presetComboValue(FOLLOW_PLOT_SETTINGS, [])).toBe('Follow PCB Plot Settings');
    expect(presetComboValue('', ['a'])).toBe('---'); // custom: the separator
    expect(viewportComboItems3d(['b', 'a'])).toEqual([
      'a',
      'b',
      '---',
      'Save viewport...',
      'Delete viewport...',
    ]);
  });
  it('syncLayerPresetSelection finds an exact match and skips "legacy colors" under stackup colours', () => {
    const legacy = legacyColorsPreset();
    const vis = defaultVisibleLayers3d();
    const cols = new Map(Object.entries(legacy.colors) as [never, never][]);
    expect(syncLayerPresetSelection([legacy], vis, cols, false)).toBe('legacy colors');
    expect(syncLayerPresetSelection([legacy], vis, cols, true)).toBe('');
    const other = new Set(vis);
    other.delete('LAYER_3D_BOARD');
    expect(syncLayerPresetSelection([legacy], other, cols, false)).toBe('');
  });
});
