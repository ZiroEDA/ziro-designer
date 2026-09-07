// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * 3D board viewer on three.js.
 *
 * The board is real geometry (KiCad create_scene.cpp approach): the Edge.Cuts
 * outline extruded to thickness, with each layer, FR4 body, copper (faint under
 * the mask), soldermask (translucent), exposed copper (gold), silkscreen, and
 * plated hole barrels, as its own triangle mesh stacked just off the face. All
 * geometry comes from boardGeom.ts/boardOutline.ts (see buildBoardGeom); this
 * file only turns those meshes into three.js meshes + materials, lights, and a
 * KiCad-style trackball camera. Component 3D models are added on top of this.
 */
import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from './renderBoard.js';
import { buildBoardOutline } from './boardOutline.js';
import { buildBoardGeom, boardHoles, type Mesh } from './boardGeom.js';
import { mountComponents, type ProjectFile } from './component3d.js';
import type { Board } from '@ziroeda/pcbnew';
import { MODELS3D_HOST } from '../../libraryHosts.js';
import {
  VIEW3D_CAMERA,
  type Viewer3dCameraOptions,
  type Viewer3dRenderOptions,
} from './viewer3d_types.js';
import type { Color4d } from '@ziroeda/common/src/color4d.js';
import {
  DEFAULT_SILKSCREEN,
  DEFAULT_SOLDERMASK,
  type StackupColors,
} from './board_adapter_colors.js';
import type {
  View3DDir,
  Rotate3DAxis,
  Move3DDir,
  Grid3D,
  Viewer3DStatus,
  Viewer3D,
} from './viewer3d_types.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)
// Where the 3D model library is hosted. Defaults to the bundled demo set;
// point VITE_MODELS3D_URL at the hosted library (Cloudflare R2 / jsDelivr) to
// cover all boards. See the ziro-3d-components-plan memory.
const MODELS3D_BASE = MODELS3D_HOST;

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The physical board extent = the Edge.Cuts outline, NOT the item bounding box
 * (which includes off-board documentation like the stackup table). Falls back to
 * the full scene bbox if no edge exists.
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

// The plain data types live in viewer3d_types.ts so the menu inventory can
// reach them without resolving this module's three.js / occt-import-js chain.
// Re-exported here so every existing importer keeps working.
// `Viewer3D` moved there too: it is a plain method interface with no three.js
// in it, and leaving it here forced anything that merely holds a handle to the
// viewer to typecheck this module's occt-import-js chain. qa cannot -- there
// are no types for occt-import-js and `?url` is a Vite import -- so the CVPCB
// viewer's test broke the workspace typecheck the moment it reached a file
// that named the type.
export type { View3DDir, Rotate3DAxis, Move3DDir, Grid3D, Viewer3DStatus, Viewer3D };

// A geometry group: interleaved [x,y,z, nx,ny,nz] verts + triangle indices.
interface Group {
  verts: number[];
  idx: number[];
}

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
  render: Viewer3dRenderOptions = {},
): Viewer3D | null {
  const scene2d = buildScene(board);
  if (!scene2d.bbox) return null;
  const box = edgeBBox(board, scene2d.bbox);
  const bw = (box.maxX - box.minX) / MM; // mm
  const bh = (box.maxY - box.minY) / MM;
  const th = (board.thickness ?? 1.6 * MM) / MM;
  const hz = th / 2;
  const half = Math.max(bw, bh) / 2;

  // ---- geometry (reused from the board renderer) ---------------------------
  const holes = boardHoles(board, box);
  const outline = buildBoardOutline(board, box, holes);
  const geom = buildBoardGeom(board, box, { showZones: render.showZones !== false });
  const outlineMesh: Mesh = { verts: outline.verts, tris: outline.tris };

  const mkGroup = (): Group => ({ verts: [], idx: [] });
  const addFlat = (g: Group, mesh: Mesh, z: number, nz: number): void => {
    const base = g.verts.length / 6;
    for (const p of mesh.verts) g.verts.push(p.x, p.y, z, 0, 0, nz);
    for (const t of mesh.tris) g.idx.push(base + t);
  };

  // Stack heights just off each face (mm): FR4 body → copper → mask → pads → silk.
  const zB = hz,
    zC = hz + 0.03,
    zM = hz + 0.06,
    zP = hz + 0.09,
    zS = hz + 0.12;
  const gBody = mkGroup(),
    gCopper = mkGroup(),
    gMask = mkGroup(),
    gGold = mkGroup(),
    gSilk = mkGroup(),
    gWall = mkGroup(),
    gHole = mkGroup();

  addFlat(gBody, outlineMesh, zB, 1);
  addFlat(gBody, outlineMesh, -zB, -1);
  addFlat(gCopper, geom.front.copper, zC, 1);
  addFlat(gCopper, geom.back.copper, -zC, -1);
  addFlat(gMask, outlineMesh, zM, 1);
  addFlat(gMask, outlineMesh, -zM, -1);
  addFlat(gGold, geom.front.pads, zP, 1);
  addFlat(gGold, geom.back.pads, -zP, -1);
  addFlat(gSilk, geom.front.silk, zS, 1);
  addFlat(gSilk, geom.back.silk, -zS, -1);

  // Extruded FR4 walls along every outline loop (outer boundary + cutouts).
  for (const loop of outline.loops) {
    for (let i = 0; i < loop.length; i++) {
      const p0 = loop[i]!,
        p1 = loop[(i + 1) % loop.length]!;
      const dx = p1.x - p0.x,
        dy = p1.y - p0.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = dy / L,
        ny = -dx / L;
      const b = gWall.verts.length / 6;
      gWall.verts.push(
        p0.x,
        p0.y,
        hz,
        nx,
        ny,
        0,
        p1.x,
        p1.y,
        hz,
        nx,
        ny,
        0,
        p1.x,
        p1.y,
        -hz,
        nx,
        ny,
        0,
        p0.x,
        p0.y,
        -hz,
        nx,
        ny,
        0,
      );
      gWall.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  // Plated hole barrels (gold) lining the drilled voids.
  const zBar = zS + 0.01;
  for (const h of holes) {
    const n = Math.max(10, Math.min(48, Math.round(h.r * 120)));
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n,
        a1 = (2 * Math.PI * (i + 1)) / n;
      const x0 = h.x + h.r * Math.cos(a0),
        y0 = h.y + h.r * Math.sin(a0);
      const x1 = h.x + h.r * Math.cos(a1),
        y1 = h.y + h.r * Math.sin(a1);
      const b = gHole.verts.length / 6;
      gHole.verts.push(
        x0,
        y0,
        zBar,
        -Math.cos(a0),
        -Math.sin(a0),
        0,
        x1,
        y1,
        zBar,
        -Math.cos(a1),
        -Math.sin(a1),
        0,
        x1,
        y1,
        -zBar,
        -Math.cos(a1),
        -Math.sin(a1),
        0,
        x0,
        y0,
        -zBar,
        -Math.cos(a0),
        -Math.sin(a0),
        0,
      );
      gHole.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  // ---- three.js scene ------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  // KiCad's 3D background: a vertical light→medium blue-grey gradient. The
  // renderer clears transparent so this CSS gradient shows around the board.
  canvas.style.background = 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)';
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // `render.opengl_AA_mode` — `ANTIALIASING_MODE::AA_NONE` is 0 and the
      // rest are on. WebGL takes a BOOLEAN and picks the sample count itself,
      // which is why the four-row choice collapses to this one flag; the
      // tooltip's "3D-Viewer must be closed and re-opened to apply this
      // setting" is true here for the same reason it is there — a context is
      // created once.
      antialias: render.antiAliasing !== 0,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
  } catch {
    container.removeChild(canvas);
    return null;
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  // A soft indoor environment so the PBR metals (copper/gold) catch light
  // instead of reflecting black, but keep it subtle so it doesn't wash the
  // board out (the env alone at full strength made it pale).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;

  const disposables: { dispose(): void }[] = [];
  const toGeom = (g: Group): THREE.BufferGeometry => {
    const nVerts = g.verts.length / 6;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts; i++) {
      pos[i * 3] = g.verts[i * 6]!;
      pos[i * 3 + 1] = g.verts[i * 6 + 1]!;
      pos[i * 3 + 2] = g.verts[i * 6 + 2]!;
      nrm[i * 3] = g.verts[i * 6 + 3]!;
      nrm[i * 3 + 1] = g.verts[i * 6 + 4]!;
      nrm[i * 3 + 2] = g.verts[i * 6 + 5]!;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    bg.setIndex(new THREE.Uint32BufferAttribute(g.idx, 1));
    disposables.push(bg);
    return bg;
  };
  const mat = (
    hex: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      color: hex,
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.1,
      ...opts,
    });
    disposables.push(m);
    return m;
  };
  // `BOARD_ADAPTER`'s colours. Where the stackup names one, it wins — that is
  // `GetLayerColors()`'s `m_UseStackupColors` block; where it does not, these
  // fall back to the same `g_Default*` values upstream uses. The literals that
  // used to be here answered the Color column with nothing at all.
  const rgb = (c: Color4d): number =>
    (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
  const maskTop = stackup?.maskTop ?? DEFAULT_SOLDERMASK;
  const silkTop = stackup?.silkTop ?? DEFAULT_SILKSCREEN;
  /**
   * `MATERIAL_MODE` (`3d-viewer/3d_enums.h`), the General page's Material
   * properties:
   *
   *   NORMAL       the board's own materials, shaded — our PBR defaults
   *   DIFFUSE_ONLY every material flat and unshaded ("Solid colors")
   *   CAD_MODE     a fixed CAD-like set, also unshaded ("CAD colors")
   *
   * `C3D_RENDER_OGL_LEGACY` reads it when it builds each material
   * (`3d-viewer/3d_rendering/opengl/…`): the two non-NORMAL modes drop the
   * specular term, which here is metalness and roughness.
   */
  const flatMaterials = (render.materialMode ?? 0) !== 0;
  const shade = (
    o: Partial<THREE.MeshStandardMaterialParameters>,
  ): Partial<THREE.MeshStandardMaterialParameters> =>
    flatMaterials ? { ...o, metalness: 0, roughness: 1 } : o;
  const M = {
    fr4: mat(stackup?.body ? rgb(stackup.body) : 0x8a6b3d, shade({})),
    copper: mat(
      stackup?.copper ? rgb(stackup.copper) : 0xbf9c3a,
      shade({
        metalness: 0.35,
        roughness: 0.5,
      }),
    ),
    // The mask's alpha is the stackup's own (0.83 for every entry in
    // `g_MaskColors`), not a fixed 0.85.
    mask: mat(rgb(maskTop), {
      transparent: true,
      opacity: maskTop.a,
      depthWrite: false,
    }),
    gold: mat(0xd9ad4d, shade({ metalness: 0.4, roughness: 0.45 })),
    silk: mat(rgb(silkTop), shade({})),
    barrel: mat(0xb88f42, shade({ metalness: 0.5, roughness: 0.4 })),
  };
  const add = (g: Group, m: THREE.Material): void => {
    if (g.idx.length) scene.add(new THREE.Mesh(toGeom(g), m));
  };
  add(gWall, M.fr4);
  add(gBody, M.fr4);
  add(gCopper, M.copper);
  add(gGold, M.gold);
  add(gSilk, M.silk);
  add(gHole, M.barrel);
  add(gMask, M.mask); // translucent last

  // Lighting: soft hemispheric ambient + a headlight that follows the camera
  // (KiCad's key light tracks the viewer), so the visible side is always lit.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556, 0.5));
  const headlight = new THREE.DirectionalLight(0xffffff, 1.35);
  scene.add(headlight);

  // Footprint 3D models (loaded async from the hosted library / project files).
  const disposeComponents = mountComponents(
    scene,
    board,
    box,
    hz,
    MODELS3D_BASE,
    projectFiles,
    undefined,
    render.showModelBbox === true,
  );

  // ---- 3D grid -------------------------------------------------------------
  // EDA_3D_ACTIONS::noGrid / show{10,5,2_5,1}mmGrid. KiCad draws it on the
  // board plane; ours sits just under the bottom face so it never z-fights.
  const GRID_MM: Record<Grid3D, number> = {
    none: 0,
    '10mm': 10,
    '5mm': 5,
    '2.5mm': 2.5,
    '1mm': 1,
  };
  let gridHelper: THREE.GridHelper | null = null;
  const setGrid = (grid: Grid3D): void => {
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();
      gridHelper = null;
    }
    const step = GRID_MM[grid];
    if (!step) return;
    // Cover the board with a margin, rounded out to a whole number of steps.
    const extent = Math.ceil((Math.max(bw, bh) * 1.5) / step) * step;
    gridHelper = new THREE.GridHelper(extent, Math.round(extent / step), 0x6f6f80, 0x50505c);
    // GridHelper lies in XZ; the board is in XY, so stand it up.
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -hz - 0.01;
    scene.add(gridHelper);
  };

  // ---- camera + KiCad-style trackball --------------------------------------
  const NEAR = Math.max(0.05, half * 0.02);
  const FAR = half * 200;
  const FOV = 45;
  const persp = new THREE.PerspectiveCamera(FOV, 1, NEAR, FAR);
  const ortho = new THREE.OrthographicCamera(-half, half, half, -half, NEAR, FAR);
  // Open looking down onto the top side, tilted so the edges/thickness read.
  const HOME_POS = new THREE.Vector3(half * 0.35, -half * 1.5, half * 2.2);
  const HOME_UP = new THREE.Vector3(0, 1, 0);
  persp.position.copy(HOME_POS);
  persp.up.copy(HOME_UP);

  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp;
  let controls = new TrackballControls(camera, canvas);
  const initControls = (c: TrackballControls): void => {
    c.rotateSpeed = 3.2;
    c.zoomSpeed = 1.3;
    c.panSpeed = 0.8;
    c.staticMoving = true; // no inertia, precise, KiCad-like
    c.minDistance = half * 0.4;
    c.maxDistance = half * 20;
    c.target.set(0, 0, 0);
  };
  initControls(controls);

  /** Distance from the camera to the orbit target — KiCad's zoom is 1/this. */
  const dist = (): number => camera.position.distanceTo(controls.target);
  /** The home distance, i.e. what KiCad calls zoom == 1.0 (fit). */
  const HOME_DIST = HOME_POS.length();

  // ---- view commands -------------------------------------------------------
  // The six axis-aligned poses live in viewer3d_types.ts as plain triples, so
  // the derivation from CAMERA::ViewCommand_T1 is pinned by a test instead of
  // buried in this closure. Stated as camera placements rather than replayed
  // as board rotations, which survives an arbitrary starting orientation
  // without the epsilon upstream uses to dodge a full 360.
  const setView = (dir: View3DDir): void => {
    const v = VIEW3D_CAMERA[dir];
    const d = dist();
    camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(...v.eye), d);
    camera.up.set(...v.up);
    camera.lookAt(controls.target);
  };

  /** Rotate the camera about a world axis through the orbit target. */
  const orbit = (axis: THREE.Vector3, rad: number): void => {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, rad);
    const off = camera.position.clone().sub(controls.target).applyQuaternion(q);
    camera.position.copy(controls.target).add(off);
    camera.up.applyQuaternion(q);
    camera.lookAt(controls.target);
  };

  const AXES: Record<Rotate3DAxis, THREE.Vector3> = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  };

  /**
   * `EDA_3D_VIEWER_SETTINGS::m_Camera` — Preferences > 3D Viewer > General's
   * Camera Options.
   *
   * A live value rather than a mount-time one: `EDA_3D_CANVAS` re-reads it on
   * `CommonSettingsChanged`, and rebuilding the whole scene to change a
   * rotation step would re-tessellate every STEP model.
   */
  const cameraOpts: Viewer3dCameraOptions = {
    rotationIncrement: 10,
    animationEnabled: true,
    movingSpeedMultiplier: 3,
  };

  const setCamera = (o: Partial<Viewer3dCameraOptions>): void => {
    Object.assign(cameraOpts, o);
  };

  const rotate = (axis: Rotate3DAxis, cw: boolean): void => {
    // EDA_3D_CONTROLLER::RotateView signs. Y is inverted relative to X and Z
    // upstream (X_CW rotates by -inc but Y_CW by +inc); mirrored verbatim.
    const inc = THREE.MathUtils.degToRad(cameraOpts.rotationIncrement);
    const board = axis === 'y' ? (cw ? inc : -inc) : cw ? -inc : inc;
    // Upstream turns the board; turning the camera the other way is the same
    // picture.
    orbit(AXES[axis], -board);
  };

  const zoomBy = (factor: number): void => {
    const off = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(off.length() / factor, half * 0.4, half * 20);
    camera.position.copy(controls.target).addScaledVector(off.normalize(), len);
    if (camera instanceof THREE.OrthographicCamera) syncOrtho();
  };

  const home = (): void => {
    controls.target.set(0, 0, 0);
    camera.position.copy(HOME_POS);
    camera.up.copy(HOME_UP);
    camera.lookAt(controls.target);
    if (camera instanceof THREE.OrthographicCamera) syncOrtho();
  };

  /**
   * `VIEW3D_PAN_*`: `delta_move = m_delta_move_step_factor * zoom` with the
   * factor at 0.7 (common/gal/hidpi_gl_3D_canvas.cpp:25). Ours is 0.7 of the
   * *view height* at the target, so a step covers the same fraction of the
   * screen whatever the board's size.
   */
  const MOVE_STEP_FACTOR = 0.7;
  const move = (dir: Move3DDir): void => {
    const viewH = 2 * dist() * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const step = viewH * MOVE_STEP_FACTOR * 0.25;
    const fwd = controls.target.clone().sub(camera.position).normalize();
    const rightV = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const upV = camera.up.clone().normalize();
    const d = new THREE.Vector3();
    if (dir === 'left') d.addScaledVector(rightV, -step);
    if (dir === 'right') d.addScaledVector(rightV, step);
    if (dir === 'up') d.addScaledVector(upV, step);
    if (dir === 'down') d.addScaledVector(upV, -step);
    camera.position.add(d);
    controls.target.add(d);
  };

  /** Size the ortho frustum to match what the perspective camera would show. */
  function syncOrtho(): void {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const h = dist() * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const w = h * (Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
    camera.left = -w;
    camera.right = w;
    camera.top = h;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }

  const setOrtho = (on: boolean): void => {
    const want = on ? ortho : persp;
    if (want === camera) return;
    want.position.copy(camera.position);
    want.up.copy(camera.up);
    const target = controls.target.clone();
    camera = want;
    camera.lookAt(target);
    // TrackballControls binds one camera at construction, so swapping the
    // projection means rebuilding it.
    controls.dispose();
    controls = new TrackballControls(camera, canvas);
    initControls(controls);
    controls.target.copy(target);
    syncOrtho();
  };

  // ---- status bar feed -----------------------------------------------------
  // X_POS / Y_POS are the board point under the pointer: the ray through the
  // cursor intersected with the board's top plane.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hz);
  const hit = new THREE.Vector3();
  let status: Viewer3DStatus = { x: null, y: null, zoom: 1 };

  const pushStatus = (): void => {
    api.onStatus?.(status);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const p = ray.ray.intersectPlane(boardPlane, hit);
    // Board space is centred on the outline bbox; report KiCad board mm.
    status = p
      ? { ...status, x: p.x + (box.minX / MM + bw / 2), y: -(p.y - (box.minY / MM + bh / 2)) }
      : { ...status, x: null, y: null };
    pushStatus();
  };
  const onPointerLeave = (): void => {
    status = { ...status, x: null, y: null };
    pushStatus();
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);

  let raf = 0;
  let lastZoom = -1;
  const animate = (): void => {
    raf = requestAnimationFrame(animate);
    controls.update();
    headlight.position.copy(camera.position); // headlight follows the camera
    renderer.render(scene, camera);
    // ZOOM_LEVEL: KiCad's camera zoom, 1.0 at fit.
    const z = HOME_DIST / Math.max(1e-6, dist());
    if (Math.abs(z - lastZoom) > 1e-3) {
      lastZoom = z;
      status = { ...status, zoom: z };
      pushStatus();
    }
  };

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    } else {
      syncOrtho();
    }
    controls.handleResize();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const api: Viewer3D = {
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      disposeComponents();
      controls.dispose();
      if (gridHelper) {
        gridHelper.geometry.dispose();
        (gridHelper.material as THREE.Material).dispose();
      }
      for (const d of disposables) d.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
    },
    // 1.26x == three steps per doubling (EDA_3D_CANVAS::SetView3D).
    zoomIn: () => zoomBy(1.26),
    zoomOut: () => zoomBy(1 / 1.26),
    zoomFit: home,
    redraw: () => renderer.render(scene, camera),
    setView,
    // VIEW3D_FLIP is a 180 deg turn about Y.
    flip: () => orbit(AXES.y, Math.PI),
    home,
    rotate,
    move,
    setOrtho,
    setGrid,
    setCamera,
    snapshot: () =>
      new Promise<Blob | null>((resolve) => {
        // The drawing buffer is not preserved, so re-render in the same frame
        // as the read-back.
        renderer.render(scene, camera);
        canvas.toBlob((b) => resolve(b), 'image/png');
      }),
  };

  // After `api` exists: the first animate() frame pushes a status update
  // through it.
  resize();
  animate();

  return api;
}
