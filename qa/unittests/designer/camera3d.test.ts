// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `TRACK_BALL` / `CAMERA` (common/gal/3d/camera.cpp, 3d-viewer/3d_rendering/
 * track_ball.cpp, trackball.cpp) — the 3D viewer's camera, pinned against
 * numbers worked from the C++ by hand, never from the port.
 */
import { describe, expect, it } from 'vitest';
import {
  DELTA_MOVE_STEP_FACTOR,
  INITIAL_CAMERA_DISTANCE,
  RANGE_SCALE_3D,
  TrackBallCamera,
  buildRotMatrix,
  mat4Inverse,
  mat4Multiply,
  mat4Perspective,
  mat4Rotate,
  mat4TransformPoint,
  quatFromMat4,
  trackball,
  type Mat4,
  type Vec3,
} from '@ziroeda/designer/src/editors/pcb/camera3d.js';

const near = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 4): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, digits);
};

const TAN225 = Math.tan((45 * Math.PI) / 360); // tan( fov / 2 ) = 0.414214

describe('the constants the frame builds the camera from', () => {
  it('sits the camera at 2 · RANGE_SCALE_3D, and the pan step is 0.7 · zoom', () => {
    // EDA_3D_VIEWER_FRAME::m_trackBallCamera( 2 * RANGE_SCALE_3D ), board_adapter.h:67,
    // hidpi_gl_3D_canvas.cpp:29
    expect(RANGE_SCALE_3D).toBe(8);
    expect(INITIAL_CAMERA_DISTANCE).toBe(16);
    expect(DELTA_MOVE_STEP_FACTOR).toBe(0.7);
  });
});

describe('CAMERA::Reset — the opening pose', () => {
  it('is the board straight below the camera, 16 units down, looking at the origin', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    // view = T(0,0,-16) · I · I · T(0): only the translation column is set
    const v = c.getViewMatrix();
    near(v, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -16, 1]);
    near(c.getPos(), [0, 0, 16]);
    near(c.getDir(), [0, 0, 1]); // m_dir is the inverse view's +Z, i.e. towards the camera
    near(c.getUp(), [0, 1, 0]);
    near(c.getRight(), [1, 0, 0]);
    expect(c.getZoom()).toBe(1);
    expect(c.getProjection()).toBe('perspective');
  });

  it('builds glm::perspective( 45°, w/h, 0.1, |init| · maxZoom · 2 )', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    const p = c.getProjectionMatrix();
    const f = 1 / TAN225; // 2.414214
    const far = 16 * 2.0 * 2; // 64
    expect(p[5]!).toBeCloseTo(f, 5);
    expect(p[0]!).toBeCloseTo(f / (800 / 600), 5);
    expect(p[10]!).toBeCloseTo(-(far + 0.1) / (far - 0.1), 6); // -1.003130
    expect(p[14]!).toBeCloseTo(-(2 * far * 0.1) / (far - 0.1), 6); // -0.200313
    expect(p[11]).toBe(-1);
    expect(c.frustum.nearD).toBe(0.1);
    expect(c.frustum.farD).toBe(64);
    // nh = 2 · near · tan, nw = nh · ratio
    expect(c.frustum.nh).toBeCloseTo(2 * 0.1 * TAN225, 6);
    expect(c.frustum.nw).toBeCloseTo(2 * 0.1 * TAN225 * (800 / 600), 6);
  });

  it('frames the board so its larger side fills 96.6% of the height at zoom 1', () => {
    // A board view scales its larger side to RANGE_SCALE_3D · 1.6 = 12.8 units
    // (board_adapter.cpp:272-275); the frustum at 16 units is 2·16·tan(22.5°)
    // = 13.255 high. That ratio is the "home" framing the screenshot shows.
    const visible = 2 * 16 * TAN225;
    expect((RANGE_SCALE_3D * 1.6) / visible).toBeCloseTo(0.9657, 3);
  });
});

describe('CAMERA::Zoom — a divisor on the distance, clamped to [0.02, 2]', () => {
  it('divides m_zoom and m_camera_pos.z by the factor; the status shows 1/zoom', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    expect(c.zoomBy(1.1)).toBe(true);
    expect(c.getZoom()).toBeCloseTo(1 / 1.1, 9);
    expect(c.getCameraPos()[2]).toBeCloseTo(-16 / 1.1, 9);
    expect(1 / c.getZoom()).toBeCloseTo(1.1, 9);
  });

  it('stops at DEFAULT_MAX_ZOOM = 2 (32 units) and DEFAULT_MIN_ZOOM = 0.02 (0.32 units)', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    for (let i = 0; i < 60; i++) c.zoomBy(1 / 1.1);
    expect(c.getZoom()).toBe(2);
    expect(c.getCameraPos()[2]).toBeCloseTo(-32, 6);
    expect(c.zoomBy(1 / 1.1)).toBe(false); // already at the limit
    expect(c.zoomBy(1.1)).toBe(true);
    for (let i = 0; i < 200; i++) c.zoomBy(1.1);
    expect(c.getZoom()).toBeCloseTo(0.02, 9);
    expect(c.getCameraPos()[2]).toBeCloseTo(-0.32, 6);
    expect(c.zoomBy(1.1)).toBe(false);
    expect(c.zoomBy(1)).toBe(false); // a unit factor is a no-op
  });

  it('keeps the ortho frustum the size of the perspective view plane at the board', () => {
    // orthoReductionFactor = |init| · zoom · tan( 22.5° ), symmetrical ±far clip.
    const c = new TrackBallCamera(16, 'ortho');
    c.setCurWindowSize(800, 600);
    const orf = 16 * 1 * TAN225; // 6.6274
    const p = c.getProjectionMatrix();
    expect(p[0]!).toBeCloseTo(2 / (2 * orf * (800 / 600)), 6);
    expect(p[5]!).toBeCloseTo(2 / (2 * orf), 6);
    expect(p[10]!).toBeCloseTo(-2 / 128, 9); // near -64, far 64
    expect(c.frustum.nearD).toBe(-64);
    expect(c.frustum.nh).toBeCloseTo(2 * orf, 6);
  });
});

describe('TRACK_BALL::Drag — the SGI trackball', () => {
  it('trackball(): a 0.2 drag from the centre is a 0.2527 rad spin about −Y', () => {
    // p1 = (0,0,0.8), p2 = (0.2, 0, √(0.64−0.04) = 0.7746): a = p2 × p1 =
    // (0, −0.16, 0); |p1−p2| = 0.20161; t = 0.20161 / 1.6; φ = 2·asin(t).
    const q = trackball(0, 0, 0.2, 0);
    const phi = 2 * Math.asin(Math.hypot(0.2, 0, 0.8 - Math.sqrt(0.6)) / 1.6);
    expect(phi).toBeCloseTo(0.25268, 4);
    near(q, [0, -Math.sin(phi / 2), 0, Math.cos(phi / 2)], 6);
    near(trackball(0.3, -0.1, 0.3, -0.1), [0, 0, 0, 1], 9); // no motion, no spin
  });

  it('build_rotmatrix lands m[i][j] in column i, the way glm::make_mat4 reads it', () => {
    const q = trackball(0, 0, 0.2, 0);
    const m = buildRotMatrix(q);
    const c = Math.cos(0.25268),
      s = Math.sin(0.25268);
    // A rotation about −Y by φ: column 0 = (cos, 0, −sin), column 2 = (sin, 0, cos)
    expect(m[0]!).toBeCloseTo(c, 4);
    expect(m[2]!).toBeCloseTo(-s, 4);
    expect(m[8]!).toBeCloseTo(s, 4);
    expect(m[10]!).toBeCloseTo(c, 4);
  });

  it('turns the board so the surface under the cursor follows the mouse', () => {
    const cam = new TrackBallCamera();
    cam.setCurWindowSize(800, 600);
    cam.setCurMousePosition(400, 300);
    cam.drag(480, 300); // 80 px right of centre = +0.2 in trackball space
    // the board's top-surface point (0,0,0.8) moves towards +x on screen
    const p = mat4TransformPoint(cam.getViewMatrix(), [0, 0, 0.8]);
    expect(p[0]).toBeGreaterThan(0.19);
    expect(p[0]).toBeLessThan(0.21);
    // and the camera's world position swung the other way, staying 16 away
    const pos = cam.getPos();
    expect(Math.hypot(...pos)).toBeCloseTo(16, 5);
    expect(pos[0]).toBeLessThan(-3.9);
  });
});

describe('TRACK_BALL::Pan', () => {
  it('perspective: unprojects the drag through −z · tan · 2 at the current zoom', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setCurMousePosition(100, 100);
    c.pan(150, 130);
    const panFactor = 16 * TAN225 * 2; // 13.2548
    const dx = (panFactor * (800 / 600) * (100 - 150)) / 800; // −1.10457
    const dy = (panFactor * (130 - 100)) / 600; // 0.66274
    near(c.getCameraPos(), [-dx, -dy, -16], 5);
  });

  it('ortho: uses the frustum width/height directly', () => {
    const c = new TrackBallCamera(16, 'ortho');
    c.setCurWindowSize(800, 600);
    c.setCurMousePosition(0, 0);
    c.pan(800, 0); // a full-width drag pans a full frustum width
    expect(c.getCameraPos()[0]).toBeCloseTo(c.frustum.nw, 6);
  });

  it('Pan( SFVEC3F ) is a plain offset — the wheel-with-shift path', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.panBy([0, -0.7, 0]);
    near(c.getCameraPos(), [0, -0.7, -16], 9);
  });
});

describe('CAMERA::ViewCommand_T1 + Interpolate', () => {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const rotX = ([x, y, z]: Vec3, t: number): Vec3 => [
    x,
    y * Math.cos(t) - z * Math.sin(t),
    y * Math.sin(t) + z * Math.cos(t),
  ];
  const rotY = ([x, y, z]: Vec3, t: number): Vec3 => [
    x * Math.cos(t) + z * Math.sin(t),
    y,
    -x * Math.sin(t) + z * Math.cos(t),
  ];
  const rotZ = ([x, y, z]: Vec3, t: number): Vec3 => [
    x * Math.cos(t) - y * Math.sin(t),
    x * Math.sin(t) + y * Math.cos(t),
    z,
  ];
  /** Aux⁻¹·v with Aux = Rx(ax)·Ry(ay)·Rz(az) (camera.cpp updateRotationMatrix). */
  const auxInv = (v: Vec3, [ax, ay, az]: [number, number, number]): Vec3 =>
    rotZ(rotY(rotX(v, rad(-ax)), rad(-ay)), rad(-az));

  /** m_rotate_aux_t1 after each branch, degrees. */
  const AUX: Record<string, [number, number, number]> = {
    top: [0, 0, 0],
    bottom: [0, 179.999, 0],
    front: [-90, 0, 0],
    back: [-90, 0, 179.999],
    right: [-90, 0, -90],
    left: [-90, 0, 90],
  };

  for (const [view, aux] of Object.entries(AUX)) {
    it(`${view}: after the animation the camera looks along Aux⁻¹·(0,0,1) from 16 units`, () => {
      const c = new TrackBallCamera();
      c.setCurWindowSize(800, 600);
      c.setT0AndT1CurrentT();
      c.viewCommandT1(view as 'top');
      c.interpolate(1);
      near(c.getDir(), auxInv([0, 0, 1], aux), 3);
      near(c.getUp(), auxInv([0, 1, 0], aux), 3);
      const d = auxInv([0, 0, 1], aux);
      near(c.getPos(), [d[0] * 16, d[1] * 16, d[2] * 16], 3);
    });
  }

  it('front looks at the board from −Y, right from +X', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setT0AndT1CurrentT();
    c.viewCommandT1('front');
    c.interpolate(1);
    near(c.getPos(), [0, -16, 0], 3);
    const r = new TrackBallCamera();
    r.setCurWindowSize(800, 600);
    r.setT0AndT1CurrentT();
    r.viewCommandT1('right');
    r.interpolate(1);
    near(r.getPos(), [16, 0, 0], 3);
  });

  it('Zoom_T1 + Interpolate(0.5) is halfway along the Bezier-blended zoom', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setT0AndT1CurrentT();
    expect(c.zoomT1By(1.26)).toBe(true);
    c.interpolate(0.5); // BezierBlend( 0.5 ) = 0.5·0.5·(3 − 1) = 0.5
    const z1 = 1 / 1.26;
    expect(c.getZoom()).toBeCloseTo(0.5 + 0.5 * z1, 6);
    expect(c.getCameraPos()[2]).toBeCloseTo(-16 * (0.5 + 0.5 * z1), 5);
    c.interpolate(1);
    expect(c.getZoom()).toBeCloseTo(z1, 9);
    c.interpolate(7); // clamped to 1
    expect(c.getZoom()).toBeCloseTo(z1, 9);
  });

  it('Interpolate() with the linear mode moves a pan target at a constant rate', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setInterpolateMode('linear');
    c.setT0AndT1CurrentT();
    c.panT1By([0.7, 0, 0]);
    c.interpolate(0.25);
    expect(c.getCameraPos()[0]).toBeCloseTo(0.175, 9);
  });

  it('Reset_T1 unwinds an aux angle past π the short way round', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setT0AndT1CurrentT();
    c.viewCommandT1('bottom'); // aux.y → 179.999°, normalised to 2π − … after interpolate
    c.interpolate(1);
    c.setT0AndT1CurrentT();
    c.viewCommandT1('top'); // Reset_T1: aux_t0.y > π, so t1.y = 2π, not 0
    c.interpolate(0.5);
    // halfway between 3.1416 (≈179.999° normalised to 2π−ε… i.e. just under) and 2π
    // the camera is on its way through the SIDE, not spinning the long way back:
    // dir.z stays near 0 at the midpoint rather than flipping through −1.
    expect(Math.abs(c.getDir()[2])).toBeLessThan(0.05);
  });

  it('SetT0_and_T1_current_T charges the quaternion from the mouse spin, so a view command continues from it', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setCurMousePosition(400, 300);
    c.drag(480, 300);
    const spun = c.getViewMatrix().slice();
    c.setT0AndT1CurrentT();
    c.interpolate(0); // t = 0 reproduces the current spin exactly
    near(c.getViewMatrix(), spun, 6);
  });
});

describe('the flip and the rotate keys', () => {
  it('rotateZ turns the world about Z by the increment', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.rotateZ(Math.PI / 2);
    const p = mat4TransformPoint(c.getViewMatrix(), [1, 0, 0]);
    near(p, [0, 1, -16], 6);
  });

  it('flip is a 179.999° turn about Y — the board seen from below, X mirrored', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    c.setT0AndT1CurrentT();
    c.viewCommandT1('flip');
    c.interpolate(1);
    near(c.getPos(), [0, 0, -16], 2);
    const p = mat4TransformPoint(c.getViewMatrix(), [1, 0, 0]);
    expect(p[0]).toBeCloseTo(-1, 3);
  });
});

describe('MakeRay', () => {
  it('shoots the centre pixel straight down the view axis, perspective and ortho', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    const r = c.makeRay(400, 300);
    // pixel CENTRES: (400 + 0.5) / 800 → ndc 0.00125, so the ray leans by
    // half a pixel's worth of the near plane — MakeRay's `+ 0.5f`.
    const ox = (c.frustum.nw / 2) * (2 * (400.5 / 800) - 1);
    const oy = (c.frustum.nh / 2) * (2 * (300.5 / 600) - 1);
    near(r.origin, [ox, oy, 15.9], 6); // the near-plane centre is 0.1 in front of the camera
    const len = Math.hypot(ox, oy, -0.1);
    near(r.dir, [ox / len, oy / len, -0.1 / len], 6);
    const o = new TrackBallCamera(16, 'ortho');
    o.setCurWindowSize(800, 600);
    const ro = o.makeRay(400, 300);
    near(ro.dir, [0, 0, -1], 3);
  });

  it('a pixel at the right edge leaves along +x by the frustum half-width', () => {
    const c = new TrackBallCamera();
    c.setCurWindowSize(800, 600);
    const r = c.makeRay(799, 300);
    expect(r.origin[0]).toBeCloseTo((c.frustum.nw / 2) * (2 * (799.5 / 800) - 1), 6);
  });
});

describe('the mat4 helpers behave like glm', () => {
  it('inverse · M = I and rotate composes on the right', () => {
    const m = mat4Rotate(mat4Perspective(1, 1.5, 0.1, 64), 0.7, [0.3, 0.4, 0.5]);
    const id = mat4Multiply(mat4Inverse(m), m);
    for (let i = 0; i < 16; i++) expect(id[i]!).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
    // glm::rotate( M, a, axis ) = M · R: the rotation acts on the vector first
    const rz = mat4Rotate(
      new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]),
      Math.PI / 2,
      [0, 0, 1],
    );
    near(mat4TransformPoint(rz, [1, 0, 0]), [5, 1, 0], 9);
  });

  it('quat_cast round-trips a trackball spin through mat4_cast', () => {
    const q = trackball(-0.1, 0.3, 0.2, 0.05);
    const m: Mat4 = buildRotMatrix(q);
    const back = quatFromMat4(m);
    // build_rotmatrix is the transpose of glm's mat4_cast layout, so the
    // recovered quaternion is the conjugate — which is exactly why
    // TRACK_BALL::SetT0_and_T1_current_T conjugates it.
    near(back, [-q[0], -q[1], -q[2], q[3]], 6);
  });
});
