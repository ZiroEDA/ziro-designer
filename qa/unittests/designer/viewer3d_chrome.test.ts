// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The 3D viewer's frame chrome, pinned against KiCad's own sources.
 *
 * `EDA_3D_VIEWER_FRAME` is not an application — there is no 3D kiface and no
 * entry in the project manager's launcher (`kicad_manager_actions.cpp` lists
 * exactly the eight editors we ship). It is a `KIWAY_PLAYER` child frame of
 * `PCB_BASE_FRAME` (`CreateAndShow3D_Frame`, pcb_base_frame.cpp:681). But it
 * *is* a frame, with the chrome that implies: a menu bar, one toolbar, and a
 * status bar. Ours had none of that — a bold label and a Close button — which
 * is what this file guards against regressing to.
 *
 * Two shapes are easy to get wrong and invisible once wrong:
 *
 *  - the toolbar's separator grouping (`AppendSeparator()` in toolbars_3d.cpp),
 *    which is what makes the rotate pairs read as pairs; and
 *  - the grid submenu behaving as a radio set. Upstream adds all five with
 *    `ACTION_MENU::CHECK`, and the controller keeps exactly one live; a
 *    plain checkbox set would let you tick 10mm and 1mm at once.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { BITMAP } from '@ziroeda/designer/src/ui/toolbar_bitmaps.js';
import { VIEWER3D_TOP_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/viewer3dToolbars.js';
import { VIEW3D_CAMERA } from '@ziroeda/designer/src/editors/pcb/viewer3d_types.js';
import {
  buildViewer3DMenus,
  type Viewer3DMenuActions,
  type Viewer3DMenuState,
} from '@ziroeda/designer/src/editors/pcb/viewer3dMenus.js';
import type { ToolButton, ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

const VENDORED = new Set(
  readdirSync(new URL('../../../designer/src/assets/toolbar', import.meta.url))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4)),
);

/** A no-op action set: these tests are about structure, not dispatch. */
const noopActions = (): Viewer3DMenuActions => ({
  exportImage: () => {},
  close: () => {},
  copyToClipboard: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  zoomFit: () => {},
  redraw: () => {},
  setGrid: () => {},
  setView: () => {},
  rotate: () => {},
  flip: () => {},
  move: () => {},
  toggleShowMissingModels: () => {},
  openPreferences: () => {},
  resetToDefaults: () => {},
});

const baseState = (over: Partial<Viewer3DMenuState> = {}): Viewer3DMenuState => ({
  grid: 'none',
  ortho: false,
  showMissingModels: true,
  raytracing: false,
  showAppearanceManager: false,
  ...over,
});

const menu = (label: string): MenuItem[] => {
  const m = buildViewer3DMenus(baseState(), noopActions()).find((x) => x.label === label);
  if (!m) throw new Error(`no ${label} menu`);
  return m.items;
};

const labels = (items: MenuItem[]): string[] =>
  items.map((i) => (i.sep ? '---' : (i.label ?? '?')));

describe('the 3D viewer toolbar', () => {
  it('has only a top toolbar', () => {
    // toolbars_3d.cpp returns std::nullopt for LEFT, RIGHT and TOP_AUX, so a
    // side toolbar appearing here would be an invention, not a port.
    expect(buttons(VIEWER3D_TOP_TOOLBAR).length).toBeGreaterThan(15);
  });

  it('every button resolves to a vendored KiCad icon', () => {
    const bad = buttons(VIEWER3D_TOP_TOOLBAR)
      .map((b) => ({ b, name: BITMAP[b.id] ?? BITMAP[b.icon] }))
      .filter(({ name }) => !name || !VENDORED.has(name))
      .map(({ b, name }) => `${b.id} -> ${name ?? '(unmapped)'}`);
    expect(bad).toEqual([]);
  });

  it('keeps the id/separator order of DefaultToolbarConfig(TOP_MAIN)', () => {
    // Transcribed from 3d-viewer/3d_viewer/toolbars_3d.cpp. Each 'sep' is one
    // AppendSeparator(); the rotate and move runs are what they delimit.
    expect(VIEWER3D_TOP_TOOLBAR.map((e) => (e === 'sep' ? 'sep' : 'id' in e ? e.id : '?'))).toEqual(
      [
        'reloadBoard3d',
        'sep',
        'copyToClipboard3d',
        'sep',
        'toggleRaytracing',
        'sep',
        'zoomRedraw',
        'zoomIn',
        'zoomOut',
        'zoomFit',
        'sep',
        'rotateXCW',
        'rotateXCCW',
        'sep',
        'rotateYCW',
        'rotateYCCW',
        'sep',
        'rotateZCW',
        'rotateZCCW',
        'sep',
        'flipView3d',
        'sep',
        'moveLeft3d',
        'moveRight3d',
        'moveUp3d',
        'moveDown3d',
        'sep',
        'toggleOrtho',
        'sep',
        'showLayersManager',
      ],
    );
  });

  it('greys raytracing and the appearance manager rather than dropping them', () => {
    // Repo convention: an unported tool keeps its upstream slot, greyed, so the
    // toolbar keeps KiCad's shape and the gap stays visible.
    const byId = Object.fromEntries(buttons(VIEWER3D_TOP_TOOLBAR).map((b) => [b.id, b]));
    expect(byId.toggleRaytracing?.disabled).toBe(true);
    expect(byId.showLayersManager?.disabled).toBe(true);
    // Everything else must actually work.
    const deadWeight = buttons(VIEWER3D_TOP_TOOLBAR)
      .filter((b) => b.disabled)
      .map((b) => b.id);
    expect(deadWeight).toEqual(['toggleRaytracing', 'showLayersManager']);
  });
});

describe('the 3D viewer menu bar', () => {
  it('is File / Edit / View / Preferences', () => {
    // doReCreateMenuBar appends exactly these four, then AddStandardHelpMenu.
    expect(buildViewer3DMenus(baseState(), noopActions()).map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Preferences',
    ]);
  });

  it('puts Export Image above a separator and the close item (File)', () => {
    // AddClose puts the app name in the help string, never in the label:
    // `3d_menubar.cpp:54` is `fileMenu->AddClose( _( "3D Viewer" ) )`, and the
    // row it makes reads "Close". See ui/action_menu.ts.
    expect(labels(menu('File'))).toEqual(['Export Image...', '---', 'Close']);
    const close = menu('File').at(-1);
    expect(close?.tooltip).toBe('Close 3D Viewer');
    // Ctrl+W, moved off the browser's close-tab by BROWSER_REBINDS.
    expect(close?.shortcut).toBe('Ctrl+Alt+W');
  });

  it('carries the View menu in KiCad order', () => {
    expect(labels(menu('View'))).toEqual([
      'Zoom In',
      'Zoom Out',
      'Zoom to Fit',
      'Refresh',
      '---',
      '3D Grid',
      '---',
      'View Top',
      'View Bottom',
      'View Right',
      'View Left',
      'View Front',
      'View Back',
      '---',
      'Rotate Board',
      'Flip Board',
      'Move Board',
      '---',
      'Show Appearance Manager',
    ]);
  });

  it('gives the six views their eda_3d_actions hotkeys', () => {
    // .DefaultHotkey(): Z/Shift+Z top/bottom, X/Shift+X right/left,
    // Y/Shift+Y front/back — axis letters, shifted for the far side.
    const by = Object.fromEntries(menu('View').map((i) => [i.label, i.shortcut]));
    expect(by['View Top']).toBe('Z');
    expect(by['View Bottom']).toBe('Shift+Z');
    expect(by['View Right']).toBe('X');
    expect(by['View Left']).toBe('Shift+X');
    expect(by['View Front']).toBe('Y');
    expect(by['View Back']).toBe('Shift+Y');
    expect(by['Flip Board']).toBe('F');
  });

  it('nests rotate as three separator-delimited axis pairs', () => {
    const rotate = menu('View').find((i) => i.label === 'Rotate Board')?.submenu ?? [];
    expect(labels(rotate)).toEqual([
      'Rotate X Clockwise',
      'Rotate X Counterclockwise',
      '---',
      'Rotate Y Clockwise',
      'Rotate Y Counterclockwise',
      '---',
      'Rotate Z Clockwise',
      'Rotate Z Counterclockwise',
    ]);
    // Only Z has a hotkey upstream: R and Shift+R.
    const by = Object.fromEntries(rotate.map((i) => [i.label, i.shortcut]));
    expect(by['Rotate Z Counterclockwise']).toBe('R');
    expect(by['Rotate Z Clockwise']).toBe('Shift+R');
    expect(by['Rotate X Clockwise']).toBeUndefined();
  });

  it('offers the five grid steps', () => {
    const grid = menu('View').find((i) => i.label === '3D Grid')?.submenu ?? [];
    expect(labels(grid)).toEqual([
      'No 3D Grid',
      '3D Grid 10mm',
      '3D Grid 5mm',
      '3D Grid 2.5mm',
      '3D Grid 1mm',
    ]);
  });

  it('and ticks exactly one of them, whichever is live', () => {
    // The whole point of the CHECK items: a set where two can be lit is wrong.
    for (const [grid, label] of [
      ['none', 'No 3D Grid'],
      ['10mm', '3D Grid 10mm'],
      ['5mm', '3D Grid 5mm'],
      ['2.5mm', '3D Grid 2.5mm'],
      ['1mm', '3D Grid 1mm'],
    ] as const) {
      const items =
        buildViewer3DMenus(baseState({ grid }), noopActions())
          .find((m) => m.label === 'View')
          ?.items.find((i) => i.label === '3D Grid')?.submenu ?? [];
      expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual([label]);
    }
  });

  it('greys raytracing in Preferences but leaves the model placeholder live', () => {
    const prefs = menu('Preferences');
    const by = Object.fromEntries(prefs.map((i) => [i.label, i]));
    expect(by['Use raytracing']?.disabled).toBe(true);
    expect(by['Show parts without 3D model']?.disabled).toBeUndefined();
    expect(by['Show parts without 3D model']?.action).toBeTypeOf('function');
  });
});

describe('the six axis-aligned camera poses', () => {
  // Re-derived from CAMERA::ViewCommand_T1 rather than eyeballed, because the
  // bottom view shipped roll-flipped: its up vector was negated on the
  // assumption that looking from underneath inverts it. It does not — the
  // rotation that gets you there is RotateY(180), which leaves (0,1,0) alone.
  //
  // eye = Aux⁻¹·(0,0,1), up = Aux⁻¹·(0,1,0), with Aux = Rx(ax)·Ry(ay)·Rz(az)
  // built from the accumulated m_rotate_aux triple (camera.cpp:216) — never
  // the order the Rotate*_T1 calls appear in.
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const rotX = ([x, y, z]: number[], t: number): number[] => [
    x!,
    y! * Math.cos(t) - z! * Math.sin(t),
    y! * Math.sin(t) + z! * Math.cos(t),
  ];
  const rotY = ([x, y, z]: number[], t: number): number[] => [
    x! * Math.cos(t) + z! * Math.sin(t),
    y!,
    -x! * Math.sin(t) + z! * Math.cos(t),
  ];
  const rotZ = ([x, y, z]: number[], t: number): number[] => [
    x! * Math.cos(t) - y! * Math.sin(t),
    x! * Math.sin(t) + y! * Math.cos(t),
    z!,
  ];
  /** Aux⁻¹·v, i.e. Rz(-az)·Ry(-ay)·Rx(-ax) applied to v. */
  const auxInv = (v: number[], [ax, ay, az]: [number, number, number]): number[] =>
    rotZ(rotY(rotX(v, rad(-ax)), rad(-ay)), rad(-az));

  /** m_rotate_aux after each ViewCommand_T1 branch, in degrees. */
  const AUX: Record<string, [number, number, number]> = {
    top: [0, 0, 0],
    bottom: [0, 180, 0],
    front: [-90, 0, 0],
    back: [-90, 0, 180],
    right: [-90, 0, -90],
    left: [-90, 0, 90],
  };

  const near = (a: readonly number[], b: readonly number[]): void => {
    a.forEach((_, i) => expect(a[i]!).toBeCloseTo(b[i]!, 6));
  };

  for (const [dir, aux] of Object.entries(AUX)) {
    it(`${dir} matches Aux⁻¹ of the reset pose`, () => {
      const v = VIEW3D_CAMERA[dir as keyof typeof VIEW3D_CAMERA];
      near(v.eye, auxInv([0, 0, 1], aux));
      near(v.up, auxInv([0, 1, 0], aux));
    });
  }

  it('keeps every up vector perpendicular to its view direction', () => {
    // A parallel pair makes three.js lookAt() degenerate and the view rolls to
    // an arbitrary angle instead of failing loudly.
    for (const { eye, up } of Object.values(VIEW3D_CAMERA)) {
      const dot = eye[0] * up[0] + eye[1] * up[1] + eye[2] * up[2];
      expect(Math.abs(dot)).toBeLessThan(1e-9);
    }
  });

  it('puts top/bottom, front/back and left/right on opposite sides', () => {
    const opposed = (a: readonly number[], b: readonly number[]): void =>
      near(
        a,
        b.map((n) => -n),
      );
    opposed(VIEW3D_CAMERA.top.eye, VIEW3D_CAMERA.bottom.eye);
    opposed(VIEW3D_CAMERA.front.eye, VIEW3D_CAMERA.back.eye);
    opposed(VIEW3D_CAMERA.left.eye, VIEW3D_CAMERA.right.eye);
  });

  it('looks down +X for View Right, the board X that grows rightwards', () => {
    // Our scene X is board X un-negated (boardGeom.ts to3d), and KiCad's 3D
    // space agrees — TO_SFVEC2F negates only Y. So "right" really is +X.
    expect(VIEW3D_CAMERA.right.eye).toEqual([1, 0, 0]);
    expect(VIEW3D_CAMERA.left.eye).toEqual([-1, 0, 0]);
  });
});
