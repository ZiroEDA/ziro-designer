// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CAMERA` + `TRACK_BALL` (`common/gal/3d/camera.cpp`,
 * `3d-viewer/3d_rendering/track_ball.cpp`) and the SGI trackball it spins on
 * (`3d-viewer/3d_rendering/trackball.cpp`), ported whole.
 *
 * The camera is NOT an orbit camera. Its view matrix is
 *
 *     T(m_camera_pos) · R · Raux · T(-m_lookat_pos)
 *
 * with the camera fixed on the view-space -Z axis at `-initialDistance · zoom`
 * and the BOARD rotated in front of it by `R` (the mouse trackball) and `Raux`
 * (the animated axis-aligned view commands). Zoom is a divisor on that
 * distance, clamped to `[0.02, 2.0]`; the status bar's `zoom %3.2f` is its
 * reciprocal. Pan moves `m_camera_pos.xy`, which the status bar reports as
 * `dx`/`dy`. Every view command is a T0→T1 interpolation that
 * `EDA_3D_CANVAS::DoRePaint` steps by wall-clock time.
 *
 * Matrices are column-major `Float64Array(16)` in glm/three.js layout, so
 * `glm::rotate( M, a, axis )` is `M · R` and `glm::translate( M, v )` is
 * `M · T`, exactly as the C++ composes them. No three.js here: this is pure
 * math so qa can pin it.
 */

export type Vec3 = [number, number, number];
export type Mat4 = Float64Array;
export type Quat = [number, number, number, number]; // x, y, z, w — the trackball's layout

export type ProjectionType = 'ortho' | 'perspective';
export type CameraInterpolation = 'linear' | 'easing_in_out' | 'bezier';
export type View3dType =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'front'
  | 'back'
  | 'flip'
  | 'fit_screen'
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'pan_up'
  | 'pan_down';

/** `RANGE_SCALE_3D` (board_adapter.h): the board's larger side spans this many 3D units. */
export const RANGE_SCALE_3D = 8.0;
/** `EDA_3D_VIEWER_FRAME::m_trackBallCamera( 2 * RANGE_SCALE_3D )`. */
export const INITIAL_CAMERA_DISTANCE = 2 * RANGE_SCALE_3D;
/** `HIDPI_GL_3D_CANVAS::m_delta_move_step_factor`. */
export const DELTA_MOVE_STEP_FACTOR = 0.7;

// ---------------------------------------------------------------------------
// mat4 (column-major, glm semantics)

export const mat4Identity = (): Mat4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** `glm::translate( M, v )` = M · T(v). */
export function mat4Translate(m: Mat4, v: Vec3): Mat4 {
  const t = mat4Identity();
  t[12] = v[0];
  t[13] = v[1];
  t[14] = v[2];
  return mat4Multiply(m, t);
}

/** `glm::rotate( M, angle, axis )` = M · R(angle, axis). */
export function mat4Rotate(m: Mat4, angle: number, axis: Vec3): Mat4 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len,
    y = axis[1] / len,
    z = axis[2] / len;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  const r = mat4Identity();
  r[0] = c + x * x * t;
  r[1] = y * x * t + z * s;
  r[2] = z * x * t - y * s;
  r[4] = x * y * t - z * s;
  r[5] = c + y * y * t;
  r[6] = z * y * t + x * s;
  r[8] = x * z * t + y * s;
  r[9] = y * z * t - x * s;
  r[10] = c + z * z * t;
  return mat4Multiply(m, r);
}

export function mat4Inverse(m: Mat4): Mat4 {
  const a = m;
  const out = new Float64Array(16);
  const a00 = a[0]!,
    a01 = a[1]!,
    a02 = a[2]!,
    a03 = a[3]!;
  const a10 = a[4]!,
    a11 = a[5]!,
    a12 = a[6]!,
    a13 = a[7]!;
  const a20 = a[8]!,
    a21 = a[9]!,
    a22 = a[10]!,
    a23 = a[11]!;
  const a30 = a[12]!,
    a31 = a[13]!,
    a32 = a[14]!,
    a33 = a[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** `M · (v, w)`, returning xyz (after the homogeneous divide when `w` is 1). */
export function mat4TransformPoint(m: Mat4, v: Vec3, w = 1): Vec3 {
  const x = m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]! * w;
  const y = m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]! * w;
  const z = m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]! * w;
  const ww = m[3]! * v[0] + m[7]! * v[1] + m[11]! * v[2] + m[15]! * w;
  return w === 1 && ww !== 0 && ww !== 1 ? [x / ww, y / ww, z / ww] : [x, y, z];
}

/** `glm::perspective` (right-handed, clip -1..1: the OpenGL default). */
export function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = -(2 * far * near) / (far - near);
  return m;
}

/** `glm::ortho`. */
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = mat4Identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = -(far + near) / (far - near);
  return m;
}

// ---------------------------------------------------------------------------
// quaternions, glm layout (x, y, z, w) but built the way TRACK_BALL uses them

const quatNormalize = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

const quatConjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** `glm::quat_cast( mat4 )`, the branch on the largest diagonal term. */
export function quatFromMat4(m: Mat4): Quat {
  const m00 = m[0]!,
    m01 = m[1]!,
    m02 = m[2]!;
  const m10 = m[4]!,
    m11 = m[5]!,
    m12 = m[6]!;
  const m20 = m[8]!,
    m21 = m[9]!,
    m22 = m[10]!;
  const fourXSquaredMinus1 = m00 - m11 - m22;
  const fourYSquaredMinus1 = m11 - m00 - m22;
  const fourZSquaredMinus1 = m22 - m00 - m11;
  const fourWSquaredMinus1 = m00 + m11 + m22;
  let biggestIndex = 0;
  let fourBiggestSquaredMinus1 = fourWSquaredMinus1;
  if (fourXSquaredMinus1 > fourBiggestSquaredMinus1) {
    fourBiggestSquaredMinus1 = fourXSquaredMinus1;
    biggestIndex = 1;
  }
  if (fourYSquaredMinus1 > fourBiggestSquaredMinus1) {
    fourBiggestSquaredMinus1 = fourYSquaredMinus1;
    biggestIndex = 2;
  }
  if (fourZSquaredMinus1 > fourBiggestSquaredMinus1) {
    fourBiggestSquaredMinus1 = fourZSquaredMinus1;
    biggestIndex = 3;
  }
  const biggestVal = Math.sqrt(fourBiggestSquaredMinus1 + 1) * 0.5;
  const mult = 0.25 / biggestVal;
  switch (biggestIndex) {
    case 0:
      return [(m12 - m21) * mult, (m20 - m02) * mult, (m01 - m10) * mult, biggestVal];
    case 1:
      return [biggestVal, (m01 + m10) * mult, (m20 + m02) * mult, (m12 - m21) * mult];
    case 2:
      return [(m01 + m10) * mult, biggestVal, (m12 + m21) * mult, (m20 - m02) * mult];
    default:
      return [(m20 + m02) * mult, (m12 + m21) * mult, biggestVal, (m01 - m10) * mult];
  }
}

/** `glm::mat4_cast( quat )`. */
export function mat4FromQuat(q: Quat): Mat4 {
  const [x, y, z, w] = q;
  const m = mat4Identity();
  const qxx = x * x,
    qyy = y * y,
    qzz = z * z;
  const qxz = x * z,
    qxy = x * y,
    qyz = y * z;
  const qwx = w * x,
    qwy = w * y,
    qwz = w * z;
  m[0] = 1 - 2 * (qyy + qzz);
  m[1] = 2 * (qxy + qwz);
  m[2] = 2 * (qxz - qwy);
  m[4] = 2 * (qxy - qwz);
  m[5] = 1 - 2 * (qxx + qzz);
  m[6] = 2 * (qyz + qwx);
  m[8] = 2 * (qxz + qwy);
  m[9] = 2 * (qyz - qwx);
  m[10] = 1 - 2 * (qxx + qyy);
  return m;
}

/** `glm::slerp`, with glm's short-path and near-linear fallbacks. */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let z: Quat = b;
  let cosTheta = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cosTheta < 0) {
    z = [-b[0], -b[1], -b[2], -b[3]];
    cosTheta = -cosTheta;
  }
  if (cosTheta > 1 - 1e-7) {
    return [
      a[0] + t * (z[0] - a[0]),
      a[1] + t * (z[1] - a[1]),
      a[2] + t * (z[2] - a[2]),
      a[3] + t * (z[3] - a[3]),
    ];
  }
  const angle = Math.acos(cosTheta);
  const sa = Math.sin((1 - t) * angle),
    sb = Math.sin(t * angle),
    s = Math.sin(angle);
  return [
    (sa * a[0] + sb * z[0]) / s,
    (sa * a[1] + sb * z[1]) / s,
    (sa * a[2] + sb * z[2]) / s,
    (sa * a[3] + sb * z[3]) / s,
  ];
}

// ---------------------------------------------------------------------------
// trackball.cpp — the SGI virtual trackball

const TRACKBALLSIZE = 0.8;

function tbProjectToSphere(r: number, x: number, y: number): number {
  const d = Math.sqrt(x * x + y * y);
  if (d < r * 0.7071067811865476) return Math.sqrt(r * r - d * d); // inside sphere
  const t = r / 1.4142135623730951; // on hyperbola
  return (t * t) / d;
}

/** `axis_to_quat`. */
export function axisToQuat(a: Vec3, phi: number): Quat {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  const s = Math.sin(phi / 2);
  return [(a[0] / l) * s, (a[1] / l) * s, (a[2] / l) * s, Math.cos(phi / 2)];
}

/**
 * `trackball( q, p1x, p1y, p2x, p2y )`: the rotation that drags the point
 * `p1` on the deformed sphere to `p2`, both in -1..1 window coordinates.
 */
export function trackball(p1x: number, p1y: number, p2x: number, p2y: number): Quat {
  if (p1x === p2x && p1y === p2y) return [0, 0, 0, 1]; // zero rotation
  const p1: Vec3 = [p1x, p1y, tbProjectToSphere(TRACKBALLSIZE, p1x, p1y)];
  const p2: Vec3 = [p2x, p2y, tbProjectToSphere(TRACKBALLSIZE, p2x, p2y)];
  // a = p2 × p1, the axis of rotation
  const a: Vec3 = [
    p2[1] * p1[2] - p2[2] * p1[1],
    p2[2] * p1[0] - p2[0] * p1[2],
    p2[0] * p1[1] - p2[1] * p1[0],
  ];
  const d: Vec3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  let t = Math.hypot(d[0], d[1], d[2]) / (2 * TRACKBALLSIZE);
  if (t > 1) t = 1;
  if (t < -1) t = -1;
  return axisToQuat(a, 2 * Math.asin(t));
}

/**
 * `build_rotmatrix` as `glm::make_mat4( &m[0][0] )` reads it: `m[i][j]` lands
 * in column `i`, row `j`.
 */
export function buildRotMatrix(q: Quat): Mat4 {
  const m = mat4Identity();
  m[0] = 1 - 2 * (q[1] * q[1] + q[2] * q[2]);
  m[1] = 2 * (q[0] * q[1] - q[2] * q[3]);
  m[2] = 2 * (q[2] * q[0] + q[1] * q[3]);
  m[4] = 2 * (q[0] * q[1] + q[2] * q[3]);
  m[5] = 1 - 2 * (q[2] * q[2] + q[0] * q[0]);
  m[6] = 2 * (q[1] * q[2] - q[0] * q[3]);
  m[8] = 2 * (q[2] * q[0] - q[1] * q[3]);
  m[9] = 2 * (q[1] * q[2] + q[0] * q[3]);
  m[10] = 1 - 2 * (q[1] * q[1] + q[0] * q[0]);
  return m;
}

// ---------------------------------------------------------------------------
// 3d_math.h easing

export const bezierBlend = (t: number): number => t * t * (3 - 2 * t);
export const quadricEasingInOut = (t: number): number =>
  t <= 0.5 ? t * t * 2 : 1 - (1 - t) * (1 - t) * 2;

/** A helper function to normalize aAngle between -2PI and +2PI (camera.cpp). */
function normalise2PI(a: number): number {
  while (a > 0) a -= Math.PI * 2;
  while (a < 0) a += Math.PI * 2;
  return a;
}

// ---------------------------------------------------------------------------

export interface Frustum {
  ratio: number;
  nearD: number;
  farD: number;
  angle: number;
  tang: number;
  nw: number;
  nh: number;
  fw: number;
  fh: number;
}

const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
const v3add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const v3norm = (a: Vec3): Vec3 => v3scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const v3lerp = (a: Vec3, b: Vec3, t: number): Vec3 => v3add(v3scale(a, 1 - t), v3scale(b, t));

/** `TRACK_BALL` — the one camera the 3D viewer frame owns. */
export class TrackBallCamera {
  static readonly DEFAULT_MIN_ZOOM = 0.02;
  static readonly DEFAULT_MAX_ZOOM = 2.0;

  private projectionType: ProjectionType;
  private interpolationMode: CameraInterpolation = 'bezier';
  private minZoom = TrackBallCamera.DEFAULT_MIN_ZOOM;
  private maxZoom = TrackBallCamera.DEFAULT_MAX_ZOOM;

  private windowW = 0;
  private windowH = 0;
  private lastPosition = { x: 0, y: 0 };
  private parametersChanged = true;

  private readonly cameraPosInit: Vec3;
  private boardLookatPosInit: Vec3;

  private zoom = 1;
  private zoomT0 = 1;
  private zoomT1 = 1;
  private cameraPos: Vec3;
  private cameraPosT0: Vec3;
  private cameraPosT1: Vec3;
  private lookatPos: Vec3;
  private lookatPosT0: Vec3;
  private lookatPosT1: Vec3;
  private rotateAux: Vec3 = v3();
  private rotateAuxT0: Vec3 = v3();
  private rotateAuxT1: Vec3 = v3();

  private rotationMatrix = mat4Identity();
  private rotationMatrixAux = mat4Identity();
  private viewMatrix = mat4Identity();
  private viewMatrixInverse = mat4Identity();
  private projectionMatrix = mat4Identity();
  private projectionMatrixInv = mat4Identity();

  private quatT0: Quat = [0, 0, 0, 1];
  private quatT1: Quat = [0, 0, 0, 1];

  readonly frustum: Frustum = {
    ratio: 1,
    nearD: 0.1,
    farD: 1,
    angle: 45,
    tang: Math.tan((45 * Math.PI) / 360),
    nw: 0,
    nh: 0,
    fw: 0,
    fh: 0,
  };
  private right: Vec3 = v3(1, 0, 0);
  private up: Vec3 = v3(0, 1, 0);
  private dir: Vec3 = v3(0, 0, 1);
  private pos: Vec3 = v3();
  private frustumNc: Vec3 = v3();

  constructor(
    initialDistance = INITIAL_CAMERA_DISTANCE,
    projection: ProjectionType = 'perspective',
  ) {
    this.cameraPosInit = v3(0, 0, -initialDistance);
    this.boardLookatPosInit = v3();
    this.projectionType = projection;
    this.cameraPos = this.cameraPosT0 = this.cameraPosT1 = this.cameraPosInit;
    this.lookatPos = this.lookatPosT0 = this.lookatPosT1 = this.boardLookatPosInit;
    this.reset();
  }

  /** `CAMERA::Reset`. */
  reset(): void {
    this.parametersChanged = true;
    this.projectionMatrix = mat4Identity();
    this.projectionMatrixInv = mat4Identity();
    this.rotationMatrix = mat4Identity();
    this.rotationMatrixAux = mat4Identity();
    this.lastPosition = { x: 0, y: 0 };
    this.zoom = this.zoomT0 = this.zoomT1 = 1;
    this.cameraPos = this.cameraPosT0 = this.cameraPosT1 = this.cameraPosInit;
    this.lookatPos = this.lookatPosT0 = this.lookatPosT1 = this.boardLookatPosInit;
    this.rotateAux = this.rotateAuxT0 = this.rotateAuxT1 = v3();
    this.updateRotationMatrix();
    this.updateViewMatrix();
    this.viewMatrixInverse = mat4Inverse(this.viewMatrix);
    this.rebuildProjection();
    // TRACK_BALL::initQuat
    this.quatT0 = trackball(0, 0, 0, 0);
    this.quatT1 = trackball(0, 0, 0, 0);
  }

  // -- accessors -------------------------------------------------------------

  getViewMatrix(): Mat4 {
    return this.viewMatrix;
  }
  getViewMatrixInv(): Mat4 {
    return this.viewMatrixInverse;
  }
  getProjectionMatrix(): Mat4 {
    return this.projectionMatrix;
  }
  getProjectionMatrixInv(): Mat4 {
    return this.projectionMatrixInv;
  }
  /** `GetRotationMatrix`: `R · Raux`, what the navigator gizmo is drawn with. */
  getRotationMatrix(): Mat4 {
    return mat4Multiply(this.rotationMatrix, this.rotationMatrixAux);
  }
  /** `GetPos`: the camera's world position (the head-light hangs off it). */
  getPos(): Vec3 {
    return this.pos;
  }
  getDir(): Vec3 {
    return this.dir;
  }
  getUp(): Vec3 {
    return this.up;
  }
  getRight(): Vec3 {
    return this.right;
  }
  /** `GetCameraPos`: `m_camera_pos`, whose xy the status bar shows as dx/dy. */
  getCameraPos(): Vec3 {
    return this.cameraPos;
  }
  getLookAtPos(): Vec3 {
    return this.lookatPos;
  }
  getZoom(): number {
    return this.zoom;
  }
  getProjection(): ProjectionType {
    return this.projectionType;
  }
  setProjection(p: ProjectionType): void {
    this.projectionType = p;
  }
  getInterpolateMode(): CameraInterpolation {
    return this.interpolationMode;
  }
  setInterpolateMode(m: CameraInterpolation): void {
    this.interpolationMode = m;
  }
  getCurMousePosition(): { x: number; y: number } {
    return this.lastPosition;
  }
  setCurMousePosition(x: number, y: number): void {
    this.lastPosition = { x, y };
  }
  getWindowSize(): { w: number; h: number } {
    return { w: this.windowW, h: this.windowH };
  }
  /** `GetCameraMinDimension`. */
  getCameraMinDimension(): number {
    return -this.cameraPosInit[2] * this.frustum.tang;
  }

  /** `ParametersChanged`: reads and clears the dirty flag. */
  takeParametersChanged(): boolean {
    const c = this.parametersChanged;
    this.parametersChanged = false;
    return c;
  }

  // -- setup -----------------------------------------------------------------

  /** `SetCurWindowSize`; true when it changed (the projection was rebuilt). */
  setCurWindowSize(w: number, h: number): boolean {
    if (this.windowW === w && this.windowH === h) return false;
    this.windowW = w;
    this.windowH = h;
    this.rebuildProjection();
    return true;
  }

  /** `SetBoardLookAtPos`. */
  setBoardLookAtPos(p: Vec3): void {
    const cur = this.boardLookatPosInit;
    if (cur[0] === p[0] && cur[1] === p[1] && cur[2] === p[2]) return;
    this.boardLookatPosInit = p;
    this.lookatPos = p;
    this.parametersChanged = true;
    this.updateViewMatrix();
    this.updateFrustum();
  }

  toggleProjection(): void {
    this.projectionType = this.projectionType === 'ortho' ? 'perspective' : 'ortho';
    this.rebuildProjection();
  }

  // -- internal update -------------------------------------------------------

  private updateViewMatrix(): void {
    this.viewMatrix = mat4Multiply(
      mat4Multiply(
        mat4Translate(mat4Identity(), this.cameraPos),
        mat4Multiply(this.rotationMatrix, this.rotationMatrixAux),
      ),
      mat4Translate(mat4Identity(), v3scale(this.lookatPos, -1)),
    );
  }

  private updateRotationMatrix(): void {
    let m = mat4Rotate(mat4Identity(), this.rotateAux[0], [1, 0, 0]);
    this.rotateAux[0] = normalise2PI(this.rotateAux[0]);
    m = mat4Rotate(m, this.rotateAux[1], [0, 1, 0]);
    this.rotateAux[1] = normalise2PI(this.rotateAux[1]);
    m = mat4Rotate(m, this.rotateAux[2], [0, 0, 1]);
    this.rotateAux[2] = normalise2PI(this.rotateAux[2]);
    this.rotationMatrixAux = m;
    this.parametersChanged = true;
    this.updateViewMatrix();
    this.updateFrustum();
  }

  /** `SetRotationMatrix`: stores `aRotation · inverse(Raux)` (the 3×3 + translation part). */
  private setRotationMatrix(rot: Mat4): void {
    this.parametersChanged = true;
    const m = mat4Multiply(rot, mat4Inverse(this.rotationMatrixAux));
    // std::copy_n( ..., 12, ... ) — the first three columns only.
    for (let i = 0; i < 12; i++) this.rotationMatrix[i] = m[i]!;
  }

  private rebuildProjection(): void {
    if (this.windowW === 0 || this.windowH === 0) return;
    const f = this.frustum;
    f.ratio = this.windowW / this.windowH;
    f.farD = Math.hypot(...this.cameraPosInit) * this.maxZoom * 2;
    switch (this.projectionType) {
      default:
      case 'perspective': {
        f.nearD = 0.1;
        f.angle = 45;
        this.projectionMatrix = mat4Perspective(
          (f.angle * Math.PI) / 180,
          f.ratio,
          f.nearD,
          f.farD,
        );
        f.tang = Math.tan(((f.angle * Math.PI) / 180) * 0.5);
        f.nh = 2 * f.nearD * f.tang;
        f.nw = f.nh * f.ratio;
        f.fh = 2 * f.farD * f.tang;
        f.fw = f.fh * f.ratio;
        break;
      }
      case 'ortho': {
        // Keep the viewed plane at (m_camera_pos_init * m_zoom) the same
        // dimensions in both projections.
        f.angle = 45;
        f.tang = Math.tan(((f.angle * Math.PI) / 180) * 0.5);
        f.nearD = -f.farD; // Use a symmetrical clip plane for ortho projection
        const orthoReductionFactor = Math.hypot(...this.cameraPosInit) * this.zoom * f.tang;
        this.projectionMatrix = mat4Ortho(
          -f.ratio * orthoReductionFactor,
          f.ratio * orthoReductionFactor,
          -orthoReductionFactor,
          orthoReductionFactor,
          f.nearD,
          f.farD,
        );
        f.nw = orthoReductionFactor * 2 * f.ratio;
        f.nh = orthoReductionFactor * 2;
        f.fw = f.nw;
        f.fh = f.nh;
        break;
      }
    }
    this.projectionMatrixInv = mat4Inverse(this.projectionMatrix);
    this.updateFrustum();
  }

  private updateFrustum(): void {
    this.viewMatrixInverse = mat4Inverse(this.viewMatrix);
    const inv = this.viewMatrixInverse;
    this.right = v3norm(mat4TransformPoint(inv, [1, 0, 0], 0));
    this.up = v3norm(mat4TransformPoint(inv, [0, 1, 0], 0));
    this.dir = v3norm(mat4TransformPoint(inv, [0, 0, 1], 0));
    this.pos = mat4TransformPoint(inv, [0, 0, 0], 1);
    // compute the centre of the near plane (MakeRay's origin)
    this.frustumNc = v3add(this.pos, v3scale(this.dir, -this.frustum.nearD));
  }

  // -- rays ------------------------------------------------------------------

  /**
   * `MakeRay( SFVEC2I )`: window pixel (y up, as GL counts it) → world ray.
   * The precomputed `m_scr_nX`/`m_right_nX` tables are inlined.
   */
  makeRay(px: number, py: number): { origin: Vec3; dir: Vec3 } {
    const nx = 2 * ((px + 0.5) / this.windowW) - 1;
    const ny = 2 * ((py + 0.5) / this.windowH) - 1;
    const f = this.frustum;
    const origin = v3add(
      v3add(this.frustumNc, v3scale(this.up, f.nh * 0.5 * ny)),
      v3scale(this.right, f.nw * 0.5 * nx),
    );
    if (this.projectionType === 'ortho') {
      const d = v3scale(this.dir, -1);
      return { origin, dir: [d[0] + 1.1920929e-7, d[1] + 1.1920929e-7, d[2] + 1.1920929e-7] };
    }
    return {
      origin,
      dir: v3norm([origin[0] - this.pos[0], origin[1] - this.pos[1], origin[2] - this.pos[2]]),
    };
  }

  /** `MakeRayAtCurrentMousePosition` (window y is flipped to GL's convention). */
  makeRayAtCurrentMousePosition(): { origin: Vec3; dir: Vec3 } | null {
    const x = this.lastPosition.x;
    const y = this.windowH - this.lastPosition.y;
    if (x > 0 && x < this.windowW && y > 0 && y < this.windowH) return this.makeRay(x, y);
    return null;
  }

  // -- zoom ------------------------------------------------------------------

  private zoomChanged(): void {
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
    if (this.zoom > this.maxZoom) this.zoom = this.maxZoom;
    this.cameraPos = [this.cameraPos[0], this.cameraPos[1], this.cameraPosInit[2] * this.zoom];
    this.updateViewMatrix();
    this.rebuildProjection();
  }

  /** `Zoom( aFactor )`: divides the zoom; false when already at a limit. */
  zoomBy(aFactor: number): boolean {
    if (
      (this.zoom <= this.minZoom && aFactor > 1) ||
      (this.zoom >= this.maxZoom && aFactor < 1) ||
      aFactor === 1
    ) {
      return false;
    }
    const zoom = this.zoom;
    this.zoom /= aFactor;
    if (this.zoom <= this.minZoom && aFactor > 1) {
      aFactor = zoom / this.minZoom;
      this.zoom = this.minZoom;
    } else if (this.zoom >= this.maxZoom && aFactor < 1) {
      aFactor = zoom / this.maxZoom;
      this.zoom = this.maxZoom;
    }
    this.cameraPos = [this.cameraPos[0], this.cameraPos[1], this.cameraPos[2] / aFactor];
    this.updateViewMatrix();
    this.rebuildProjection();
    return true;
  }

  /** `Zoom_T1`. */
  zoomT1By(aFactor: number): boolean {
    if (
      (this.zoom <= this.minZoom && aFactor > 1) ||
      (this.zoom >= this.maxZoom && aFactor < 1) ||
      aFactor === 1
    ) {
      return false;
    }
    this.zoomT1 = this.zoom / aFactor;
    if (this.zoomT1 < this.minZoom) this.zoomT1 = this.minZoom;
    if (this.zoomT1 > this.maxZoom) this.zoomT1 = this.maxZoom;
    this.cameraPosT1 = [
      this.cameraPosT1[0],
      this.cameraPosT1[1],
      this.cameraPosInit[2] * this.zoomT1,
    ];
    return true;
  }

  /** `ZoomReset`. */
  zoomReset(): void {
    this.zoom = 1;
    this.cameraPos = [this.cameraPos[0], this.cameraPos[1], this.cameraPosInit[2]];
    this.updateViewMatrix();
    this.rebuildProjection();
  }

  // -- rotation --------------------------------------------------------------

  rotateScreen(rad: number): void {
    this.setRotationMatrix(mat4Rotate(this.getRotationMatrix(), rad, this.dir));
    this.updateRotationMatrix();
  }
  rotateX(rad: number): void {
    this.setRotationMatrix(mat4Rotate(this.getRotationMatrix(), rad, [1, 0, 0]));
    this.updateRotationMatrix();
  }
  rotateY(rad: number): void {
    this.setRotationMatrix(mat4Rotate(this.getRotationMatrix(), rad, [0, 1, 0]));
    this.updateRotationMatrix();
  }
  rotateZ(rad: number): void {
    this.setRotationMatrix(mat4Rotate(this.getRotationMatrix(), rad, [0, 0, 1]));
    this.updateRotationMatrix();
  }
  rotateXT1(rad: number): void {
    this.rotateAuxT1 = [this.rotateAuxT1[0] + rad, this.rotateAuxT1[1], this.rotateAuxT1[2]];
  }
  rotateYT1(rad: number): void {
    this.rotateAuxT1 = [this.rotateAuxT1[0], this.rotateAuxT1[1] + rad, this.rotateAuxT1[2]];
  }
  rotateZT1(rad: number): void {
    this.rotateAuxT1 = [this.rotateAuxT1[0], this.rotateAuxT1[1], this.rotateAuxT1[2] + rad];
  }

  // -- pan -------------------------------------------------------------------

  resetXYpos(): void {
    this.parametersChanged = true;
    this.cameraPos = [0, 0, this.cameraPos[2]];
    this.updateViewMatrix();
    this.updateFrustum();
  }
  resetXYposT1(): void {
    this.cameraPosT1 = [0, 0, this.cameraPosT1[2]];
  }

  /** `TRACK_BALL::Pan( const SFVEC3F& )`. */
  panBy(delta: Vec3): void {
    this.parametersChanged = true;
    this.cameraPos = v3add(this.cameraPos, delta);
    this.updateViewMatrix();
    this.updateFrustum();
  }
  /** `TRACK_BALL::Pan_T1`. */
  panT1By(delta: Vec3): void {
    this.cameraPosT1 = v3add(this.cameraPos, delta);
  }

  /** `TRACK_BALL::Pan( const wxPoint& )`: a mouse drag from the last position. */
  pan(x: number, y: number): void {
    this.parametersChanged = true;
    const f = this.frustum;
    const lp = this.lastPosition;
    let dx: number, dy: number;
    if (this.projectionType === 'ortho') {
      dx = (f.nw * (lp.x - x)) / this.windowW;
      dy = (f.nh * (y - lp.y)) / this.windowH;
    } else {
      // Unproject the coordinates using the precomputed frustum tangent (zoom level dependent)
      const panFactor = -this.cameraPos[2] * f.tang * 2;
      dx = (panFactor * f.ratio * (lp.x - x)) / this.windowW;
      dy = (panFactor * (y - lp.y)) / this.windowH;
    }
    this.cameraPos = [this.cameraPos[0] - dx, this.cameraPos[1] - dy, this.cameraPos[2]];
    this.updateViewMatrix();
    this.updateFrustum();
  }

  /** `TRACK_BALL::Drag`: spin the board from the last mouse position to (x, y). */
  drag(x: number, y: number): void {
    this.parametersChanged = true;
    const w = this.windowW,
      h = this.windowH;
    const lp = this.lastPosition;
    const spin = trackball(
      (2 * lp.x - w) / w,
      (h - 2 * lp.y) / h,
      (2 * x - w) / w,
      (h - 2 * y) / h,
    );
    this.rotationMatrix = mat4Multiply(buildRotMatrix(spin), this.rotationMatrix);
    this.updateViewMatrix();
    this.updateFrustum();
  }

  // -- T0 / T1 animation -----------------------------------------------------

  /** `TRACK_BALL::SetT0_and_T1_current_T`. */
  setT0AndT1CurrentT(): void {
    this.cameraPosT0 = this.cameraPosT1 = this.cameraPos;
    this.lookatPosT0 = this.lookatPosT1 = this.lookatPos;
    this.rotateAuxT0 = this.rotateAuxT1 = this.rotateAux;
    this.zoomT0 = this.zoomT1 = this.zoom;
    // Charge the quaternions with the current rotation matrix to allow dual input.
    const q = quatConjugate(quatFromMat4(this.rotationMatrix));
    this.quatT0 = q;
    this.quatT1 = q;
  }

  /** `TRACK_BALL::Reset_T1`. */
  resetT1(): void {
    this.cameraPosT1 = this.cameraPosInit;
    this.zoomT1 = 1;
    this.rotateAuxT1 = v3();
    this.lookatPosT1 = this.boardLookatPosInit;
    // Since 0 = 2pi, we want to reset the angle to be the closest one to where
    // we currently are, so we rotate around the smallest distance getting there.
    const t1: Vec3 = [0, 0, 0];
    if (this.rotateAuxT0[0] > Math.PI) t1[0] = 2 * Math.PI;
    if (this.rotateAuxT0[1] > Math.PI) t1[1] = 2 * Math.PI;
    if (this.rotateAuxT0[2] > Math.PI) t1[2] = 2 * Math.PI;
    this.rotateAuxT1 = t1;
    this.quatT1 = trackball(0, 0, 0, 0);
  }

  setLookAtPosT1(p: Vec3): void {
    this.lookatPosT1 = p;
  }

  /** `CAMERA::ViewCommand_T1`: the axis-aligned views as Raux targets. */
  viewCommandT1(view: View3dType): boolean {
    const rad = (d: number): number => (d * Math.PI) / 180;
    switch (view) {
      case 'right':
        this.setT0AndT1CurrentT();
        this.resetT1();
        this.rotateZT1(rad(-90));
        this.rotateXT1(rad(-90));
        return true;
      case 'left':
        this.resetT1();
        this.rotateZT1(rad(90));
        this.rotateXT1(rad(-90));
        return true;
      case 'front':
        this.resetT1();
        this.rotateXT1(rad(-90));
        return true;
      case 'back':
        this.resetT1();
        this.rotateXT1(rad(-90));
        // The rotation angle should be 180. We use 179.999 (180 - epsilon) to
        // avoid a full 360 deg rotation when using 180 deg if the previous
        // rotated position was already 180 deg
        this.rotateZT1(rad(179.999));
        return true;
      case 'top':
        this.resetT1();
        return true;
      case 'bottom':
        this.resetT1();
        this.rotateYT1(rad(179.999)); // Rotation = 180 - epsilon
        return true;
      case 'flip':
        this.rotateYT1(rad(179.999));
        return true;
      default:
        return false;
    }
  }

  /**
   * `CAMERA::SetViewMatrix` (camera.cpp:388-420): a saved viewport comes
   * back as its view matrix. The rotation is taken off it, the zoom is read
   * from where the look-at lands in view z and clamped (moving the matrix's
   * own z to match), and `m_camera_pos` is recovered as column 3 of
   * `V · inverse( R·Raux·T(−lookat) )`.
   *
   * Upstream leaves the frustum stale here (no `updateFrustum`), so the
   * head-light sits at the OLD position until the next camera change — one
   * frame's lighting. Refreshed here; that transient is not worth keeping.
   */
  setViewMatrix(view: Mat4): void {
    const m = new Float64Array(view);
    this.setRotationMatrix(m);
    const lookat = mat4TransformPoint(m, this.lookatPos);
    this.zoom = lookat[2] / this.cameraPosInit[2];
    if (this.zoom > this.maxZoom) {
      this.zoom = this.maxZoom;
      m[14] = m[14]! + -lookat[2] + this.maxZoom * this.cameraPosInit[2];
    } else if (this.zoom < this.minZoom) {
      this.zoom = this.minZoom;
      m[14] = m[14]! + -lookat[2] + this.minZoom * this.cameraPosInit[2];
    }
    this.viewMatrix = m;
    const inv = mat4Inverse(
      mat4Multiply(
        mat4Multiply(this.rotationMatrix, this.rotationMatrixAux),
        mat4Translate(mat4Identity(), v3scale(this.lookatPos, -1)),
      ),
    );
    const c = mat4Multiply(this.viewMatrix, inv);
    this.cameraPos = [c[12]!, c[13]!, c[14]!];
    this.parametersChanged = true;
    this.rebuildProjection();
    this.updateFrustum();
  }

  /** `TRACK_BALL::Interpolate( t )` — t is clamped to 1. */
  interpolate(tIn: number): void {
    let t = tIn > 1 ? 1 : tIn;
    switch (this.interpolationMode) {
      case 'bezier':
        t = bezierBlend(t);
        break;
      case 'easing_in_out':
        t = quadricEasingInOut(t);
        break;
      default:
        break;
    }
    let q1 = this.quatT1;
    const q0 = this.quatT0;
    if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) {
      q1 = [-q1[0], -q1[1], -q1[2], -q1[3]];
    }
    const q = quatNormalize(quatSlerp(q0, q1, t));
    this.rotationMatrix = mat4FromQuat(quatConjugate(q));
    // CAMERA::Interpolate
    const t0 = 1 - t;
    this.cameraPos = v3lerp(this.cameraPosT0, this.cameraPosT1, t);
    this.lookatPos = v3lerp(this.lookatPosT0, this.lookatPosT1, t);
    this.rotateAux = v3lerp(this.rotateAuxT0, this.rotateAuxT1, t);
    this.zoom = this.zoomT0 * t0 + this.zoomT1 * t;
    this.parametersChanged = true;
    this.updateRotationMatrix();
    this.rebuildProjection();
  }
}
