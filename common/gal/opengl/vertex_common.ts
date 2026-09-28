// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/vertex_common.h`: the shader modes and the VERTEX layout the
 * OpenGL GAL packs its vertex buffers in. A `VERTEX*` in the C++ is an
 * index into a {@link VERTEX_STORAGE} here: the struct is 32 bytes -
 * three floats, four colour bytes, four shader floats - and the storage is
 * one ArrayBuffer with float and byte views over it, so the buffer can be
 * handed to `bufferData` as it is.
 */

///< Possible types of shaders (keep consistent with the actual shader source in
///< kicad_vert.glsl and kicad_frag.glsl).
export enum SHADER_MODE {
  SHADER_NONE = 0,
  SHADER_FILLED_CIRCLE = 2,
  SHADER_STROKED_CIRCLE = 3,
  SHADER_FONT = 4,
  SHADER_LINE_A = 5,
  SHADER_LINE_B = 6,
  SHADER_LINE_C = 7,
  SHADER_LINE_D = 8,
  SHADER_LINE_E = 9,
  SHADER_LINE_F = 10,
  SHADER_HOLE_WALL = 11,
}

///< Data structure for vertices {X,Y,Z,R,G,B,A,shader&param}
export interface VERTEX {
  x: number;
  y: number;
  z: number; // Coordinates
  r: number;
  g: number;
  b: number;
  a: number; // Color
  shader: [number, number, number, number]; // Shader type & params
}

const SIZEOF_GLFLOAT = 4;
const SIZEOF_GLUBYTE = 1;

export const VERTEX_SIZE = 32; // sizeof( VERTEX )
export const VERTEX_STRIDE = VERTEX_SIZE / SIZEOF_GLFLOAT;

export const COORD_OFFSET = 0; // offsetof( VERTEX, x )
export const COORD_SIZE = 3 * SIZEOF_GLFLOAT;
export const COORD_STRIDE = COORD_SIZE / SIZEOF_GLFLOAT;

export const COLOR_OFFSET = 12; // offsetof( VERTEX, r )
export const COLOR_SIZE = 4 * SIZEOF_GLUBYTE;
export const COLOR_STRIDE = COLOR_SIZE / SIZEOF_GLUBYTE;

// Shader attributes
export const SHADER_OFFSET = 16; // offsetof( VERTEX, shader )
export const SHADER_SIZE = 4 * SIZEOF_GLFLOAT;
export const SHADER_STRIDE = SHADER_SIZE / SIZEOF_GLFLOAT;

export const INDEX_SIZE = 4; // sizeof( GLuint )

/**
 * The memory a container's `VERTEX* m_vertices` points at: `aSize` VERTEX
 * structs in one ArrayBuffer, addressed by vertex index.
 */
export class VERTEX_STORAGE {
  buffer: ArrayBuffer;
  f32: Float32Array;
  u8: Uint8Array;

  constructor(aSize: number) {
    this.buffer = new ArrayBuffer(aSize * VERTEX_SIZE);
    this.f32 = new Float32Array(this.buffer);
    this.u8 = new Uint8Array(this.buffer);
  }

  /** `sizeof buffer / VERTEX_SIZE`. */
  get size(): number {
    return this.buffer.byteLength / VERTEX_SIZE;
  }

  /** `memcpy( &aTarget[aDstIndex], &m_vertices[aSrcIndex], aCount * VERTEX_SIZE )`. */
  static copy(
    aSrc: VERTEX_STORAGE,
    aSrcIndex: number,
    aDst: VERTEX_STORAGE,
    aDstIndex: number,
    aCount: number,
  ): void {
    aDst.u8.set(
      aSrc.u8.subarray(aSrcIndex * VERTEX_SIZE, (aSrcIndex + aCount) * VERTEX_SIZE),
      aDstIndex * VERTEX_SIZE,
    );
  }

  /** `memcpy` within one buffer (`realloc` keeps the prefix). */
  static grow(aSrc: VERTEX_STORAGE, aNewSize: number): VERTEX_STORAGE {
    const out = new VERTEX_STORAGE(aNewSize);
    out.u8.set(aSrc.u8.subarray(0, Math.min(aSrc.u8.length, out.u8.length)));
    return out;
  }
}
