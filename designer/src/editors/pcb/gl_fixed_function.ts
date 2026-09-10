// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RENDER_3D_OPENGL`'s lighting model, which is OpenGL 1.x fixed-function
 * Gouraud shading and nothing more: three lights set up once in
 * `init_lights()` (render_3d_opengl.cpp:400), an `SMATERIAL` per layer from
 * `setupMaterials()` / `setLayerMaterial()`, `glColorMaterial(
 * GL_AMBIENT_AND_DIFFUSE )` for the 3D models, and `OglSetMaterial()`
 * (common_ogl/ogl_utils.cpp) pushing the five `glMaterial*` calls.
 *
 * There is no tone mapping, no environment, no sRGB conversion on the way
 * out: the material numbers go through the GL 1.x lighting equation, are
 * clamped to 0..1 per VERTEX, interpolated, and land in the framebuffer as
 * they are. The shader below is that equation, so the same numbers give the
 * same pixels. The pure parts (the material table, the clamp, the encode) are
 * free of three.js so qa can pin them; `makeFixedFunctionMaterial` is the one
 * three.js binding.
 *
 * What the equation is (OpenGL 1.5 §2.14.1, `GL_LIGHT_MODEL_LOCAL_VIEWER`
 * off, no attenuation, no spot):
 *
 *   c = E_m + A_lm·A_m + Σ_i [ A_li·A_m + max(N·L_i,0)·D_li·D_m
 *                              + (N·L_i > 0 ? max(N·H_i,0)^s : 0)·S_li·S_m ]
 *   H_i = normalize( L_i + (0,0,1) )      — the non-local viewer
 *   alpha = D_m.a
 *
 * `A_lm` (GL_LIGHT_MODEL_AMBIENT) is set to zero in `init_lights`.
 */
import * as THREE from 'three';
import type { Color4d } from '@ziroeda/common/src/color4d.js';

export type Vec3 = [number, number, number];

/** `SMATERIAL` (plugins/3dapi/c3dmodel.h). Transparency: 1 is fully transparent. */
export interface SMaterial {
  ambient: Vec3;
  diffuse: Vec3;
  specular: Vec3;
  emissive: Vec3;
  shininess: number;
  transparency: number;
}

const rgb = (c: Color4d): Vec3 => [c.r, c.g, c.b];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const addS = (v: Vec3, s: number): Vec3 => [v[0] + s, v[1] + s, v[2] + s];
const ZERO: Vec3 = [0, 0, 0];

/** `mapf` (3d_math.h). */
export function mapf(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  x = Math.min(Math.max(x, inMin), inMax);
  return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/** `RGBtoGray` (3d_math.h). */
export const rgbToGray = (c: Vec3): number => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/** `MaterialDiffuseToColorCAD` (3d_math.h): the CAD colours preset's grey ramp. */
export function materialDiffuseToColorCAD(c: Vec3): Vec3 {
  // convert to a discrete scale of grays
  const luminance = Math.min((Math.trunc(4 * rgbToGray(c)) + 0.5) / 4, 1);
  const maxValue = Math.max(c[0], c[1], c[2], 1.1920929e-7);
  return [
    (c[0] / maxValue) * 0.125 + luminance * 0.875,
    (c[1] / maxValue) * 0.125 + luminance * 0.875,
    (c[2] / maxValue) * 0.125 + luminance * 0.875,
  ];
}

/**
 * The GL shininess `OglSetMaterial` actually sets:
 * `128 * ( m_Shininess > 1 ? 1 : m_Shininess )`.
 *
 * Every board material in `setupMaterials` stores `factor * 128`, which is
 * always above 1, so every board layer is lit with exponent 128 whatever the
 * factor says. A model's shininess comes from its file in 0..1 (VRML's
 * range, and the OCE loader's 0.1 / 0.05) and is the only place the scale
 * matters. Reproduced, not corrected.
 */
export const glShininess = (m: SMaterial): number => 128 * (m.shininess > 1 ? 1 : m.shininess);

/** The `BOARD_ADAPTER` colours `setupMaterials` reads (all `SFVEC4F`). */
export interface AdapterColors {
  copper: Color4d;
  solderPaste: Color4d;
  silkTop: Color4d;
  silkBottom: Color4d;
  maskTop: Color4d;
  maskBottom: Color4d;
  boardBody: Color4d;
}

export interface BoardMaterials {
  copper: SMaterial;
  nonPlatedCopper: SMaterial;
  paste: SMaterial;
  silkTop: SMaterial;
  silkBottom: SMaterial;
  maskTop: SMaterial;
  maskBottom: SMaterial;
  epoxyBoard: SMaterial;
}

/**
 * `RENDER_3D_OPENGL::setupMaterials()` and the per-layer fill-ins of
 * `setLayerMaterial()` / `renderBoardBody()`, as one table.
 */
export function boardMaterials(c: AdapterColors): BoardMaterials {
  const copperColor = rgb(c.copper);
  // This guess the material type(ex: copper vs gold) to determine the
  // shininess factor between 0.1 and 0.4
  const shininessfactor =
    0.4 - mapf(Math.abs(copperColor[0] - copperColor[1]), 0.15, 1.0, 0.0, 0.3);
  const copper: SMaterial = {
    ambient: scale(copperColor, 0.1),
    diffuse: copperColor,
    specular: addS(scale(copperColor, 0.75), 0.25),
    emissive: ZERO,
    shininess: shininessfactor * 128,
    transparency: 0,
  };
  // Non plated copper (raw copper)
  const nonPlatedCopper: SMaterial = {
    ambient: [0.191, 0.073, 0.022],
    diffuse: [184 / 255, 115 / 255, 50 / 255],
    specular: [0.256, 0.137, 0.086],
    emissive: ZERO,
    shininess: 0.1 * 128,
    transparency: 0,
  };
  const pasteColor = rgb(c.solderPaste);
  const paste: SMaterial = {
    ambient: pasteColor,
    diffuse: pasteColor,
    specular: mul(pasteColor, pasteColor),
    emissive: ZERO,
    shininess: 0.1 * 128,
    transparency: 0,
  };
  const silk = (col: Color4d): SMaterial => {
    const d = rgb(col);
    return {
      ambient: d,
      diffuse: d,
      specular: addS(mul(d, d), 0.1),
      emissive: ZERO,
      shininess: 0.078125 * 128,
      transparency: 0,
    };
  };
  const mask = (col: Color4d): SMaterial => {
    const d = rgb(col);
    return {
      diffuse: d,
      // Convert Opacity to Transparency
      transparency: 1 - col.a,
      ambient: scale(d, 0.3),
      specular: mul(d, d),
      emissive: ZERO,
      shininess: 0.8 * 128,
    };
  };
  const epoxyBoard: SMaterial = {
    ambient: [117 / 255, 97 / 255, 47 / 255],
    diffuse: rgb(c.boardBody),
    specular: [18 / 255, 3 / 255, 20 / 255],
    emissive: ZERO,
    shininess: 0.1 * 128,
    transparency: 1 - c.boardBody.a,
  };
  return {
    copper,
    nonPlatedCopper,
    paste,
    silkTop: silk(c.silkTop),
    silkBottom: silk(c.silkBottom),
    maskTop: mask(c.maskTop),
    maskBottom: mask(c.maskBottom),
    epoxyBoard,
  };
}

/** `m_Plastic` as `setLayerMaterial` fills it for a user/tech layer colour. */
export function plasticMaterial(diffuse: Vec3): SMaterial {
  return {
    diffuse,
    ambient: scale(diffuse, 0.05),
    specular: scale(diffuse, 0.7),
    emissive: ZERO,
    shininess: 0.078125 * 128,
    transparency: 0,
  };
}

/**
 * `OglSetDiffuseMaterial`: the DIFFUSE_ONLY / CAD_MODE material — a flat
 * 0.2 ambient, no specular, exponent 0.
 */
export function diffuseOnlyMaterial(diffuse: Vec3): SMaterial {
  return {
    ambient: [0.2, 0.2, 0.2],
    diffuse,
    specular: ZERO,
    emissive: ZERO,
    shininess: 0,
    transparency: 0,
  };
}

/**
 * The OCE loader's material for a coloured STEP face
 * (plugins/3d/oce/loadmodel.cpp:264-268), and the uncoloured default
 * (:240-243). `formatMaterial` (3d_cache/sg/ifsg_api.cpp:44) then multiplies
 * ambient by diffuse; `glColorMaterial( GL_AMBIENT_AND_DIFFUSE )` at draw
 * time overrides both with the vertex colour anyway, so what survives of the
 * loader's choice is the specular, the shininess, and the transparency.
 */
export function stepFaceMaterial(diffuse: Vec3, alpha = 1, coloured = true): SMaterial {
  return coloured
    ? {
        ambient: mul([0.1, 0.1, 0.1], diffuse),
        diffuse,
        specular: [0.12, 0.12, 0.12],
        emissive: ZERO,
        shininess: 0.1,
        transparency: 1 - alpha,
      }
    : {
        ambient: mul([0.1, 0.1, 0.1], [0.6, 0.6, 0.6]),
        diffuse: [0.6, 0.6, 0.6],
        specular: [0.04, 0.04, 0.04],
        emissive: ZERO,
        shininess: 0.05,
        transparency: 0,
      };
}

/**
 * `Quantity_Color::Convert_LinearRGB_To_sRGB`. KiCad reads a STEP colour
 * with `Values( r, g, b, Quantity_TOC_sRGB )` and lights those sRGB-encoded
 * numbers directly; our `.glb`s (and `occt-import-js`) hand back the LINEAR
 * values OCCT stores, so this is the encode that recovers KiCad's numbers.
 */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// init_lights()

/** `SphericalToCartesian( inclination, azimuth )` (3d_math.h). */
export function sphericalToCartesian(inclination: number, azimuth: number): Vec3 {
  const sinInc = Math.sin(inclination);
  return [sinInc * Math.cos(azimuth), sinInc * Math.sin(azimuth), Math.cos(inclination)];
}

export const LIGHT_AMBIENT: Vec3 = [0.084, 0.084, 0.084];
export const LIGHT0_DIFFUSE: Vec3 = [0.3, 0.3, 0.3];
export const LIGHT0_SPECULAR: Vec3 = [0.5, 0.5, 0.5];
export const LIGHT12_DIFFUSE: Vec3 = [0.7, 0.7, 0.7];
export const LIGHT12_SPECULAR: Vec3 = [0.7, 0.7, 0.7];
/**
 * GL_LIGHT1's direction, "slightly not perpendicular with the XZ plane".
 * `init_lights` runs from `initializeOpenGL` with the modelview still the
 * identity, so this is an EYE-space direction: the top light rides with the
 * camera. GL_LIGHT2 is its mirror in z.
 */
export const LIGHT1_DIR: Vec3 = sphericalToCartesian(Math.PI * 0.03, Math.PI * 0.25);
export const LIGHT2_DIR: Vec3 = [LIGHT1_DIR[0], LIGHT1_DIR[1], -LIGHT1_DIR[2]];

/**
 * The head-light's WORLD position for a camera at `cameraPos`
 * (`RENDER_3D_OPENGL::Redraw`, "Position the headlight"): a point light
 * pushed out along z so the diffuse term never collapses when the camera
 * skims the board.
 */
export function headlightPosition(cameraPos: Vec3): Vec3 {
  const z = cameraPos[2];
  const zpos = z > 0 ? Math.max(z, 0.5) + z * z : Math.min(z, -0.5) - z * z;
  return [cameraPos[0], cameraPos[1], zpos];
}

/**
 * The lighting equation on the CPU, for one vertex in EYE space — the same
 * arithmetic as the vertex shader, so a test can pin a pixel without a GPU.
 */
export function lightVertex(
  m: SMaterial,
  normalEye: Vec3,
  positionEye: Vec3,
  headlightEye: Vec3,
  alpha: number,
  colorMaterial?: Vec3,
): [number, number, number, number] {
  const A = colorMaterial ?? m.ambient;
  const D = colorMaterial ?? m.diffuse;
  const s = glShininess(m);
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const N = norm(normalEye);
  let c: Vec3 = [m.emissive[0], m.emissive[1], m.emissive[2]];
  const light = (L: Vec3, amb: Vec3, dif: Vec3, spec: Vec3): void => {
    const nDotL = Math.max(dot(N, L), 0);
    const H = norm([L[0], L[1], L[2] + 1]);
    const sp = nDotL > 0 ? Math.max(dot(N, H), 0) ** s : 0;
    c = [
      c[0] + amb[0] * A[0] + nDotL * dif[0] * D[0] + sp * spec[0] * m.specular[0],
      c[1] + amb[1] * A[1] + nDotL * dif[1] * D[1] + sp * spec[1] * m.specular[1],
      c[2] + amb[2] * A[2] + nDotL * dif[2] * D[2] + sp * spec[2] * m.specular[2],
    ];
  };
  light(
    norm([
      headlightEye[0] - positionEye[0],
      headlightEye[1] - positionEye[1],
      headlightEye[2] - positionEye[2],
    ]),
    LIGHT_AMBIENT,
    LIGHT0_DIFFUSE,
    LIGHT0_SPECULAR,
  );
  light(LIGHT1_DIR, LIGHT_AMBIENT, LIGHT12_DIFFUSE, LIGHT12_SPECULAR);
  light(LIGHT2_DIR, LIGHT_AMBIENT, LIGHT12_DIFFUSE, LIGHT12_SPECULAR);
  const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2]), alpha];
}

// ---------------------------------------------------------------------------
// three.js binding

const VERTEX_SHADER = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uDiffuse;
uniform vec3 uSpecular;
uniform vec3 uEmissive;
uniform float uShininess;
uniform float uAlpha;
uniform vec3 uHeadlightEye;
uniform vec3 uLight1Dir;
uniform vec3 uLight2Dir;
uniform vec3 uLightAmbient;
uniform vec3 uLight0Diffuse;
uniform vec3 uLight0Specular;
uniform vec3 uLight12Diffuse;
uniform vec3 uLight12Specular;
varying vec4 vColor;

vec3 lightTerm( vec3 N, vec3 L, vec3 amb, vec3 dif, vec3 spec ) {
  float nDotL = max( dot( N, L ), 0.0 );
  // GL_LIGHT_MODEL_LOCAL_VIEWER is off: the viewer sits at +z infinity.
  vec3 H = normalize( L + vec3( 0.0, 0.0, 1.0 ) );
  float sp = ( nDotL > 0.0 ) ? pow( max( dot( N, H ), 0.0 ), uShininess ) : 0.0;
  return amb * uAmbient + nDotL * dif * uDiffuse + sp * spec * uSpecular;
}

void main() {
  vec4 P4 = modelViewMatrix * vec4( position, 1.0 );
  vec3 N = normalize( normalMatrix * normal ); // GL_NORMALIZE
  vec3 c = uEmissive;
  c += lightTerm( N, normalize( uHeadlightEye - P4.xyz ), uLightAmbient, uLight0Diffuse, uLight0Specular );
  c += lightTerm( N, uLight1Dir, uLightAmbient, uLight12Diffuse, uLight12Specular );
  c += lightTerm( N, uLight2Dir, uLightAmbient, uLight12Diffuse, uLight12Specular );
  vColor = vec4( clamp( c, 0.0, 1.0 ), uAlpha );
  gl_Position = projectionMatrix * P4;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

/** The light uniforms every fixed-function material shares (one object, updated per frame). */
export interface SharedLightUniforms {
  uHeadlightEye: { value: THREE.Vector3 };
}

export function makeSharedLightUniforms(): SharedLightUniforms {
  return { uHeadlightEye: { value: new THREE.Vector3(0, 0, 1) } };
}

export interface FixedFunctionOptions {
  /** `aOpacity` of `OglSetMaterial`: the footprint model's `(opacity …)`. */
  opacity?: number;
  /** `glDepthMask( GL_FALSE )` while the transparent models are drawn. */
  depthWrite?: boolean;
  /** `glEnable( GL_BLEND )` — the layer lists always set it, but alpha 1 makes it moot. */
  transparent?: boolean;
  /** `glPolygonOffset( factor, units )`. */
  polygonOffset?: [number, number];
  /** `glDisable( GL_CULL_FACE )`: the navigator gizmo only. */
  doubleSide?: boolean;
  /**
   * `glColorMaterial( GL_FRONT_AND_BACK, GL_AMBIENT_AND_DIFFUSE )` with the
   * vertex colour = the material diffuse: ambient tracks diffuse.
   */
  colorMaterial?: boolean;
}

/**
 * `OglSetMaterial( aMaterial, aOpacity )` as a three.js material sharing one
 * set of light uniforms. `uAlpha` is `( 1 - transparency ) * opacity`.
 */
export function makeFixedFunctionMaterial(
  m: SMaterial,
  lights: SharedLightUniforms,
  o: FixedFunctionOptions = {},
): THREE.ShaderMaterial {
  const opacity = o.opacity ?? 1;
  const ambient = o.colorMaterial ? m.diffuse : m.ambient;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uAmbient: { value: new THREE.Vector3(...ambient) },
      uDiffuse: { value: new THREE.Vector3(...m.diffuse) },
      uSpecular: { value: new THREE.Vector3(...m.specular) },
      uEmissive: { value: new THREE.Vector3(...m.emissive) },
      uShininess: { value: glShininess(m) },
      uAlpha: { value: (1 - m.transparency) * opacity },
      uHeadlightEye: lights.uHeadlightEye,
      uLight1Dir: { value: new THREE.Vector3(...LIGHT1_DIR) },
      uLight2Dir: { value: new THREE.Vector3(...LIGHT2_DIR) },
      uLightAmbient: { value: new THREE.Vector3(...LIGHT_AMBIENT) },
      uLight0Diffuse: { value: new THREE.Vector3(...LIGHT0_DIFFUSE) },
      uLight0Specular: { value: new THREE.Vector3(...LIGHT0_SPECULAR) },
      uLight12Diffuse: { value: new THREE.Vector3(...LIGHT12_DIFFUSE) },
      uLight12Specular: { value: new THREE.Vector3(...LIGHT12_SPECULAR) },
    },
    side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: o.transparent ?? false,
    depthWrite: o.depthWrite ?? true,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  if (o.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = o.polygonOffset[0];
    mat.polygonOffsetUnits = o.polygonOffset[1];
  }
  return mat;
}

/**
 * An unlit, flat-colour material: `glDisable( GL_LIGHTING )` + `glColor4f`,
 * for the grid lines and the gizmo's labels/axes.
 */
export function makeUnlitMaterial(
  color: Vec3,
  alpha = 1,
  o: { depthTest?: boolean; depthWrite?: boolean } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec4 uColor;
      void main() { gl_FragColor = uColor; }
    `,
    uniforms: { uColor: { value: new THREE.Vector4(color[0], color[1], color[2], alpha) } },
    transparent: alpha < 1,
    depthTest: o.depthTest ?? true,
    depthWrite: o.depthWrite ?? true,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}

/**
 * An unlit per-vertex-colour material (the grid's two line colours in one
 * draw, the gizmo's coloured axes).
 */
export function makeVertexColorMaterial(o: { depthTest?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      varying vec4 vColor;
      void main() {
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec4 vColor;
      void main() { gl_FragColor = vColor; }
    `,
    transparent: true,
    depthTest: o.depthTest ?? true,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}
