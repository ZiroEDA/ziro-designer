// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RENDER_3D_OPENGL` + `EDA_3D_CANVAS` on a WebGL context: the board the
 * 3D viewer draws, drawn the way KiCad draws it.
 *
 *  - `BOARD_ADAPTER::InitSettings` decides the units: the board's larger side
 *    spans `RANGE_SCALE_3D` (×1.6 for a board view), every layer sits at the
 *    Z `m_layerZcoordTop/Bottom` gives it, and the camera looks at the board
 *    centre (`board_adapter.cpp:255-425`).
 *  - `createLayers` turns every item into a polygon per layer
 *    (`board_3d_layers.ts`); `generateLayerList` extrudes each between its
 *    two Zs with `AddToMiddleContours` walls (`create_scene.cpp`).
 *  - `Redraw` draws copper → tech layers → opaque models → board body →
 *    solder mask → transparent models → grid → navigator, with the polygon
 *    offsets, blend states and material switches of
 *    `render_3d_opengl.cpp:517-828`. The lights and materials are the
 *    fixed-function set in `gl_fixed_function.ts`.
 *  - The camera is `TRACK_BALL` (`camera3d.ts`); mouse, wheel and view
 *    commands are `HIDPI_GL_3D_CANVAS::OnMouse*Camera` and
 *    `EDA_3D_CANVAS::SetView3D`, animated by wall-clock time exactly as
 *    `DoRePaint` steps `m_camera.Interpolate`.
 *
 * three.js is the rasteriser only: plain `Camera` with matrices pushed from
 * the port, `ShaderMaterial`s carrying the GL 1.x equation, `renderOrder`
 * for the pass order. Nothing in it decides a colour or a light.
 */
import { ARC_HIGH_DEF, PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { transformCircleToPolygonSet } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { getArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { ErrorLoc } from '@ziroeda/pcbnew/src/transform_shape_to_polygon.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import { LEGACY_COLORS } from '@ziroeda/common/src/color4d.js';
import type { Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Board } from '@ziroeda/pcbnew';
import { viaIsTented } from '@ziroeda/pcbnew/src/export_d356.js';
import {
  clickSelectionParts,
  hoveredItemMessage,
  pickBoardItem,
  type PickedItem,
} from './pick3d.js';
import { childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import earcut from 'earcut';
import * as THREE from 'three';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import { COLOR4D_UNSPECIFIED, parseColor4d } from '@ziroeda/common/src/color4d.js';
import type { StackupColors } from './board_adapter_colors.js';
import {
  buildBoard3dLayers,
  pcbLayerIdOf,
  plotLayerSelection,
  userLayerIndex,
  type Layer3d,
  type Layer3dOptions,
} from './board_3d_layers.js';
import { pcbLayerOfFlag, type Layer3dFlag } from './viewer3d_appearance.js';
import {
  DELTA_MOVE_STEP_FACTOR,
  INITIAL_CAMERA_DISTANCE,
  RANGE_SCALE_3D,
  TrackBallCamera,
  mat4Identity,
  mat4Inverse,
  mat4Multiply,
  mat4Perspective,
  mat4TransformPoint,
  mat4Translate,
  type Mat4,
  type Vec3,
  type View3dType,
} from './camera3d.js';
import { mountComponents, type ProjectFile } from './component3d.js';
import {
  boardMaterials,
  diffuseOnlyMaterial,
  headlightPosition,
  makeFixedFunctionMaterial,
  makeSharedLightUniforms,
  makeUnlitMaterial,
  makeVertexColorMaterial,
  materialDiffuseToColorCAD,
  plasticMaterial,
  type SMaterial,
} from './gl_fixed_function.js';
import { MODELS3D_HOST } from '../../libraryHosts.js';
import { buildScene } from './renderBoard.js';
import type {
  Grid3D,
  Move3DDir,
  Rotate3DAxis,
  View3DDir,
  Viewer3D,
  Viewer3DStatus,
  Viewer3dCameraOptions,
  Viewer3dRenderOptions,
} from './viewer3d_types.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)
const MODELS3D_BASE = MODELS3D_HOST;

// The plain data types live in viewer3d_types.ts so the menu inventory can
// reach them without resolving this module's three.js / occt-import-js chain.
export type { View3DDir, Rotate3DAxis, Move3DDir, Grid3D, Viewer3DStatus, Viewer3D };

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * `BOARD::ComputeBoundingBox( aBoardEdgesOnly = haveOutline )`: the Edge.Cuts
 * extent when there is one, else every item's. `board_adapter.cpp:255-263`.
 */
function edgeBBox(board: Board, fallback: BBox): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const inc = (x?: number, y?: number): void => {
    if (x === undefined || y === undefined) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const shapes = [...board.shapes, ...board.footprints.flatMap((f) => f.shapes)];
  for (const s of shapes) {
    if (s.layer !== 'Edge.Cuts') continue;
    inc(s.start?.x, s.start?.y);
    inc(s.end?.x, s.end?.y);
    inc(s.mid?.x, s.mid?.y);
    if (s.center && s.end) {
      const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
      inc(s.center.x - r, s.center.y - r);
      inc(s.center.x + r, s.center.y + r);
    }
    for (const p of s.pts ?? []) inc(p.x, p.y);
  }
  return minX < maxX ? { minX, minY, maxX, maxY } : fallback;
}

// ---------------------------------------------------------------------------
// BOARD_ADAPTER::InitSettings — units, thicknesses, layer Z

/** `#define`s at the top of board_adapter.cpp, in IU. */
const DEFAULT_BOARD_THICKNESS = 1.6 * MM;
const DEFAULT_COPPER_THICKNESS = 0.035 * MM; // for 35 um
const DEFAULT_TECH_LAYER_THICKNESS = 0.025 * MM;
const SOLDERPASTE_LAYER_THICKNESS = 0.04 * MM;

interface Adapter {
  /** `m_biuTo3Dunits`. */
  s: number;
  boardPos: Vec2; // y already negated
  boardSize: Vec2;
  boardCenter: Vec3;
  copperLayersCount: number;
  boardBodyThickness3DU: number;
  frontCopperThickness3DU: number;
  backCopperThickness3DU: number;
  nonCopperLayerThickness3DU: number;
  frontMaskThickness3DU: number;
  backMaskThickness3DU: number;
  solderPasteLayerThickness3DU: number;
  zTop: Record<string, number>;
  zBot: Record<string, number>;
  /** `m_boardBoundingBox`, 3D units. */
  bboxMin: Vec3;
  bboxMax: Vec3;
}

/**
 * `BOARD_STACKUP` from the file's `(setup (stackup …))`: dielectric (and
 * enabled inner copper) thicknesses summed into the body, F/B copper and mask
 * thicknesses taken as their own. A board without a stackup section keeps
 * the `#define` defaults — `GetStackupDescriptor().GetCount()` is 0 for it,
 * and `(thickness …)` is never consulted.
 */
function stackupThicknesses(board: Board): {
  body?: number;
  fCu?: number;
  bCu?: number;
  fMask?: number;
  bMask?: number;
} {
  const setup = childNamed(board.source, 'setup');
  const stackup = setup ? childNamed(setup, 'stackup') : undefined;
  if (!stackup) return {};
  const out: { body?: number; fCu?: number; bCu?: number; fMask?: number; bMask?: number } = {};
  let body = 0;
  const str = (n: { items: { kind: string; value?: string }[] } | undefined, i: number): string => {
    const a = n?.items[i];
    return a && a.kind !== 'list' && a.value !== undefined ? a.value : '';
  };
  for (const layer of childrenNamed(stackup, 'layer')) {
    const name = str(layer, 1);
    const type = str(childNamed(layer, 'type'), 1);
    // every `(thickness …)` in the node, which is the sublayers' too
    let sum = 0;
    for (const t of childrenNamed(layer, 'thickness')) sum += Number(str(t, 1)) * MM || 0;
    if (type === 'core' || type === 'prepreg') body += sum;
    else if (type === 'copper') {
      const t = Math.max(sum, 0.001 * MM);
      if (name === 'F.Cu') out.fCu = t;
      else if (name === 'B.Cu') out.bCu = t;
      else body += t;
    } else if (name === 'F.Mask') out.fMask = Math.max(sum, 0.001 * MM);
    else if (name === 'B.Mask') out.bMask = Math.max(sum, 0.001 * MM);
  }
  out.body = body;
  return out;
}

function initAdapter(board: Board, bbox: BBox, footprintHolder: boolean): Adapter {
  let boardSize: Vec2 = { x: bbox.maxX - bbox.minX, y: bbox.maxY - bbox.minY };
  // Gives a non null size to avoid issues in zoom / scale calculations
  if (boardSize.x === 0 && boardSize.y === 0) boardSize = { x: 20 * MM, y: 20 * MM };
  const boardPos: Vec2 = {
    x: (bbox.minX + bbox.maxX) / 2,
    y: -((bbox.minY + bbox.maxY) / 2), // The y coord is inverted in 3D viewer
  };
  const copperLayersCount = Math.max(2, board.layers.filter((l) => /\.Cu$/.test(l.name)).length);
  // Calculate the conversion to apply to all positions.
  let s = RANGE_SCALE_3D / Math.max(boardSize.x, boardSize.y);
  // Hack to keep "home" zoom from being too small.
  if (!footprintHolder) s *= 1.6;

  const st = stackupThicknesses(board);
  const a: Adapter = {
    s,
    boardPos,
    boardSize,
    boardCenter: [boardPos.x * s, boardPos.y * s, 0],
    copperLayersCount,
    boardBodyThickness3DU: (st.body ?? DEFAULT_BOARD_THICKNESS) * s,
    frontCopperThickness3DU: (st.fCu ?? DEFAULT_COPPER_THICKNESS) * s,
    backCopperThickness3DU: (st.bCu ?? DEFAULT_COPPER_THICKNESS) * s,
    nonCopperLayerThickness3DU: DEFAULT_TECH_LAYER_THICKNESS * s,
    frontMaskThickness3DU: (st.fMask ?? DEFAULT_TECH_LAYER_THICKNESS) * s,
    backMaskThickness3DU: (st.bMask ?? DEFAULT_TECH_LAYER_THICKNESS) * s,
    solderPasteLayerThickness3DU: SOLDERPASTE_LAYER_THICKNESS * s,
    zTop: {},
    zBot: {},
    bboxMin: [0, 0, 0],
    bboxMax: [0, 0, 0],
  };

  // Generate the Z position of copper layers (F_Cu, In*.Cu, B_Cu)
  const n = a.copperLayersCount;
  const copperNames = ['F.Cu', ...Array.from({ length: n - 2 }, (_, i) => `In${i + 1}.Cu`), 'B.Cu'];
  copperNames.forEach((name, layerPos) => {
    const bot = a.boardBodyThickness3DU / 2 - (a.boardBodyThickness3DU * layerPos) / (n - 1);
    a.zBot[name] = bot;
    a.zTop[name] =
      layerPos < n / 2 ? bot + a.frontCopperThickness3DU : bot - a.backCopperThickness3DU;
  });
  const layerThicknessMargin = 1.1;
  const zposOffset = a.nonCopperLayerThickness3DU * layerThicknessMargin;
  const zposCopperTopBack = a.zTop['B.Cu']!;
  const zposCopperTopFront = a.zTop['F.Cu']!;
  const tech: [string, number, number][] = [
    ['B.Mask', zposCopperTopBack, zposCopperTopBack - a.backMaskThickness3DU],
    ['B.Paste', zposCopperTopBack, zposCopperTopBack - a.solderPasteLayerThickness3DU],
    ['F.Mask', zposCopperTopFront, zposCopperTopFront + a.frontMaskThickness3DU],
    ['F.Paste', zposCopperTopFront, zposCopperTopFront + a.solderPasteLayerThickness3DU],
  ];
  for (const [name, bot, top] of tech) {
    a.zBot[name] = bot;
    a.zTop[name] = top;
  }
  const silkBBot = zposCopperTopBack - 1.0 * zposOffset;
  a.zBot['B.SilkS'] = silkBBot;
  a.zTop['B.SilkS'] = silkBBot - a.nonCopperLayerThickness3DU;
  const silkFBot = zposCopperTopFront + 1.0 * zposOffset;
  a.zBot['F.SilkS'] = silkFBot;
  a.zTop['F.SilkS'] = silkFBot + a.nonCopperLayerThickness3DU;
  // default: every other back/front layer
  for (const name of ['B.Adhes', 'B.CrtYd', 'B.Fab']) {
    a.zBot[name] = zposCopperTopBack - 2.0 * zposOffset;
    a.zTop[name] = a.zBot[name]! - a.nonCopperLayerThickness3DU;
  }
  for (const name of [
    'F.Adhes',
    'F.CrtYd',
    'F.Fab',
    'Dwgs.User',
    'Cmts.User',
    'Eco1.User',
    'Eco2.User',
    'Edge.Cuts',
    'Margin',
    // User_1..45 are not back layers, so `default:` puts them on the front
    ...Array.from({ length: 45 }, (_, i) => `User.${i + 1}`),
  ]) {
    a.zBot[name] = zposCopperTopFront + 2.0 * zposOffset;
    a.zTop[name] = a.zBot[name]! + a.nonCopperLayerThickness3DU;
  }
  const half: Vec3 = [(boardSize.x * s) / 2, (boardSize.y * s) / 2, 0];
  a.bboxMin = [a.boardCenter[0] - half[0], a.boardCenter[1] - half[1], a.zTop['B.Adhes']!];
  a.bboxMax = [a.boardCenter[0] + half[0], a.boardCenter[1] + half[1], a.zTop['F.Adhes']!];
  return a;
}

// ---------------------------------------------------------------------------
// TRIANGLE_DISPLAY_LIST: top + bottom faces and AddToMiddleContours walls

interface GeomBuf {
  pos: number[];
  nrm: number[];
  idx: number[];
}

const newBuf = (): GeomBuf => ({ pos: [], nrm: [], idx: [] });

/** Shoelace area of a ring in the (already y-flipped) 3D frame. */
function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!,
      q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * The top and bottom faces of a polygon set, triangulated. KiCad's
 * `ConvertPolygonToTriangles` fans differently, but two triangulations of the
 * same polygon cover the same pixels; the faces are what matters.
 */
function addTopAndBottom(
  buf: GeomBuf,
  polys: [number, number][][][],
  zTop: number,
  zBot: number,
  which: 'both' | 'top' | 'bottom' = 'both',
): void {
  for (const poly of polys) {
    const flat: number[] = [];
    const holeIdx: number[] = [];
    poly.forEach((ring, ri) => {
      if (ri > 0) holeIdx.push(flat.length / 2);
      for (const p of ring) flat.push(p[0], p[1]);
    });
    if (flat.length < 6) continue;
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined);
    const nv = flat.length / 2;
    const faces: [number, number][] = [];
    if (which !== 'bottom') faces.push([zTop, 1]);
    if (which !== 'top') faces.push([zBot, -1]);
    for (const [z, nz] of faces) {
      const base = buf.pos.length / 3;
      for (let i = 0; i < nv; i++) {
        buf.pos.push(flat[i * 2]!, flat[i * 2 + 1]!, z);
        buf.nrm.push(0, 0, nz);
      }
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t]!,
          b = tris[t + 1]!,
          c = tris[t + 2]!;
        // wind every triangle so its front face is the face's normal side
        const ax = flat[a * 2]!,
          ay = flat[a * 2 + 1]!;
        const cross =
          (flat[b * 2]! - ax) * (flat[c * 2 + 1]! - ay) -
          (flat[c * 2]! - ax) * (flat[b * 2 + 1]! - ay);
        const ccw = cross > 0;
        if (ccw === nz > 0) buf.idx.push(base + a, base + b, base + c);
        else buf.idx.push(base + a, base + c, base + b);
      }
    }
  }
}

/**
 * `TRIANGLE_DISPLAY_LIST::AddToMiddleContours`: one quad per edge, its two
 * end normals each averaged with the neighbouring edge's when the turn is
 * under 60° (`dot > 0.5`), and the edge skipped when it runs through a
 * through-hole (`aThroughHoles->IntersectAny`). Normals point out of the
 * material: outward on an outline, into the hole on a hole ring.
 */
function addMiddleContours(
  buf: GeomBuf,
  polys: [number, number][][][],
  zBot: number,
  zTop: number,
  skipEdge?: (a: [number, number], b: [number, number]) => boolean,
): void {
  for (const poly of polys) {
    poly.forEach((ringIn, ri) => {
      // Do not add repeated points; close the path.
      const ring: [number, number][] = [];
      for (const p of ringIn) {
        const last = ring[ring.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push(p);
      }
      if (ring.length >= 2) {
        const f = ring[0]!,
          l = ring[ring.length - 1]!;
        if (f[0] === l[0] && f[1] === l[1]) ring.pop();
      }
      if (ring.length < 3) return;
      // Material lies to the RIGHT of a clockwise outline (in this y-up
      // frame) and to the LEFT of a counter-clockwise one; a hole ring is the
      // reverse. `outwardLeft`: is the material-free side the left of travel?
      const cw = ringArea(ring) < 0;
      const outwardLeft = ri === 0 ? cw : !cw;
      const n = ring.length;
      const segN: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const v0 = ring[i]!,
          v1 = ring[(i + 1) % n]!;
        const dx = v1[0] - v0[0],
          dy = v1[1] - v0[1];
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L,
          uy = dy / L;
        segN.push(outwardLeft ? [-uy, ux] : [uy, -ux]);
      }
      const norm = (v: [number, number]): [number, number] => {
        const L = Math.hypot(v[0], v[1]) || 1;
        return [v[0] / L, v[1] / L];
      };
      for (let i = 0; i < n; i++) {
        const v0 = ring[i]!,
          v1 = ring[(i + 1) % n]!;
        if (skipEdge?.(v0, v1)) continue;
        const cur = segN[i]!;
        const prev = segN[(i - 1 + n) % n]!;
        const next = segN[(i + 1) % n]!;
        // Only interpolate the normal if the angle is closer
        let n0 = cur;
        if (cur[0] * prev[0] + cur[1] * prev[1] > 0.5)
          n0 = norm([cur[0] + prev[0], cur[1] + prev[1]]);
        let n1 = cur;
        if (cur[0] * next[0] + cur[1] * next[1] > 0.5)
          n1 = norm([cur[0] + next[0], cur[1] + next[1]]);
        const base = buf.pos.length / 3;
        buf.pos.push(
          v0[0],
          v0[1],
          zTop,
          v1[0],
          v1[1],
          zTop,
          v1[0],
          v1[1],
          zBot,
          v0[0],
          v0[1],
          zBot,
        );
        buf.nrm.push(n0[0], n0[1], 0, n1[0], n1[1], 0, n1[0], n1[1], 0, n0[0], n0[1], 0);
        // (v0t, v1t, v1b) is front-facing towards the LEFT of travel; mirror
        // it when the free side is the right.
        if (outwardLeft) buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    });
  }
}

function toGeometry(buf: GeomBuf): THREE.BufferGeometry | null {
  if (buf.idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(buf.idx, 1));
  return g;
}

// ---------------------------------------------------------------------------
// the 3D navigator (SPHERES_GIZMO)

const GIZMO_ARROW_SIZE = RANGE_SCALE_3D * 0.2;
const GIZMO_SPHERE_RADIUS = 0.05 * RANGE_SCALE_3D;
const GIZMO_FOV = 60;
/** `m_spheres`, in `GizmoSphereSelection` order: +X, −X, +Y, −Y, +Z, −Z. */
const GIZMO_SPHERES: { pos: Vec3; color: Vec3 }[] = [
  { pos: [GIZMO_ARROW_SIZE, 0, 0], color: [0.9, 0, 0] },
  { pos: [-GIZMO_ARROW_SIZE, 0, 0], color: [0.4, 0, 0] },
  { pos: [0, GIZMO_ARROW_SIZE, 0], color: [0, 0.9, 0] },
  { pos: [0, -GIZMO_ARROW_SIZE, 0], color: [0, 0.4, 0] },
  { pos: [0, 0, GIZMO_ARROW_SIZE], color: [0, 0, 0.9] },
  { pos: [0, 0, -GIZMO_ARROW_SIZE], color: [0, 0, 0.4] },
];
/** `viewTable` (eda_3d_canvas.cpp:605): the view each sphere requests. */
const GIZMO_VIEWS: View3dType[] = ['right', 'left', 'back', 'front', 'top', 'bottom'];

/** `SPHERES_GIZMO::setGizmoMaterial`: colour-material, specular 0.1, exponent 96. */
function gizmoSphereMaterial(color: Vec3): SMaterial {
  return {
    ambient: color,
    diffuse: color,
    specular: [0.1, 0.1, 0.1],
    emissive: [0, 0, 0],
    shininess: 96 / 128,
    transparency: 1 - 0.3, // glColor4f( …, 0.3f ) with GL_BLEND on
  };
}

// ---------------------------------------------------------------------------

/** Mount the 3D viewer into `container`; returns a disposer. `projectFiles`
 *  carries the open project's own files so ${KIPRJMOD}/relative model
 *  references resolve like KiCad's project directory. */
export function mount3DViewer(
  container: HTMLElement,
  board: Board,
  projectFiles?: ProjectFile[],
  /**
   * `BOARD_ADAPTER`'s `m_UseStackupColors` override — the Physical Stackup
   * page's Color column, mapped through `board_adapter_colors.ts`. Omitted (the
   * footprint browser, which has no board stackup) falls back to the `g_Default*`
   * colours, which is what upstream does with the option off.
   */
  stackup?: StackupColors,
  /**
   * `EDA_3D_VIEWER_SETTINGS`' render half — Preferences > 3D Viewer > General
   * and > Realtime Renderer. Omitted (the footprint browser) takes the file's
   * own defaults, which is what a viewer with no settings object gets upstream.
   */
  renderIn: Viewer3dRenderOptions = {},
): Viewer3D | null {
  // The appearance pane hands the whole `GetVisibleLayers()` set; it is the
  // same information as the `show_*` booleans below, so expand it into them
  // once and let every reader stay a boolean (`SetVisibleLayers`, in reverse).
  const render: Viewer3dRenderOptions = renderIn.visible3d
    ? {
        ...renderIn,
        showBoardBody: renderIn.visible3d.has('LAYER_3D_BOARD'),
        showPlatedBarrels: renderIn.visible3d.has('LAYER_3D_PLATED_BARRELS'),
        showSoldermaskTop: renderIn.visible3d.has('LAYER_3D_SOLDERMASK_TOP'),
        showSoldermaskBottom: renderIn.visible3d.has('LAYER_3D_SOLDERMASK_BOTTOM'),
        showFpReferences: renderIn.visible3d.has('LAYER_FP_REFERENCES'),
        showFpValues: renderIn.visible3d.has('LAYER_FP_VALUES'),
        showFpText: renderIn.visible3d.has('LAYER_FP_TEXT'),
        showFootprintsNormal: renderIn.visible3d.has('LAYER_3D_TH_MODELS'),
        showFootprintsInsert: renderIn.visible3d.has('LAYER_3D_SMD_MODELS'),
        showFootprintsVirtual: renderIn.visible3d.has('LAYER_3D_VIRTUAL_MODELS'),
        showFootprintsNotInPosfile: renderIn.visible3d.has('LAYER_3D_MODELS_NOT_IN_POS'),
        showFootprintsDnp: renderIn.visible3d.has('LAYER_3D_MODELS_MARKED_DNP'),
        showModelBbox: renderIn.visible3d.has('LAYER_3D_BOUNDING_BOXES'),
        showOffBoardSilk: renderIn.visible3d.has('LAYER_3D_OFF_BOARD_SILK'),
        showNavigator: renderIn.visible3d.has('LAYER_3D_NAVIGATOR'),
      }
    : renderIn;
  const scene2d = buildScene(board);
  if (!scene2d.bbox) return null;
  const bbox = edgeBBox(board, scene2d.bbox);
  const adapter = initAdapter(board, bbox, render.footprintHolder === true);
  const s = adapter.s;
  const to3d = (p: Vec2): [number, number] => [p.x * s, -p.y * s];
  const polys3d = (polys: Polygon[]): [number, number][][][] =>
    polys.map((poly) => poly.map((ring) => ring.map(to3d)));

  // ---- BOARD_ADAPTER colours ------------------------------------------------
  // `GetLayerColors()` (board_adapter.cpp:638): with no saved preset, the
  // colour THEME's `3d_viewer.*` entries — which is what a fresh install
  // gets, because the first open turns `LEGACY_PRESET_FLAG` into
  // FOLLOW_PLOT_SETTINGS and clears `m_UseStackupColors`
  // (eda_3d_viewer_frame.cpp:570-583). The theme has no entry for the four
  // user layers, so `GetColor()` answers UNSPECIFIED for them and they draw
  // black. The stackup's colours replace these only when "Use board stackup
  // colors" is on.
  const T = BUILTIN_DEFAULT_THEME;
  const useStackup = render.useStackupColors === true && stackup !== undefined;
  // The appearance pane's `GetLayerColors()` answer, when there is a pane;
  // the theme-with-stackup fallback is the same function's answer with no
  // preset and no overrides (the footprint browser).
  const lc = render.layerColors;
  const col = (flag: string, fallback: Color4d): Color4d => lc?.get(flag as never) ?? fallback;
  const colors = {
    copper: col(
      'LAYER_3D_COPPER_TOP',
      (useStackup ? stackup.copper : undefined) ?? T.LAYER_3D_COPPER_TOP,
    ),
    solderPaste: col('LAYER_3D_SOLDERPASTE', T.LAYER_3D_SOLDERPASTE),
    silkTop: col(
      'LAYER_3D_SILKSCREEN_TOP',
      useStackup ? stackup.silkTop : T.LAYER_3D_SILKSCREEN_TOP,
    ),
    silkBottom: col(
      'LAYER_3D_SILKSCREEN_BOTTOM',
      useStackup ? stackup.silkBottom : T.LAYER_3D_SILKSCREEN_BOTTOM,
    ),
    maskTop: col(
      'LAYER_3D_SOLDERMASK_TOP',
      useStackup ? stackup.maskTop : T.LAYER_3D_SOLDERMASK_TOP,
    ),
    maskBottom: col(
      'LAYER_3D_SOLDERMASK_BOTTOM',
      useStackup ? stackup.maskBottom : T.LAYER_3D_SOLDERMASK_BOTTOM,
    ),
    boardBody: col('LAYER_3D_BOARD', (useStackup ? stackup.body : undefined) ?? T.LAYER_3D_BOARD),
    bgTop: col('LAYER_3D_BACKGROUND_TOP', T.LAYER_3D_BACKGROUND_TOP),
    bgBot: col('LAYER_3D_BACKGROUND_BOTTOM', T.LAYER_3D_BACKGROUND_BOTTOM),
    userDrawings: col('LAYER_3D_USER_DRAWINGS', COLOR4D_UNSPECIFIED),
    userComments: col('LAYER_3D_USER_COMMENTS', COLOR4D_UNSPECIFIED),
    eco1: col('LAYER_3D_USER_ECO1', COLOR4D_UNSPECIFIED),
    eco2: col('LAYER_3D_USER_ECO2', COLOR4D_UNSPECIFIED),
  };
  const mats = boardMaterials(colors);
  /**
   * `MATERIAL_MODE` (3d_enums.h): NORMAL keeps `setLayerMaterial`'s set;
   * DIFFUSE_ONLY and CAD_MODE go through `OglSetDiffuseMaterial` on the
   * models. The board layers only ever take `OglSetMaterial`; the mode is a
   * model-side switch upstream, and it is honoured there (`modelMaterial`).
   */
  const materialMode = render.materialMode ?? 0;

  // ---- geometry (BOARD_ADAPTER::createLayers + RENDER_3D_OPENGL::reload) --
  // FOLLOW_PLOT_SETTINGS (`GetVisibleLayers`, board_adapter.cpp:907-935):
  // which layers exist in 3D is the board's plot layer selection.
  const plot = plotLayerSelection(board);
  // With a pane, the visible PCB layers are the pane's flags mapped back
  // through Map3DLayerToPCBLayer; without one, the plot selection is the flags.
  const visiblePcbLayers = render.visible3d
    ? new Set(
        [...render.visible3d]
          .map((f) => pcbLayerOfFlag(f as Layer3dFlag))
          .filter((n): n is string => n !== undefined)
          .flatMap((n) =>
            // ADHESIVE and SOLDERPASTE are one flag for both sides
            n === 'F.Adhes'
              ? ['F.Adhes', 'B.Adhes']
              : n === 'F.Paste'
                ? ['F.Paste', 'B.Paste']
                : [n],
          )
          .map((n) => pcbLayerIdOf(n)),
      )
    : plot.layers;
  const layerOpts: Layer3dOptions = {
    showZones: render.showZones !== false,
    showFpReferences: render.showFpReferences ?? plot.plotReference,
    showFpValues: render.showFpValues ?? plot.plotValue,
    showFpText: render.showFpText ?? plot.plotFPText,
    visibleLayers: visiblePcbLayers,
    showOffBoardSilk: render.showOffBoardSilk,
    subtractMaskFromSilk: render.subtractMaskFromSilk,
    clipSilkOnViaAnnuli: render.clipSilkOnViaAnnuli,
    showPlatedBarrels: render.showPlatedBarrels,
    differentiatePlatedCopper: render.differentiatePlatedCopper,
  };
  const built = buildBoard3dLayers(board, bbox, layerOpts);
  const showThickness = render.copperThickness !== false;

  // ---- three.js -------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // `render.opengl_AA_mode` — `ANTIALIASING_MODE::AA_NONE` is 0 and the
      // rest are on. WebGL takes a BOOLEAN and picks the sample count itself.
      antialias: render.antiAliasing !== 0,
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
  } catch {
    container.removeChild(canvas);
    return null;
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  // glClearColor( 0, 0, 0, 0 ); the gradient quad is what fills the frame.
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.sortObjects = true;

  const disposables: { dispose(): void }[] = [];
  const lights = makeSharedLightUniforms();
  const scene = new THREE.Scene();

  // OglDrawBackground: a full-screen quad, top colour at the top edge, bottom
  // colour at the bottom, interpolated by the rasteriser.
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 1, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0], 3),
    );
    const c = (col: Color4d): number[] => [col.r * col.a, col.g * col.a, col.b * col.a, col.a];
    g.setAttribute(
      'aColor',
      new THREE.Float32BufferAttribute(
        [...c(colors.bgTop), ...c(colors.bgBot), ...c(colors.bgBot), ...c(colors.bgTop)],
        4,
      ),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = makeVertexColorMaterial({ depthTest: false });
    m.depthWrite = false;
    m.transparent = false;
    bgScene.add(new THREE.Mesh(g, m));
    disposables.push(g, m);
  }

  const RENDER_ORDER = {
    holes: 0,
    copper: 1,
    tech: 2,
    opaqueModels: 3,
    body: 4,
    maskFar: 5,
    maskNear: 6,
    transparentModels: 7,
    grid: 8,
  };

  const addMesh = (
    geom: THREE.BufferGeometry | null,
    mat: THREE.ShaderMaterial,
    order: number,
  ): THREE.Mesh | null => {
    if (!geom) return null;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    scene.add(mesh);
    disposables.push(geom, mat);
    return mesh;
  };

  /** `getLayerZPos`: (top, bottom) for a layer, in 3D units. */
  const zOf = (layer: string): [number, number] => [
    adapter.zTop[layer] ?? 0,
    adapter.zBot[layer] ?? 0,
  ];

  const layerMaterial = (layer: Layer3d): SMaterial => {
    switch (layer) {
      case 'F.Cu':
      case 'B.Cu':
        return mats.copper;
      case 'F.Mask':
        return mats.maskTop;
      case 'B.Mask':
        return mats.maskBottom;
      case 'F.Paste':
      case 'B.Paste':
        return mats.paste;
      case 'F.SilkS':
        return mats.silkTop;
      case 'B.SilkS':
        return mats.silkBottom;
      case 'Dwgs.User':
        return plasticMaterial([
          colors.userDrawings.r,
          colors.userDrawings.g,
          colors.userDrawings.b,
        ]);
      case 'Cmts.User':
        return plasticMaterial([
          colors.userComments.r,
          colors.userComments.g,
          colors.userComments.b,
        ]);
      case 'Eco1.User':
        return plasticMaterial([colors.eco1.r, colors.eco1.g, colors.eco1.b]);
      case 'Eco2.User':
        return plasticMaterial([colors.eco2.r, colors.eco2.g, colors.eco2.b]);
      default: {
        // User_1..45: `m_UserDefinedLayerColor[ idx ]`, the theme's
        // `3d_viewer.user_N`, whose default is the board editor's User_N colour.
        const u = userLayerIndex(layer);
        if (u) {
          const c = col(
            `LAYER_3D_USER_${u}`,
            (BUILTIN_DEFAULT_THEME as Record<string, Color4d>)[`User_${u}`] ?? COLOR4D_UNSPECIFIED,
          );
          return plasticMaterial([c.r, c.g, c.b]);
        }
        // F/B.Adhes: `GetLayerColor( aLayerID )` — the board editor's colour
        // for the layer; the 3D viewer has no default of its own for it.
        return plasticMaterial([
          colors.userDrawings.r,
          colors.userDrawings.g,
          colors.userDrawings.b,
        ]);
      }
    }
  };

  // m_padHoles: the plated barrels, F_Cu top to B_Cu bottom, copper material
  // (drawn first, `setLayerMaterial( B_Cu )`).
  {
    const buf = newBuf();
    const p = polys3d(built.platedBarrels);
    const [fTop] = zOf('F.Cu');
    const [, bBot] = zOf('B.Cu');
    addTopAndBottom(buf, p, fTop, bBot);
    addMiddleContours(buf, p, bBot, fTop);
    addMesh(toGeometry(buf), makeFixedFunctionMaterial(mats.copper, lights), RENDER_ORDER.holes);
  }

  // m_microviaHoles (generateViaBarrels): a blind/micro via's barrel between
  // its two end layers, drawn first with the copper material like the pad
  // holes. The ring's two circles share their segment count and angles
  // (generateRing), so the wall quads pair up vertex for vertex.
  if (built.viaBarrels.length && render.showPlatedBarrels !== false) {
    const buf = newBuf();
    const plating = 0.02 * MM;
    for (const v of built.viaBarrels) {
      const outer = transformCircleToPolygonSet(
        v.at,
        Math.trunc(v.drill / 2) + plating,
        ARC_HIGH_DEF,
        ErrorLoc.ERROR_INSIDE,
      );
      const inner = transformCircleToPolygonSet(
        v.at,
        Math.trunc(v.drill / 2),
        ARC_HIGH_DEF,
        ErrorLoc.ERROR_INSIDE,
      );
      const ring = polys3d([[outer, [...inner].reverse()]]);
      const [zt] = zOf(v.topLayer);
      const [, zb] = zOf(v.bottomLayer);
      addTopAndBottom(buf, ring, zt, zb);
      addMiddleContours(buf, ring, zb, zt);
    }
    addMesh(toGeometry(buf), makeFixedFunctionMaterial(mats.copper, lights), RENDER_ORDER.holes);
  }

  // Display copper and tech layers
  for (const layer of Object.keys(built.layers) as Layer3d[]) {
    const polys = built.layers[layer];
    if (!polys || polys.length === 0) continue;
    if (layer === 'F.Mask' || layer === 'B.Mask') continue; // special case below
    const [zTop, zBot] = zOf(layer);
    const p = polys3d(polys);
    const buf = newBuf();
    addTopAndBottom(buf, p, zTop, zBot);
    if (showThickness) addMiddleContours(buf, p, zBot, zTop);
    const isCopper = layer === 'F.Cu' || layer === 'B.Cu';
    // `cfg.DifferentiatePlatedCopper() ? setCopperMaterial() : setLayerMaterial( layer )`
    let copperMat = render.differentiatePlatedCopper ? mats.nonPlatedCopper : mats.copper;
    // setLayerMaterial's first branch: with "Use PCB editor copper colors" the
    // copper diffuse is the board editor's colour for THAT layer (m_Copper
    // and m_NonPlatedCopper alike), the rest of the material unchanged.
    const edCol = render.useBoardEditorCopperColors
      ? render.boardEditorCopperColors?.[layer as 'F.Cu' | 'B.Cu']
      : undefined;
    if (isCopper && edCol) copperMat = { ...copperMat, diffuse: [edCol.r, edCol.g, edCol.b] };
    // Offset non-copper layers slightly closer to the screen than soldermask
    // to avoid Z-fighting (glPolygonOffset( 0, -4 )).
    addMesh(
      toGeometry(buf),
      makeFixedFunctionMaterial(isCopper ? copperMat : layerMaterial(layer), lights, {
        polygonOffset: isCopper ? undefined : [0, -4],
      }),
      isCopper ? RENDER_ORDER.copper : RENDER_ORDER.tech,
    );
    // Draw plated & offboard pads: setPlatedCopperAndDepthOffset — the finish
    // colour, pulled towards the screen by glPolygonOffset( -0.1, -2 ).
    if (isCopper) {
      const plated = built.platedCopper[layer as 'F.Cu' | 'B.Cu'];
      if (plated.length) {
        const pb = newBuf();
        const pp = polys3d(plated);
        addTopAndBottom(pb, pp, zTop, zBot);
        if (showThickness) addMiddleContours(pb, pp, zBot, zTop);
        addMesh(
          toGeometry(pb),
          makeFixedFunctionMaterial(mats.copper, lights, { polygonOffset: [-0.1, -2] }),
          RENDER_ORDER.copper,
        );
      }
    }
  }

  // Display board body: m_boardWithHoles, EpoxyBoard material, translucent,
  // pushed away from the screen (glPolygonOffset( 0, 2 )). Its walls skip
  // the edges that run through a plated hole — the barrel is there instead.
  const bodyAlpha = colors.boardBody.a;
  if (render.showBoardBody !== false) {
    const buf = newBuf();
    const p = polys3d(built.boardWithHoles);
    const hz = adapter.boardBodyThickness3DU / 2;
    addTopAndBottom(buf, p, hz, -hz);
    const thID = polys3d(built.thID);
    const inPlatedHole = (a: [number, number], b: [number, number]): boolean => {
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2;
      for (const poly of thID) {
        const ring = poly[0]!;
        // a ring's bbox is enough: a drill ring is convex and the edge lies on it
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const q of ring) {
          if (q[0] < minX) minX = q[0];
          if (q[0] > maxX) maxX = q[0];
          if (q[1] < minY) minY = q[1];
          if (q[1] > maxY) maxY = q[1];
        }
        const eps = 1e-6;
        if (mx >= minX - eps && mx <= maxX + eps && my >= minY - eps && my <= maxY + eps)
          return true;
      }
      return false;
    };
    addMiddleContours(buf, p, -hz, hz, inPlatedHole);
    addMesh(
      toGeometry(buf),
      makeFixedFunctionMaterial(mats.epoxyBoard, lights, {
        transparent: bodyAlpha < 1,
        polygonOffset: [0, 2],
      }),
      RENDER_ORDER.body,
    );
  }

  // Display transparent mask layers: the BOARD polygon minus the openings and
  // the holes, at the mask Z, pulled towards the screen
  // (glPolygonOffset( 0, -2 )), bottom first when the camera is above.
  const maskMeshes: { layer: 'F.Mask' | 'B.Mask'; mesh: THREE.Mesh }[] = [];
  for (const layer of ['B.Mask', 'F.Mask'] as const) {
    const polys = built.layers[layer];
    if (!polys || polys.length === 0) continue;
    if (layer === 'F.Mask' && render.showSoldermaskTop === false) continue;
    if (layer === 'B.Mask' && render.showSoldermaskBottom === false) continue;
    const mat = layer === 'F.Mask' ? mats.maskTop : mats.maskBottom;
    // renderSolderMaskLayer: F_Mask at GetLayerBottomZPos( F_Mask ) growing
    // by the tech thickness; B_Mask at GetLayerTopZPos( B_Mask ) likewise.
    const [fTop, fBot] = zOf(layer);
    const zBase = layer === 'F.Mask' ? fBot : fTop;
    const zTop = zBase + adapter.nonCopperLayerThickness3DU;
    const buf = newBuf();
    const p = polys3d(polys);
    addTopAndBottom(buf, p, zTop, zBase);
    if (showThickness) addMiddleContours(buf, p, zBase, zTop);
    // m_viaFrontCover / m_viaBackCover: a tented via's hole is capped by a
    // mask-coloured disk of radius drill/2 + 2·plating, at the copper top
    // pushed through ApplyScalePosition( zPos, 4 · techThickness ).
    const side = layer === 'F.Mask' ? 'front' : 'back';
    const plating3d = 0.02 * MM * s;
    for (const via of board.vias) {
      // generateViaCovers: COVERED explicitly, or tented on this side. A
      // FROM_BOARD covering mode is not COVERED here — only the tenting is
      // resolved against the board.
      const covering = via.covering?.[side] === true || viaIsTented(board, via, side);
      if (!covering) continue;
      // (post-machined and backdrilled vias are not covered — not modelled)
      const plugged = via.plugging?.[side] === true;
      const filled = via.filling === true || via.capping === true;
      const holeRadius = (via.drill * s) / 2 + 2 * plating3d;
      const [cx, cy] = to3d(via.at);
      // via->LayerPair(): ztop of its top layer, zbot of its bottom layer
      const [zt] = zOf(via.layers[0]);
      const [, zb] = zOf(via.layers[1]);
      const zList = layer === 'F.Mask' ? zt : zb;
      const z = zBase + zList * 4 * adapter.nonCopperLayerThickness3DU;
      const seg = getArcToSegmentCount(Math.trunc(via.drill / 2), ARC_HIGH_DEF, 360);
      const nz = layer === 'F.Mask' ? 1 : -1;
      // generateDisk for a filled or unplugged via; generateDimple (a cone
      // 0.3·r deep into the hole) for a plugged one — both lit as a flat
      // top/bottom face, the list's own normal.
      const depth = holeRadius * 0.3;
      const zCentre =
        filled || !plugged ? z : z - nz * depth * 4 * adapter.nonCopperLayerThickness3DU;
      const base = buf.pos.length / 3;
      buf.pos.push(cx, cy, zCentre);
      buf.nrm.push(0, 0, nz);
      for (let i = 0; i < seg; i++) {
        const a = (2 * Math.PI * i) / seg;
        buf.pos.push(cx + holeRadius * Math.cos(a), cy + holeRadius * Math.sin(a), z);
        buf.nrm.push(0, 0, nz);
      }
      for (let i = 0; i < seg; i++) {
        const a = base + 1 + i,
          b = base + 1 + ((i + 1) % seg);
        if (nz > 0) buf.idx.push(base, a, b);
        else buf.idx.push(base, b, a);
      }
    }
    const mesh = addMesh(
      toGeometry(buf),
      makeFixedFunctionMaterial(mat, lights, {
        transparent: mat.transparency > 0,
        polygonOffset: [0, -2],
      }),
      RENDER_ORDER.maskFar,
    );
    if (mesh) maskMeshes.push({ layer, mesh });
  }

  // ---- 3D models --------------------------------------------------------------
  /**
   * `MODEL_3D::Draw` in NORMAL mode: `OglSetMaterial( mat, opacity )` under
   * `glColorMaterial( GL_AMBIENT_AND_DIFFUSE )`, so ambient and diffuse are
   * the model's diffuse. DIFFUSE_ONLY / CAD_MODE go through
   * `OglSetDiffuseMaterial`.
   */
  // `render.opengl_selection_color`, `GetColor( cfg.opengl_selection_color )`
  const selColor4 = parseColor4d(render.selectionColor ?? 'rgb(0, 255, 0)');
  const selColor: Vec3 = [selColor4.r, selColor4.g, selColor4.b];
  const modelMaterial = (
    m: SMaterial,
    opacity: number,
    transparentPass: boolean,
    selected: boolean,
  ): THREE.ShaderMaterial => {
    let sm = m;
    if (materialMode === 1) sm = diffuseOnlyMaterial(m.diffuse);
    else if (materialMode === 2) sm = diffuseOnlyMaterial(materialDiffuseToColorCAD(m.diffuse));
    // A selected model is drawn with `BeginDrawMulti( false )` — no colour
    // array, so ambient is the loader's own (0.1·diffuse for STEP) and the
    // diffuse is the selection colour (OglSetMaterial's aUseSelectedMaterial).
    if (selected) sm = { ...sm, diffuse: selColor };
    const mat = makeFixedFunctionMaterial(
      { ...sm, transparency: materialMode === 1 ? 0 : m.transparency },
      lights,
      {
        opacity,
        colorMaterial: !selected,
        transparent: transparentPass,
        depthWrite: !transparentPass,
      },
    );
    disposables.push(mat);
    return mat;
  };

  const modelsGroup = new THREE.Group();
  scene.add(modelsGroup);
  const disposeComponents = mountComponents(
    modelsGroup,
    board,
    {
      // the footprint placement frame, in 3D units: translate( pos.x·s, −pos.y·s, zpos )
      scale: s,
      zTopFront: adapter.zTop['F.Cu']!,
      zTopBack: adapter.zTop['B.Cu']!,
      // modelunit_to_3d_units_factor = BiuTo3dUnits · IU_PER_MM
      modelUnitToWorld: s * MM,
    },
    MODELS3D_BASE,
    projectFiles,
    () => {
      needsRender = true; // a model arrived: Request_refresh()
    },
    render.showModelBbox === true,
    {
      material: modelMaterial,
      opaqueOrder: RENDER_ORDER.opaqueModels,
      transparentOrder: RENDER_ORDER.transparentModels,
      showFootprint: (fp) => {
        // BOARD_ADAPTER::IsFootprintShown: the five show_footprints_* flags.
        const attrs = fp.attributes ?? [];
        // show_footprints_dnp defaults to FALSE: a DNP part has no model on the board
        if (attrs.includes('dnp') && !(render.showFootprintsDnp ?? false)) return false;
        if (attrs.includes('exclude_from_pos_files') && render.showFootprintsNotInPosfile === false)
          return false;
        const smd = attrs.includes('smd');
        const tht = attrs.includes('through_hole');
        if (smd && render.showFootprintsInsert === false) return false;
        if (tht && render.showFootprintsNormal === false) return false;
        if (!smd && !tht && render.showFootprintsVirtual === false) return false;
        return true;
      },
    },
  );

  // ---- 3D grid (generate3dGrid) ------------------------------------------------
  let gridObj: THREE.LineSegments | null = null;
  const setGrid = (grid: Grid3D): void => {
    if (gridObj) {
      scene.remove(gridObj);
      gridObj.geometry.dispose();
      (gridObj.material as THREE.Material).dispose();
      gridObj = null;
    }
    const griSizeMM = { none: 0, '1mm': 1, '2.5mm': 2.5, '5mm': 5, '10mm': 10 }[grid];
    if (!griSizeMM) return;
    // Color of grid lines / of grid lines every 5 lines
    const gridColor = LEGACY_COLORS.DARKGRAY;
    const gridColorMarker = LEGACY_COLORS.LIGHTBLUE;
    const transparency = 0.35;
    const pos: number[] = [];
    const col: number[] = [];
    const line = (a: Vec3, b: Vec3, marker: boolean): void => {
      const c = marker ? gridColorMarker : gridColor;
      pos.push(...a, ...b);
      col.push(c.r, c.g, c.b, transparency, c.r, c.g, c.b, transparency);
    };
    const brdSize = adapter.boardSize;
    const brdCenter = { x: adapter.boardPos.x, y: -adapter.boardPos.y };
    const xsize = Math.max(brdSize.x, 100 * MM) * 1.2;
    const ysize = Math.max(brdSize.y, 100 * MM) * 1.2;
    let xmin = (brdCenter.x - xsize / 2) * s;
    let xmax = (brdCenter.x + xsize / 2) * s;
    const ymin = (brdCenter.y - ysize / 2) * s;
    const ymax = (brdCenter.y + ysize / 2) * s;
    const zmin = -50 * MM * s;
    const zmax = 100 * MM * s;
    const zpos = 0;
    // Draw horizontal grid centered on 3D origin (center of the board)
    for (let ii = 0; ; ii++) {
      const marker = ii % 5 === 0;
      const delta = Math.round(ii * griSizeMM * MM);
      if (delta <= xsize / 2) {
        line(
          [(brdCenter.x + delta) * s, -ymin, zpos],
          [(brdCenter.x + delta) * s, -ymax, zpos],
          marker,
        );
        if (ii !== 0)
          line(
            [(brdCenter.x - delta) * s, -ymin, zpos],
            [(brdCenter.x - delta) * s, -ymax, zpos],
            marker,
          );
      }
      if (delta <= ysize / 2) {
        line(
          [xmin, -(brdCenter.y + delta) * s, zpos],
          [xmax, -(brdCenter.y + delta) * s, zpos],
          marker,
        );
        if (ii !== 0)
          line(
            [xmin, -(brdCenter.y - delta) * s, zpos],
            [xmax, -(brdCenter.y - delta) * s, zpos],
            marker,
          );
      }
      if (delta > ysize / 2 && delta > xsize / 2) break;
    }
    // Draw vertical grid lines (parallel to Z axis)
    const posy = -brdCenter.y * s;
    for (let ii = 0; ; ii++) {
      const marker = ii % 5 === 0;
      const delta = ii * griSizeMM * MM;
      xmax = (brdCenter.x + delta) * s;
      line([xmax, posy, zmin], [xmax, posy, zmax], marker);
      if (ii !== 0) {
        xmin = (brdCenter.x - delta) * s;
        line([xmin, posy, zmin], [xmin, posy, zmax], marker);
      }
      if (delta > xsize / 2) break;
    }
    // Draw horizontal grid lines on Z axis (parallel to X axis)
    for (let ii = 0; ; ii++) {
      const marker = ii % 5 === 0;
      const delta = ii * griSizeMM * MM * s;
      if (delta <= zmax) line([xmin, posy, delta], [xmax, posy, delta], marker);
      if (delta <= -zmin && ii !== 0) line([xmin, posy, -delta], [xmax, posy, -delta], marker);
      if (delta > zmax && delta > -zmin) break;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 4));
    gridObj = new THREE.LineSegments(g, makeVertexColorMaterial());
    gridObj.renderOrder = RENDER_ORDER.grid;
    gridObj.frustumCulled = false;
    scene.add(gridObj);
  };

  // ---- navigator (SPHERES_GIZMO) ----------------------------------------------
  const gizmoScene = new THREE.Scene();
  const gizmoCam = new THREE.Camera();
  gizmoCam.matrixAutoUpdate = false;
  gizmoCam.matrixWorldAutoUpdate = false;
  const gizmoProj = mat4Perspective((GIZMO_FOV * Math.PI) / 180, 1, 0.001, 2 * RANGE_SCALE_3D);
  const gizmoLights = makeSharedLightUniforms();
  const gizmoBillboards: { mesh: THREE.Mesh; center: Vec3; radius: number }[] = [];
  const gizmoLabels: { mesh: THREE.LineSegments; center: Vec3; label: 'X' | 'Y' | 'Z' }[] = [];
  {
    for (const [i, sp] of GIZMO_SPHERES.entries()) {
      const g = new THREE.SphereGeometry(GIZMO_SPHERE_RADIUS, 32, 32);
      g.translate(...sp.pos);
      const m = makeFixedFunctionMaterial(gizmoSphereMaterial(sp.color), gizmoLights, {
        colorMaterial: true,
        transparent: true,
        doubleSide: true, // glDisable( GL_CULL_FACE )
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = i;
      gizmoScene.add(mesh);
      disposables.push(g, m);
      // drawBillboardCircle: a ring of thickness 0.4·r in the screen plane,
      // in the sphere's own colour, opaque.
      const rg = new THREE.BufferGeometry();
      rg.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(new Float32Array(65 * 2 * 3), 3),
      );
      const idx: number[] = [];
      for (let k = 0; k < 64; k++) {
        const o0 = k * 2,
          i0 = k * 2 + 1,
          o1 = k * 2 + 2,
          i1 = k * 2 + 3;
        idx.push(o0, i0, o1, i0, i1, o1);
      }
      rg.setIndex(idx);
      const rm = makeUnlitMaterial(sp.color, 1);
      rm.side = THREE.DoubleSide;
      // drawn AFTER the translucent sphere (render3dSpheresGizmo's order);
      // three.js only honours renderOrder within one queue, so opaque
      // things that must follow a blended one join the blended queue.
      rm.transparent = true;
      const ring = new THREE.Mesh(rg, rm);
      ring.renderOrder = 10 + i;
      ring.frustumCulled = false;
      gizmoScene.add(ring);
      disposables.push(rg, rm);
      gizmoBillboards.push({ mesh: ring, center: sp.pos, radius: GIZMO_SPHERE_RADIUS });
      const label = (['X', '', 'Y', '', 'Z', ''] as const)[i]!;
      if (label) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
        const lm = makeUnlitMaterial([0, 0, 0], 1, { depthTest: false, depthWrite: false });
        lm.transparent = true;
        const ls = new THREE.LineSegments(lg, lm);
        ls.renderOrder = 20 + i;
        ls.frustumCulled = false;
        gizmoScene.add(ls);
        disposables.push(lg, lm);
        gizmoLabels.push({ mesh: ls, center: sp.pos, label });
      }
    }
    // Draw lines only to the positive axis spheres
    const ag = new THREE.BufferGeometry();
    ag.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0,
          0,
          0,
          GIZMO_ARROW_SIZE,
          0,
          0,
          0,
          0,
          0,
          0,
          GIZMO_ARROW_SIZE,
          0,
          0,
          0,
          0,
          0,
          0,
          GIZMO_ARROW_SIZE,
        ],
        3,
      ),
    );
    ag.setAttribute(
      'aColor',
      new THREE.Float32BufferAttribute(
        [0.9, 0, 0, 1, 0.9, 0, 0, 1, 0, 0.9, 0, 1, 0, 0.9, 0, 1, 0, 0, 0.9, 1, 0, 0, 0.9, 1],
        4,
      ),
    );
    const am = makeVertexColorMaterial();
    const axes = new THREE.LineSegments(ag, am);
    axes.renderOrder = 30;
    axes.frustumCulled = false;
    gizmoScene.add(axes);
    disposables.push(ag, am);
  }

  /** `SPHERES_GIZMO::render3dSpheresGizmo` — the per-frame billboard/label placement. */
  const updateGizmo = (rot: Mat4): void => {
    const camRight: Vec3 = [rot[0]!, rot[4]!, rot[8]!];
    const camUp: Vec3 = [rot[1]!, rot[5]!, rot[9]!];
    const camForward: Vec3 = [rot[2]!, rot[6]!, rot[10]!];
    for (const b of gizmoBillboards) {
      const thickness = b.radius * 0.4;
      const arr = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= 64; i++) {
        const angle = (2 * Math.PI * i) / 64;
        const dir: Vec3 = [
          Math.cos(angle) * camRight[0] + Math.sin(angle) * camUp[0],
          Math.cos(angle) * camRight[1] + Math.sin(angle) * camUp[1],
          Math.cos(angle) * camRight[2] + Math.sin(angle) * camUp[2],
        ];
        const ro = b.radius + thickness * 0.5,
          ri = b.radius - thickness * 0.5;
        arr.setXYZ(
          i * 2,
          b.center[0] + dir[0] * ro,
          b.center[1] + dir[1] * ro,
          b.center[2] + dir[2] * ro,
        );
        arr.setXYZ(
          i * 2 + 1,
          b.center[0] + dir[0] * ri,
          b.center[1] + dir[1] * ri,
          b.center[2] + dir[2] * ri,
        );
      }
      arr.needsUpdate = true;
    }
    const offset: Vec3 = [camForward[0] * 0.02, camForward[1] * 0.02, camForward[2] * 0.02];
    const h = 0.3 * 0.5;
    const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [
      a[0] + b[0] * k,
      a[1] + b[1] * k,
      a[2] + b[2] * k,
    ];
    for (const l of gizmoLabels) {
      const p = add(l.center, offset);
      const arr = l.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const set = (i: number, v: Vec3): void => {
        arr.setXYZ(i, v[0], v[1], v[2]);
      };
      const up = camUp,
        right = camRight;
      if (l.label === 'X') {
        const dir1 = add([0, 0, 0], add(add([0, 0, 0], right, -1), up), h);
        const dir2 = add([0, 0, 0], add(add([0, 0, 0], right, -1), up, -1), h);
        set(0, add(p, dir1, -1));
        set(1, add(p, dir1));
        set(2, add(p, dir2, -1));
        set(3, add(p, dir2));
        set(4, p);
        set(5, p);
        set(6, p);
        set(7, p);
      } else if (l.label === 'Y') {
        const topLeft = add(add(p, up, h), right, -h);
        const topRight = add(add(p, up, h), right, h);
        const bottom = add(p, up, -h);
        set(0, topLeft);
        set(1, p);
        set(2, topRight);
        set(3, p);
        set(4, p);
        set(5, bottom);
        set(6, p);
        set(7, p);
      } else {
        const topLeft = add(add(p, up, h), right, -h);
        const topRight = add(add(p, up, h), right, h);
        const bottomLeft = add(add(p, up, -h), right, -h);
        const bottomRight = add(add(p, up, -h), right, h);
        set(0, topLeft);
        set(1, topRight);
        set(2, topRight);
        set(3, bottomLeft);
        set(4, bottomLeft);
        set(5, bottomRight);
        set(6, p);
        set(7, p);
      }
      arr.needsUpdate = true;
    }
  };

  /**
   * `SPHERES_GIZMO::updateSelection`: the sphere under a click inside the
   * gizmo's viewport, or -1. `mx, my` are device pixels with y up.
   */
  const gizmoHit = (mx: number, my: number, rot: Mat4): number => {
    const dpr = renderer.getPixelRatio();
    const viewportH = Math.round(canvas.clientHeight * dpr);
    const small = Math.floor(viewportH / 8);
    const gx = 4,
      gy = 4;
    if (!(mx >= gx && mx <= gx + small && my >= gy && my <= gy + small)) return -1;
    const ndcX = (2 * (mx - gx)) / small - 1;
    const ndcY = (2 * (my - gy)) / small - 1;
    const view = mat4Multiply(
      mat4Translate(mat4Identity(), [0, 0, -(GIZMO_ARROW_SIZE * 2.75)]),
      rot,
    );
    const invVP = mat4Inverse(mat4Multiply(gizmoProj, view));
    const start = mat4TransformPoint(invVP, [ndcX, ndcY, -1]);
    const end = mat4TransformPoint(invVP, [ndcX, ndcY, 1]);
    const dir: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const L = Math.hypot(...dir) || 1;
    const rd: Vec3 = [dir[0] / L, dir[1] / L, dir[2] / L];
    let best = -1;
    let closest = Infinity;
    GIZMO_SPHERES.forEach((sp, i) => {
      const Lv: Vec3 = [sp.pos[0] - start[0], sp.pos[1] - start[1], sp.pos[2] - start[2]];
      const tca = Lv[0] * rd[0] + Lv[1] * rd[1] + Lv[2] * rd[2];
      const d2 = Lv[0] * Lv[0] + Lv[1] * Lv[1] + Lv[2] * Lv[2] - tca * tca;
      if (d2 > GIZMO_SPHERE_RADIUS * GIZMO_SPHERE_RADIUS) return;
      if (tca >= 0 && tca < closest) {
        closest = tca;
        best = i;
      }
    });
    return best;
  };

  // ---- camera (TRACK_BALL) ---------------------------------------------------
  const camera = new TrackBallCamera(INITIAL_CAMERA_DISTANCE, 'perspective');
  camera.setBoardLookAtPos(adapter.boardCenter);
  const threeCam = new THREE.Camera();
  threeCam.matrixAutoUpdate = false;
  threeCam.matrixWorldAutoUpdate = false;

  const cameraOpts: Viewer3dCameraOptions = {
    rotationIncrement: 10,
    animationEnabled: true,
    movingSpeedMultiplier: 3,
  };
  const setCamera = (o: Partial<Viewer3dCameraOptions>): void => {
    Object.assign(cameraOpts, o);
  };

  // EDA_3D_CANVAS's movement state
  let cameraIsMoving = false;
  let cameraMovingSpeed = 1;
  let strtimeCameraMovement = 0;
  let mouseIsMoving = false;
  let mouseWasMoved = false;
  let needsRender = true;

  let status: Viewer3DStatus = { dx: 0, dy: 0, zoom: 1, activity: '', hovered: '' };
  const pushStatus = (): void => {
    api.onStatus?.(status);
  };
  /** `DisplayStatus`: dx/dy are the camera pan, zoom is 1/m_zoom. */
  const displayStatus = (): void => {
    const cp = camera.getCameraPos();
    status = { ...status, dx: cp[0], dy: cp[1], zoom: 1 / camera.getZoom() };
    pushStatus();
  };

  /** `request_start_moving_camera( aMovingSpeed, aRenderPivot )`. */
  const requestStartMovingCamera = (movingSpeed = 2.0): void => {
    // Fast forward the animation if the animation is disabled
    if (!cameraOpts.animationEnabled) {
      camera.interpolate(1.0);
      displayStatus();
      needsRender = true;
      return;
    }
    // Map speed multiplier option to actual multiplier value
    // [1,2,3,4,5] -> [0.25, 0.5, 1, 2, 4]
    movingSpeed *= (1 << cameraOpts.movingSpeedMultiplier) / 8;
    cameraMovingSpeed = movingSpeed;
    displayStatus();
    needsRender = true;
    cameraIsMoving = true;
    strtimeCameraMovement = performance.now();
  };

  /** `EDA_3D_CANVAS::SetView3D`. */
  const setView3D = (view: View3dType): boolean => {
    if (cameraIsMoving) return false;
    const deltaMove = DELTA_MOVE_STEP_FACTOR * camera.getZoom();
    const arrowMovingTimeSpeed = 8.0;
    switch (view) {
      case 'pan_left':
      case 'pan_right':
      case 'pan_up':
      case 'pan_down': {
        camera.setInterpolateMode('linear');
        camera.setT0AndT1CurrentT();
        const d: Vec3 =
          view === 'pan_left'
            ? [-deltaMove, 0, 0]
            : view === 'pan_right'
              ? [deltaMove, 0, 0]
              : view === 'pan_up'
                ? [0, deltaMove, 0]
                : [0, -deltaMove, 0];
        camera.panT1By(d);
        requestStartMovingCamera(arrowMovingTimeSpeed);
        return true;
      }
      case 'fit_screen':
        camera.setInterpolateMode('bezier');
        camera.setT0AndT1CurrentT();
        camera.resetT1();
        requestStartMovingCamera(Math.min(Math.max(camera.getZoom(), 1 / 1.26), 1.26));
        return true;
      case 'zoom_in':
        camera.setInterpolateMode('bezier');
        camera.setT0AndT1CurrentT();
        if (camera.zoomT1By(1.26)) requestStartMovingCamera(3.0); // 3 steps per doubling
        return true;
      case 'zoom_out':
        camera.setInterpolateMode('bezier');
        camera.setT0AndT1CurrentT();
        if (camera.zoomT1By(1 / 1.26)) requestStartMovingCamera(3.0);
        return true;
      case 'right':
      case 'left':
      case 'front':
      case 'back':
      case 'flip':
        camera.setInterpolateMode('bezier');
        camera.setT0AndT1CurrentT();
        camera.viewCommandT1(view);
        requestStartMovingCamera();
        return true;
      case 'top':
      case 'bottom':
        camera.setInterpolateMode('bezier');
        camera.setT0AndT1CurrentT();
        camera.viewCommandT1(view);
        requestStartMovingCamera(Math.min(Math.max(camera.getZoom(), 0.5), 1.125));
        return true;
      default:
        return false;
    }
  };

  /** `move_pivot_based_on_cur_mouse_position` (Space): look at the board point under the cursor. */
  const pivotCenter = (): void => {
    if (cameraIsMoving) return;
    const ray = camera.makeRayAtCurrentMousePosition();
    if (!ray) return;
    // BBOX_3D::Intersect (slab test) against the board's bounding box
    let tmin = -Infinity,
      tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      const inv = 1 / (ray.dir[i]! || 1e-30);
      let t0 = (adapter.bboxMin[i]! - ray.origin[i]!) * inv;
      let t1 = (adapter.bboxMax[i]! - ray.origin[i]!) * inv;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
    }
    if (tmax < Math.max(tmin, 0)) return;
    const t = tmin > 0 ? tmin : tmax;
    camera.setInterpolateMode('bezier');
    camera.setT0AndT1CurrentT();
    camera.setLookAtPosT1([
      ray.origin[0] + ray.dir[0] * t,
      ray.origin[1] + ray.dir[1] * t,
      ray.origin[2] + ray.dir[2] * t,
    ]);
    camera.resetXYposT1();
    requestStartMovingCamera();
  };

  // ---- picking (IntersectBoardItem), rollover and selection ----------------
  const raycaster = new THREE.Raycaster();
  const netClassOf = (net: number): string => render.netClassOf?.(net) ?? 'Default';
  /** `getRayAtCurrentMousePosition` → the board item under it. */
  const pickUnderMouse = (): PickedItem | null => {
    const ray = camera.makeRayAtCurrentMousePosition();
    if (!ray) return null;
    raycaster.set(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.dir).normalize());
    raycaster.far = Number.POSITIVE_INFINITY;
    let modelHit: { t: number; footprint: number } | null = null;
    for (const hit of raycaster.intersectObject(modelsGroup, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.footprint === undefined) o = o.parent;
      if (o) {
        modelHit = { t: hit.distance, footprint: o.userData.footprint as number };
        break;
      }
    }
    return pickBoardItem(
      board,
      {
        scale: s,
        zTopFront: adapter.zTop['F.Cu']!,
        zBottomBack: adapter.zBot['B.Cu']!,
        boardOutline: built.boardPoly.map((poly) => poly[0]!),
      },
      ray.origin,
      ray.dir,
      modelHit,
    );
  };
  /** `m_currentRollOverItem`, as the footprint it highlights (a model hit only). */
  let rollOverFootprint: number | null = null;
  /** `fp->IsSelected()` — the board editor's selection, cross-probed in. */
  let selectedFootprints: ReadonlySet<number> = new Set();
  const highlightOnRollover = render.highlightOnRollover !== false;
  const applyHighlights = (): void => {
    for (const inst of modelsGroup.children) {
      const fi = inst.userData.footprint as number | undefined;
      if (fi === undefined) continue;
      const on = selectedFootprints.has(fi) || (highlightOnRollover && rollOverFootprint === fi);
      inst.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const want = on ? child.userData.selectedMat : child.userData.normalMat;
        if (want && child.material !== want) child.material = want;
      });
    }
  };
  const setSelectedFootprints = (set: ReadonlySet<number>): void => {
    selectedFootprints = set;
    applyHighlights();
    needsRender = true;
  };
  /** OnMouseMove's rollover half: the HOVERED_ITEM pane and the highlight. */
  const updateRollOver = (): void => {
    const item = pickUnderMouse();
    const msg = hoveredItemMessage(board, item, netClassOf);
    const fp = item?.kind === 'footprint' ? item.footprint : null;
    if (fp !== rollOverFootprint) {
      rollOverFootprint = fp;
      applyHighlights();
      needsRender = true;
    }
    if (msg !== status.hovered) {
      status = { ...status, hovered: msg };
      pushStatus();
    }
  };

  // ---- mouse (HIDPI_GL_3D_CANVAS::OnMouse*Camera) ---------------------------
  const nativePos = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const syncWindowSize = (): void => {
    camera.setCurWindowSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
  };
  let leftDown = false;
  let middleDown = false;
  let dragged = false;
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) leftDown = true;
    else if (e.button === 1) middleDown = true;
    else return;
    dragged = false;
    canvas.setPointerCapture(e.pointerId);
    // OnLeftDown → OnMouseMoveCamera: records the position
    const p = nativePos(e);
    syncWindowSize();
    camera.setCurMousePosition(p.x, p.y);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (cameraIsMoving) return;
    const p = nativePos(e);
    syncWindowSize();
    if (leftDown || middleDown) {
      let handled = false;
      if (leftDown) {
        camera.drag(p.x, p.y);
        handled = true;
      } else if (middleDown) {
        // m_dragMiddle == MOUSE_DRAG_ACTION::PAN, the common default
        camera.pan(p.x, p.y);
        handled = true;
      }
      if (handled) {
        mouseIsMoving = true;
        mouseWasMoved = true;
        dragged = true;
      }
    }
    camera.setCurMousePosition(p.x, p.y);
    if (mouseWasMoved) {
      displayStatus();
      needsRender = true;
    }
    // `if( !event.Dragging() && engine == OPENGL )` — the rollover probe
    if (!leftDown && !middleDown) updateRollOver();
  };
  const onPointerUp = (e: PointerEvent): void => {
    const wasLeft = leftDown && e.button === 0;
    if (e.button === 0) leftDown = false;
    if (e.button === 1) middleDown = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (mouseIsMoving) mouseIsMoving = false;
    if (wasLeft && !dragged) {
      // OnLeftUp: a click on a navigator sphere is a view command
      const dpr = renderer.getPixelRatio();
      const p = nativePos(e);
      const mx = p.x * dpr;
      const my = (canvas.clientHeight - p.y) * dpr;
      const idx = gizmoHit(mx, my, camera.getRotationMatrix());
      if (idx >= 0) setView3D(GIZMO_VIEWS[idx]!);
      else {
        // A plain click that missed the gizmo: cross-probe the clicked
        // footprint, or clear the selection when clicking empty space
        // (`$SELECT: 0,` with nothing after it).
        camera.setCurMousePosition(p.x, p.y);
        api.onSelect?.(clickSelectionParts(board, pickUnderMouse()));
      }
    }
    needsRender = true;
  };
  const onWheel = (e: WheelEvent): void => {
    if (cameraIsMoving) return;
    e.preventDefault();
    syncWindowSize();
    // Pick the modifier, if any. Shift beats control beats alt.
    const modifiers = e.shiftKey ? 'shift' : e.ctrlKey ? 'ctrl' : e.altKey ? 'alt' : '';
    const rotation = -e.deltaY || (e.deltaX ? -e.deltaX : 0);
    let deltaMove = DELTA_MOVE_STEP_FACTOR * camera.getZoom();
    if (rotation < 0) deltaMove = -deltaMove;
    let mouseActivity = false;
    // mousewheel_panning disabled (the default):
    //      wheel + shift   -> vertical scrolling;
    //      wheel + ctrl    -> horizontal scrolling;
    //      wheel           -> zooming.
    if (modifiers === 'shift') {
      camera.panBy([0, -deltaMove, 0]);
      mouseActivity = true;
    } else if (modifiers === 'ctrl') {
      camera.panBy([deltaMove, 0, 0]);
      mouseActivity = true;
    } else {
      mouseActivity = camera.zoomBy(rotation > 0 ? 1.1 : 1 / 1.1);
    }
    if (mouseActivity) {
      mouseIsMoving = true;
      mouseWasMoved = true;
      displayStatus();
      needsRender = true;
    }
    const p = nativePos(e);
    camera.setCurMousePosition(p.x, p.y);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- frame (EDA_3D_CANVAS::DoRePaint + RENDER_3D_OPENGL::Redraw) ---------
  const pushCameraToThree = (): void => {
    const view = camera.getViewMatrix();
    const proj = camera.getProjectionMatrix();
    threeCam.matrixWorldInverse.fromArray(view);
    threeCam.matrixWorld.fromArray(camera.getViewMatrixInv());
    threeCam.projectionMatrix.fromArray(proj);
    threeCam.projectionMatrixInverse.fromArray(camera.getProjectionMatrixInv());
    // Position the headlight: a point light at the camera, pushed out in z,
    // given in world space and carried into eye space by the view matrix.
    const hl = headlightPosition(camera.getPos());
    const eye = mat4TransformPoint(view, hl);
    lights.uHeadlightEye.value.set(eye[0], eye[1], eye[2]);
    gizmoLights.uHeadlightEye.value.set(eye[0], eye[1], eye[2]);
  };

  let raf = 0;
  let lastRenderMs = -1;
  const animate = (): void => {
    raf = requestAnimationFrame(animate);
    if (cameraIsMoving) {
      const curtimeDeltaS =
        ((performance.now() - strtimeCameraMovement) / 1000) * cameraMovingSpeed;
      camera.interpolate(curtimeDeltaS);
      if (curtimeDeltaS > 1.0) {
        cameraIsMoving = false;
        mouseWasMoved = true;
      }
      displayStatus();
      needsRender = true;
    }
    const changed = camera.takeParametersChanged();
    if (!needsRender && !changed) return;
    needsRender = false;
    const t0 = performance.now();
    pushCameraToThree();
    // Display transparent mask layers: the far one first
    const camAbove = camera.getPos()[2] > 0;
    for (const m of maskMeshes) {
      const far = m.layer === (camAbove ? 'B.Mask' : 'F.Mask');
      m.mesh.renderOrder = far ? RENDER_ORDER.maskFar : RENDER_ORDER.maskNear;
    }
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.render(bgScene, bgCam);
    renderer.render(scene, threeCam);
    // Render 3D arrows: a square viewport of H/8 at (4,4), depth cleared
    if (render.showNavigator !== false) {
      const rot = camera.getRotationMatrix();
      updateGizmo(rot);
      const view = mat4Multiply(
        mat4Translate(mat4Identity(), [0, 0, -(GIZMO_ARROW_SIZE * 2.75)]),
        rot,
      );
      gizmoCam.matrixWorldInverse.fromArray(view);
      gizmoCam.matrixWorld.fromArray(mat4Inverse(view));
      gizmoCam.projectionMatrix.fromArray(gizmoProj);
      gizmoCam.projectionMatrixInverse.fromArray(mat4Inverse(gizmoProj));
      const dpr = renderer.getPixelRatio();
      const small = Math.floor((h * dpr) / 8) / dpr;
      renderer.setViewport(4 / dpr, 4 / dpr, small, small);
      renderer.clearDepth();
      renderer.render(gizmoScene, gizmoCam);
      renderer.setViewport(0, 0, w, h);
    }
    const ms = performance.now() - t0;
    if (Math.abs(ms - lastRenderMs) >= 1) {
      lastRenderMs = ms;
      status = { ...status, activity: `Last render time ${ms.toFixed(0)} ms` };
      pushStatus();
    }
  };

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.setCurWindowSize(w, h);
    needsRender = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  /** `EDA_3D_CONTROLLER::RotateView`. */
  const rotate = (axis: Rotate3DAxis, cw: boolean): void => {
    const rotIncrement = (cameraOpts.rotationIncrement * Math.PI) / 180;
    switch (axis) {
      case 'x':
        camera.rotateX(cw ? -rotIncrement : rotIncrement);
        break;
      // Y rotations are backward b/c the RHR has Y pointing into the screen
      case 'y':
        camera.rotateY(cw ? rotIncrement : -rotIncrement);
        break;
      case 'z':
        camera.rotateZ(cw ? -rotIncrement : rotIncrement);
        break;
    }
    needsRender = true;
  };

  const MOVE_VIEW: Record<Move3DDir, View3dType> = {
    left: 'pan_left',
    right: 'pan_right',
    up: 'pan_up',
    down: 'pan_down',
  };

  const api: Viewer3D = {
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      disposeComponents();
      if (gridObj) {
        gridObj.geometry.dispose();
        (gridObj.material as THREE.Material).dispose();
      }
      for (const d of disposables) d.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
    zoomIn: () => void setView3D('zoom_in'),
    zoomOut: () => void setView3D('zoom_out'),
    zoomFit: () => void setView3D('fit_screen'),
    redraw: () => {
      needsRender = true;
    },
    setView: (dir: View3DDir) => void setView3D(dir),
    flip: () => void setView3D('flip'),
    home: () => void setView3D('fit_screen'),
    rotate,
    move: (dir: Move3DDir) => void setView3D(MOVE_VIEW[dir]),
    setOrtho: (on: boolean) => {
      camera.setProjection(on ? 'ortho' : 'perspective');
      // SetProjection does not rebuild; the next window-size push does.
      // ToggleProjection() rebuilds in place, so do the same.
      const { w, h } = camera.getWindowSize();
      camera.setCurWindowSize(0, 0);
      camera.setCurWindowSize(w, h);
      needsRender = true;
    },
    setGrid: (g) => {
      setGrid(g);
      needsRender = true;
    },
    setCamera,
    pivotCenter,
    setSelectedFootprints,
    getViewMatrix: () => Array.from(camera.getViewMatrix()),
    setViewMatrix: (m) => {
      camera.setViewMatrix(new Float64Array(m));
      displayStatus();
      needsRender = true;
    },
    snapshot: () =>
      new Promise<Blob | null>((resolve) => {
        // The drawing buffer is not preserved, so re-render in the same frame
        // as the read-back.
        needsRender = true;
        animate();
        cancelAnimationFrame(raf);
        canvas.toBlob((b) => resolve(b), 'image/png');
        raf = requestAnimationFrame(animate);
      }),
  };

  resize();
  displayStatus();
  animate();

  return api;
}
