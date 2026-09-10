// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `RENDER_3D_OPENGL`'s materials and lights (render_3d_opengl.cpp:190-450,
 * common_ogl/ogl_utils.cpp OglSetMaterial) — the fixed-function set the 3D
 * board is lit with.
 *
 * The two pixel tests at the end are the real check: KiCad's own 3D viewer,
 * top view, default theme, sampled from a screenshot — a pad reads
 * (255, 255, 71) and the soldermask over bare board reads (37, 69, 48). Both
 * fall out of the equation below to within a level, which is how the copper
 * colour was caught: with the `g_DefaultSurfaceFinish` (0.75, 0.61, 0.23) the
 * pad's blue channel comes out 0.70, not 0.28; with the colour THEME's
 * (0.7, 0.61, 0.0) it comes out 0.277.
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import {
  LIGHT1_DIR,
  LIGHT2_DIR,
  boardMaterials,
  diffuseOnlyMaterial,
  glShininess,
  headlightPosition,
  lightVertex,
  linearToSrgb,
  mapf,
  materialDiffuseToColorCAD,
  plasticMaterial,
  sphericalToCartesian,
  stepFaceMaterial,
  type AdapterColors,
} from '@ziroeda/designer/src/editors/pcb/gl_fixed_function.js';

const near = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 6): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, digits);
};

const T = BUILTIN_DEFAULT_THEME;
const THEME_COLORS: AdapterColors = {
  copper: T.LAYER_3D_COPPER_TOP,
  solderPaste: T.LAYER_3D_SOLDERPASTE,
  silkTop: T.LAYER_3D_SILKSCREEN_TOP,
  silkBottom: T.LAYER_3D_SILKSCREEN_BOTTOM,
  maskTop: T.LAYER_3D_SOLDERMASK_TOP,
  maskBottom: T.LAYER_3D_SOLDERMASK_BOTTOM,
  boardBody: T.LAYER_3D_BOARD,
};

describe('init_lights()', () => {
  it('has the head-light at 0.3 diffuse / 0.5 specular and the two fixed lights at 0.7, all 0.084 ambient', () => {
    // not re-derivable from anything — the literals at render_3d_opengl.cpp:404-416
    const m = lightVertex(
      {
        ambient: [1, 1, 1],
        diffuse: [0, 0, 0],
        specular: [0, 0, 0],
        emissive: [0, 0, 0],
        shininess: 0,
        transparency: 0,
      },
      [0, 0, 1],
      [0, 0, -16],
      [0, 0, 256],
      1,
    );
    // three lights' ambient on a unit-ambient material, no diffuse, no specular
    near(m, [0.252, 0.252, 0.252, 1]);
  });

  it('points GL_LIGHT1 at SphericalToCartesian( π·0.03, π·0.25 ) and GL_LIGHT2 at its z mirror', () => {
    const inc = Math.PI * 0.03,
      az = Math.PI * 0.25;
    near(sphericalToCartesian(inc, az), [
      Math.sin(inc) * Math.cos(az),
      Math.sin(inc) * Math.sin(az),
      Math.cos(inc),
    ]);
    near(LIGHT1_DIR, [0.066545, 0.066545, 0.995562], 5);
    near(LIGHT2_DIR, [0.066545, 0.066545, -0.995562], 5);
  });

  it('pushes the head-light out by z² so a skimming camera still lights the board', () => {
    near(headlightPosition([1, 2, 16]), [1, 2, 16 + 256]);
    near(headlightPosition([0, 0, 0.1]), [0, 0, 0.5 + 0.01]); // max( z, 0.5 ) + z²
    near(headlightPosition([0, 0, -3]), [0, 0, -3 - 9]);
    near(headlightPosition([0, 0, -0.1]), [0, 0, -0.5 - 0.01]);
  });
});

describe('setupMaterials()', () => {
  it('copper: 0.1·colour ambient, 0.75·colour + 0.25 specular, shininess from |r − g|', () => {
    const m = boardMaterials(THEME_COLORS).copper;
    near(m.ambient, [0.07, 0.061, 0]);
    near(m.diffuse, [0.7, 0.61, 0]);
    near(m.specular, [0.7 * 0.75 + 0.25, 0.61 * 0.75 + 0.25, 0.25]);
    // |0.7 − 0.61| = 0.09 clamps to the 0.15 floor of mapf → factor 0.4 → 51.2
    expect(m.shininess).toBeCloseTo(0.4 * 128, 9);
  });

  it('mapf clamps its input before mapping', () => {
    expect(mapf(0.09, 0.15, 1.0, 0.0, 0.3)).toBe(0);
    expect(mapf(1.5, 0.15, 1.0, 0.0, 0.3)).toBeCloseTo(0.3, 9);
    expect(mapf(0.575, 0.15, 1.0, 0.0, 0.3)).toBeCloseTo(0.15, 9);
  });

  it('a gold-ish copper (r − g = 0.35) is duller: factor 0.4 − 0.0706', () => {
    const m = boardMaterials({ ...THEME_COLORS, copper: { r: 0.9, g: 0.55, b: 0.1, a: 1 } }).copper;
    expect(m.shininess).toBeCloseTo((0.4 - ((0.35 - 0.15) * 0.3) / 0.85) * 128, 6);
  });

  it('soldermask: 0.3·colour ambient, colour² specular, transparency 1 − alpha', () => {
    const m = boardMaterials(THEME_COLORS).maskTop;
    near(m.diffuse, [0.08, 0.2, 0.14]);
    near(m.ambient, [0.024, 0.06, 0.042]);
    near(m.specular, [0.0064, 0.04, 0.0196]);
    expect(m.transparency).toBeCloseTo(0.17, 9);
    expect(m.shininess).toBeCloseTo(0.8 * 128, 9);
  });

  it('silkscreen: colour ambient, colour² + 0.1 specular; paste: colour ambient, colour² specular', () => {
    const b = boardMaterials(THEME_COLORS);
    near(b.silkTop.ambient, [0.9, 0.9, 0.9]);
    near(b.silkTop.specular, [0.91, 0.91, 0.91]);
    expect(b.silkTop.shininess).toBeCloseTo(0.078125 * 128, 9);
    near(b.paste.ambient, [0.5, 0.5, 0.5]);
    near(b.paste.specular, [0.25, 0.25, 0.25]);
  });

  it('epoxy: fixed (117,97,47)/255 ambient and (18,3,20)/255 specular around the body colour', () => {
    const m = boardMaterials(THEME_COLORS).epoxyBoard;
    near(m.ambient, [117 / 255, 97 / 255, 47 / 255]);
    near(m.specular, [18 / 255, 3 / 255, 20 / 255]);
    near(m.diffuse, [0.2, 0.17, 0.09]);
    expect(m.transparency).toBeCloseTo(0.1, 9);
  });

  it('raw copper is a constant (184,115,50)/255', () => {
    near(boardMaterials(THEME_COLORS).nonPlatedCopper.diffuse, [184 / 255, 115 / 255, 50 / 255]);
  });

  it('m_Plastic: 0.05·colour ambient, 0.7·colour specular', () => {
    const m = plasticMaterial([0.85, 0.85, 0.85]);
    near(m.ambient, [0.0425, 0.0425, 0.0425]);
    near(m.specular, [0.595, 0.595, 0.595]);
  });
});

describe('OglSetMaterial', () => {
  it('sets GL_SHININESS = 128 · min( 1, m_Shininess ) — every board material lands on 128', () => {
    const b = boardMaterials(THEME_COLORS);
    for (const m of [b.copper, b.nonPlatedCopper, b.paste, b.silkTop, b.maskTop, b.epoxyBoard])
      expect(glShininess(m)).toBe(128);
    expect(glShininess(plasticMaterial([1, 1, 1]))).toBe(128);
    // a model's file value is in 0..1 and scales
    expect(glShininess(stepFaceMaterial([1, 0, 0]))).toBeCloseTo(12.8, 9);
    expect(glShininess({ ...stepFaceMaterial([1, 0, 0]), shininess: 0.5 })).toBe(64);
    expect(glShininess(diffuseOnlyMaterial([1, 1, 1]))).toBe(0);
  });

  it('OglSetDiffuseMaterial: 0.2 ambient, no specular', () => {
    const m = diffuseOnlyMaterial([0.3, 0.6, 0.9]);
    near(m.ambient, [0.2, 0.2, 0.2]);
    near(m.specular, [0, 0, 0]);
    near(m.diffuse, [0.3, 0.6, 0.9]);
  });
});

describe('the STEP loader material and the colour encode', () => {
  it('a coloured face: 0.12 specular, 0.1 shininess, 0.1·diffuse ambient, alpha → transparency', () => {
    const m = stepFaceMaterial([0.148, 0.145, 0.145], 0.6);
    near(m.specular, [0.12, 0.12, 0.12]);
    expect(m.shininess).toBe(0.1);
    near(m.ambient, [0.0148, 0.0145, 0.0145]);
    expect(m.transparency).toBeCloseTo(0.4, 9);
  });

  it('the uncoloured default is 0.6 grey, 0.04 specular, 0.05 shininess', () => {
    const m = stepFaceMaterial([0, 0, 0], 1, false);
    near(m.diffuse, [0.6, 0.6, 0.6]);
    near(m.specular, [0.04, 0.04, 0.04]);
    expect(m.shininess).toBe(0.05);
  });

  it('linearToSrgb recovers the STEP file’s COLOUR_RGB from the .glb’s linear factor', () => {
    // D_DO-41 body: the file says 0.148; occt-import-js (and the .glb) hold 0.0192
    expect(linearToSrgb(0.0192)).toBeCloseTo(0.148, 2);
    expect(linearToSrgb(0.7776)).toBeCloseTo(0.895, 2);
    expect(linearToSrgb(0.002)).toBeCloseTo(12.92 * 0.002, 9);
    expect(linearToSrgb(1)).toBeCloseTo(1, 9);
  });

  it('MaterialDiffuseToColorCAD quantises luminance to quarters and keeps an eighth of the hue', () => {
    // pure red: gray 0.2126 → trunc(0.85)=0 → (0+0.5)/4 = 0.125; max 1 → r = 0.125 + 0.109
    near(materialDiffuseToColorCAD([1, 0, 0]), [
      0.125 + 0.125 * 0.875,
      0.125 * 0.875,
      0.125 * 0.875,
    ]);
    near(materialDiffuseToColorCAD([1, 1, 1]), [1, 1, 1]);
  });
});

describe('the lighting equation, checked against KiCad’s own pixels', () => {
  // Top view (camera rotation identity), the theme colours, the KiCad 10.0.5
  // screenshot taken on this machine: pad (255,255,71), mask over bare board
  // (37,69,48), background mid-frame ≈ (0.6, 0.6, 0.7).
  //
  // Eye space: the board top faces +z, the camera is at +Z looking down −z.
  // With the camera 25.8 units up (zoom 1.61, as the screenshot's "zoom 0.62"
  // says), the head-light sits at z = 25.8 + 25.8² in world → eye z 665.
  const N: [number, number, number] = [0, 0, 1];
  const P: [number, number, number] = [0, 0, -25.8];
  const HL: [number, number, number] = [0, 0, 25.8 + 25.8 * 25.8 - 25.8];

  it('a pad under the theme copper lights to (255, 255, 71)', () => {
    const b = boardMaterials(THEME_COLORS);
    const px = lightVertex(b.copper, N, P, HL, 1);
    expect(px[0]).toBe(1); // saturates
    expect(px[1]).toBe(1);
    expect(Math.round(px[2] * 255)).toBe(71);
    expect(px[3]).toBe(1);
  });

  it('the soldermask over the bare body lights to (37, 69, 48) once blended', () => {
    const b = boardMaterials(THEME_COLORS);
    const body = lightVertex(b.epoxyBoard, N, P, HL, 1 - b.epoxyBoard.transparency);
    const bg = [0.6, 0.6, 0.7];
    // renderBoardBody: GL_SRC_ALPHA / GL_ONE_MINUS_SRC_ALPHA over the gradient
    const bodyPx = bg.map((c, i) => body[i]! * body[3] + c * (1 - body[3]));
    const mask = lightVertex(b.maskTop, N, P, HL, 1 - b.maskTop.transparency);
    const maskPx = bodyPx.map((c, i) => mask[i]! * mask[3] + c * (1 - mask[3]));
    expect(Math.round(maskPx[0]! * 255)).toBe(38);
    expect(Math.round(maskPx[1]! * 255)).toBe(68);
    expect(Math.round(maskPx[2]! * 255)).toBe(48);
  });

  it('the g_DefaultSurfaceFinish copper would NOT match: its blue channel lights to 0.70', () => {
    const b = boardMaterials({ ...THEME_COLORS, copper: { r: 0.75, g: 0.61, b: 0.23, a: 1 } });
    const px = lightVertex(b.copper, N, P, HL, 1);
    expect(px[2]).toBeGreaterThan(0.69);
    expect(px[2]).toBeLessThan(0.71);
  });

  it('specular needs N·L > 0: a face turned away gets only ambient', () => {
    const b = boardMaterials(THEME_COLORS);
    const px = lightVertex(b.copper, [0, 0, -1], P, HL, 1);
    // ambient from all three lights + GL_LIGHT2 (from −z) diffuse and specular;
    // the head-light and GL_LIGHT1 contribute nothing but ambient
    const amb = 3 * 0.084;
    const nDotL2 = 0.995562;
    const H2 = [0.066545, 0.066545, -0.995562 + 1];
    const hLen = Math.hypot(...H2);
    const sp = (-H2[2]! / hLen) ** 128; // N·H with N = (0,0,−1): tiny
    expect(px[0]).toBeCloseTo(amb * 0.07 + nDotL2 * 0.7 * 0.7 + sp * 0.7 * (0.7 * 0.75 + 0.25), 5);
  });

  it('colour material: a model’s vertex colour replaces both ambient and diffuse', () => {
    const m = stepFaceMaterial([0.895, 0.891, 0.813]);
    const px = lightVertex(m, N, P, HL, 1, m.diffuse);
    const expectR = 3 * 0.084 * 0.895 + (0.3 + 0.7 * 0.995562) * 0.895;
    // + specular: 0.12 · ( 0.5 · 1 + 0.7 · (N·H1)^12.8 )
    const H1 = [0.066545, 0.066545, 1.995562];
    const nh = 1.995562 / Math.hypot(...H1);
    const spec = 0.12 * (0.5 + 0.7 * nh ** 12.8);
    expect(px[0]).toBeCloseTo(Math.min(1, expectR + spec), 4);
  });
});
