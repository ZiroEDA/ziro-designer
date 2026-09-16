// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The OpenGL 2.1 fixed-function state the OpenGL GAL still uses, over
 * WebGL2, which has none of it:
 *
 *  - the PROJECTION / MODELVIEW / TEXTURE matrix stacks (`glMatrixMode`,
 *    `glLoadIdentity`, `glLoadMatrixd`, `glMultMatrixd`, `glPushMatrix`,
 *    `glPopMatrix`, `glTranslated`, `glRotated`, `glOrtho`), from which the
 *    GAL shader's `gl_ModelViewProjectionMatrix` is computed;
 *  - the current colour and texture coordinate (`glColor4d`, `glTexCoord2f`);
 *  - immediate mode (`glBegin` / `glVertex` / `glEnd`) for GL_TRIANGLES,
 *    GL_QUADS and GL_LINES, drawn either through the program currently in
 *    use (the SMAA and XOR passes read `gl_Vertex` / `gl_MultiTexCoord0`,
 *    here `a_position` / `a_texCoord`) or, with none, through a program
 *    standing in for the fixed pipeline: `GL_TEXTURE_2D` with `GL_MODULATE`
 *    and `GL_ALPHA_TEST` with `GL_GREATER`.
 *
 * Every call here is one the C++ makes; nothing is added.
 */

import { cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import type { MATRIX3x3D } from '@ziroeda/kimath/src/math/matrix3x3.js';

export enum GL_MATRIX_MODE {
  GL_MODELVIEW = 0x1700,
  GL_PROJECTION = 0x1701,
  GL_TEXTURE = 0x1702,
}

export enum GL_BEGIN_MODE {
  GL_LINES = 0x0001,
  GL_TRIANGLES = 0x0004,
  GL_QUADS = 0x0007,
}

/** A column-major 4x4 double matrix, as `glLoadMatrixd` takes it. */
export type GLMAT4 = Float64Array;

function identity(): GLMAT4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a * b, column-major. */
function multiply(a: GLMAT4, b: GLMAT4): GLMAT4 {
  const r = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row]! * b[col * 4 + k]!;
      r[col * 4 + row] = s;
    }
  }
  return r;
}

const FIXED_VERT = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_texCoord;
in vec4 a_color;
uniform mat4 u_modelViewProjection;
uniform mat4 u_textureMatrix;
out vec2 v_texCoord;
out vec4 v_color;
void main()
{
    v_texCoord = ( u_textureMatrix * vec4( a_texCoord, 0.0, 1.0 ) ).xy;
    v_color = a_color;
    gl_Position = u_modelViewProjection * vec4( a_position, 1.0 );
}
`;

const FIXED_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform bool u_textureEnabled;
uniform bool u_alphaTest;
uniform float u_alphaRef;
in vec2 v_texCoord;
in vec4 v_color;
out vec4 fragColor;
void main()
{
    // GL_TEXTURE_ENV_MODE GL_MODULATE
    vec4 color = u_textureEnabled ? v_color * texture( u_texture, v_texCoord ) : v_color;

    // glAlphaFunc( GL_GREATER, ref )
    if( u_alphaTest && !( color.a > u_alphaRef ) )
        discard;

    fragColor = color;
}
`;

export class GL_FIXED_FUNCTION {
  private m_mode: GL_MATRIX_MODE = GL_MATRIX_MODE.GL_MODELVIEW;
  private m_matrices: Map<GL_MATRIX_MODE, GLMAT4> = new Map([
    [GL_MATRIX_MODE.GL_MODELVIEW, identity()],
    [GL_MATRIX_MODE.GL_PROJECTION, identity()],
    [GL_MATRIX_MODE.GL_TEXTURE, identity()],
  ]);
  private m_stacks: Map<GL_MATRIX_MODE, GLMAT4[]> = new Map([
    [GL_MATRIX_MODE.GL_MODELVIEW, []],
    [GL_MATRIX_MODE.GL_PROJECTION, []],
    [GL_MATRIX_MODE.GL_TEXTURE, []],
  ]);

  private m_color: [number, number, number, number] = [1, 1, 1, 1];
  private m_texCoord: [number, number] = [0, 0];
  private m_texture2DEnabled = false;
  private m_alphaTestEnabled = false;
  private m_alphaRef = 0;

  // Immediate mode
  private m_beginMode: GL_BEGIN_MODE | null = null;
  private m_immediate: number[] = []; // x y z s t r g b a per vertex
  private m_immediateBuffer: WebGLBuffer | null;

  // The stand-in program
  private m_program: WebGLProgram | null = null;
  private u_modelViewProjection: WebGLUniformLocation | null = null;
  private u_textureMatrix: WebGLUniformLocation | null = null;
  private u_texture: WebGLUniformLocation | null = null;
  private u_textureEnabled: WebGLUniformLocation | null = null;
  private u_alphaTest: WebGLUniformLocation | null = null;
  private u_alphaRef: WebGLUniformLocation | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.m_immediateBuffer = gl.createBuffer();
  }

  destroy(): void {
    this.gl.deleteBuffer(this.m_immediateBuffer);
    if (this.m_program) this.gl.deleteProgram(this.m_program);
  }

  // ---- matrices ----

  glMatrixMode(aMode: GL_MATRIX_MODE): void {
    this.m_mode = aMode;
  }

  glLoadIdentity(): void {
    this.m_matrices.set(this.m_mode, identity());
  }

  glLoadMatrixd(aMatrix: ArrayLike<number>): void {
    this.m_matrices.set(this.m_mode, Float64Array.from(aMatrix));
  }

  glMultMatrixd(aMatrix: ArrayLike<number>): void {
    this.m_matrices.set(this.m_mode, multiply(this.current(), Float64Array.from(aMatrix)));
  }

  glPushMatrix(): void {
    this.m_stacks.get(this.m_mode)!.push(Float64Array.from(this.current()));
  }

  glPopMatrix(): void {
    const stack = this.m_stacks.get(this.m_mode)!;
    console.assert(stack.length > 0, 'GL_STACK_UNDERFLOW');
    this.m_matrices.set(this.m_mode, stack.pop()!);
  }

  glTranslated(x: number, y: number, z: number): void {
    const t = identity();
    t[12] = x;
    t[13] = y;
    t[14] = z;
    this.glMultMatrixd(t);
  }

  glRotated(aAngleDegrees: number, x: number, y: number, z: number): void {
    const a = (aAngleDegrees * Math.PI) / 180;
    const c = cos(a);
    const s = sin(a);
    const len = Math.sqrt(x * x + y * y + z * z);
    const ax = x / len;
    const ay = y / len;
    const az = z / len;
    const r = identity();
    r[0] = ax * ax * (1 - c) + c;
    r[1] = ay * ax * (1 - c) + az * s;
    r[2] = ax * az * (1 - c) - ay * s;
    r[4] = ax * ay * (1 - c) - az * s;
    r[5] = ay * ay * (1 - c) + c;
    r[6] = ay * az * (1 - c) + ax * s;
    r[8] = ax * az * (1 - c) + ay * s;
    r[9] = ay * az * (1 - c) - ax * s;
    r[10] = az * az * (1 - c) + c;
    this.glMultMatrixd(r);
  }

  glOrtho(l: number, r: number, b: number, t: number, n: number, f: number): void {
    const o = identity();
    o[0] = 2 / (r - l);
    o[5] = 2 / (t - b);
    o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l);
    o[13] = -(t + b) / (t - b);
    o[14] = -(f + n) / (f - n);
    this.glMultMatrixd(o);
  }

  /** `gl_ModelViewProjectionMatrix`, for the programs that read it. */
  modelViewProjection(): Float32Array {
    return Float32Array.from(
      multiply(
        this.m_matrices.get(GL_MATRIX_MODE.GL_PROJECTION)!,
        this.m_matrices.get(GL_MATRIX_MODE.GL_MODELVIEW)!,
      ),
    );
  }

  /** The 16 doubles `glLoadMatrixd` is given for a MATRIX3x3D, as the GAL builds them. */
  static matrixData(aTransformation: MATRIX3x3D): Float64Array {
    const matrixData = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const m = aTransformation.m_data;
    matrixData[0] = m[0][0];
    matrixData[1] = m[1][0];
    matrixData[2] = m[2][0];
    matrixData[4] = m[0][1];
    matrixData[5] = m[1][1];
    matrixData[6] = m[2][1];
    matrixData[12] = m[0][2];
    matrixData[13] = m[1][2];
    matrixData[14] = m[2][2];
    return matrixData;
  }

  private current(): GLMAT4 {
    return this.m_matrices.get(this.m_mode)!;
  }

  // ---- current state ----

  glColor4d(r: number, g: number, b: number, a: number): void {
    this.m_color = [r, g, b, a];
  }

  glTexCoord2f(s: number, t: number): void {
    this.m_texCoord = [s, t];
  }

  /** `glEnable( GL_TEXTURE_2D )` / `glDisable`. */
  glEnableTexture2D(aEnable: boolean): void {
    this.m_texture2DEnabled = aEnable;
  }

  /** `glEnable( GL_ALPHA_TEST )` / `glDisable`. */
  glEnableAlphaTest(aEnable: boolean): void {
    this.m_alphaTestEnabled = aEnable;
  }

  /** `glAlphaFunc( GL_GREATER, aRef )`. */
  glAlphaFunc(aRef: number): void {
    this.m_alphaRef = aRef;
  }

  // ---- immediate mode ----

  glBegin(aMode: GL_BEGIN_MODE): void {
    console.assert(this.m_beginMode === null);
    this.m_beginMode = aMode;
    this.m_immediate = [];
  }

  glVertex2f(x: number, y: number): void {
    this.glVertex3f(x, y, 0);
  }

  glVertex2d(x: number, y: number): void {
    this.glVertex3f(x, y, 0);
  }

  glVertex3f(x: number, y: number, z: number): void {
    this.m_immediate.push(
      x,
      y,
      z,
      this.m_texCoord[0],
      this.m_texCoord[1],
      this.m_color[0],
      this.m_color[1],
      this.m_color[2],
      this.m_color[3],
    );
  }

  glEnd(): void {
    const gl = this.gl;
    const mode = this.m_beginMode;
    console.assert(mode !== null);
    this.m_beginMode = null;

    let data = this.m_immediate;
    let primitive: number = gl.TRIANGLES;

    if (mode === GL_BEGIN_MODE.GL_QUADS) {
      // A quad is two triangles: 0 1 2, 0 2 3
      const quads: number[] = [];
      for (let q = 0; q + 36 <= data.length; q += 36) {
        for (const i of [0, 1, 2, 0, 2, 3]) quads.push(...data.slice(q + i * 9, q + i * 9 + 9));
      }
      data = quads;
    } else if (mode === GL_BEGIN_MODE.GL_LINES) {
      primitive = gl.LINES;
    }

    const count = data.length / 9;

    if (count === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.m_immediateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);

    // The program the fixed pipeline feeds: the one in use, or the stand-in
    let program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;

    if (!program) {
      program = this.program();
      gl.useProgram(program);
      gl.uniformMatrix4fv(this.u_modelViewProjection, false, this.modelViewProjection());
      gl.uniformMatrix4fv(
        this.u_textureMatrix,
        false,
        Float32Array.from(this.m_matrices.get(GL_MATRIX_MODE.GL_TEXTURE)!),
      );
      gl.uniform1i(this.u_texture, 0);
      gl.uniform1i(this.u_textureEnabled, this.m_texture2DEnabled ? 1 : 0);
      gl.uniform1i(this.u_alphaTest, this.m_alphaTestEnabled ? 1 : 0);
      gl.uniform1f(this.u_alphaRef, this.m_alphaRef);
    }

    const stride = 9 * 4;
    const enabled: number[] = [];
    const attrib = (name: string, size: number, offset: number): void => {
      const loc = gl.getAttribLocation(program!, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      enabled.push(loc);
    };
    attrib('a_position', 3, 0);
    attrib('a_texCoord', 2, 12);
    attrib('a_color', 4, 20);

    gl.drawArrays(primitive, 0, count);

    for (const loc of enabled) gl.disableVertexAttribArray(loc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    if (program === this.m_program) gl.useProgram(null);
  }

  private program(): WebGLProgram {
    if (this.m_program) return this.m_program;

    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) ?? 'fixed-function shader');
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FIXED_VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FIXED_FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'fixed-function program');

    this.m_program = program;
    this.u_modelViewProjection = gl.getUniformLocation(program, 'u_modelViewProjection');
    this.u_textureMatrix = gl.getUniformLocation(program, 'u_textureMatrix');
    this.u_texture = gl.getUniformLocation(program, 'u_texture');
    this.u_textureEnabled = gl.getUniformLocation(program, 'u_textureEnabled');
    this.u_alphaTest = gl.getUniformLocation(program, 'u_alphaTest');
    this.u_alphaRef = gl.getUniformLocation(program, 'u_alphaRef');
    return program;
  }
}
