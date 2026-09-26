// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/vertex_manager.h` + `.cpp`: `KIGFX::VERTEX_MANAGER`, the front
 * of the vertex pipeline - the current colour, shader parameters and
 * transformation applied to every vertex put into a container, and the
 * GPU_MANAGER that draws it. The glm::mat4 is a column-major Float32Array.
 */

import { cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Color4d } from '../../color4d.js';
import { GPU_MANAGER } from './gpu_manager.js';
import type { SHADER } from './shader.js';
import {
  COLOR_OFFSET,
  COLOR_STRIDE,
  SHADER_OFFSET,
  SHADER_STRIDE,
  type VERTEX,
  VERTEX_STRIDE,
} from './vertex_common.js';
import { VERTEX_CONTAINER } from './vertex_container.js';
import type { VERTEX_ITEM } from './vertex_item.js';
import { wxASSERT } from '@ziroeda/core/src/wx_assert.js';

/** `glm::mat4`, column-major. */
export type MAT4 = Float32Array;

function mat4Identity(): MAT4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** `glm::translate( m, v )` = m * T(v). */
function mat4Translate(m: MAT4, x: number, y: number, z: number): MAT4 {
  const r = new Float32Array(m);
  r[12] = Math.fround(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!);
  r[13] = Math.fround(m[1]! * x + m[5]! * y + m[9]! * z + m[13]!);
  r[14] = Math.fround(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
  r[15] = Math.fround(m[3]! * x + m[7]! * y + m[11]! * z + m[15]!);
  return r;
}

/** `glm::scale( m, v )` = m * S(v). */
function mat4Scale(m: MAT4, x: number, y: number, z: number): MAT4 {
  const r = new Float32Array(m);
  for (let i = 0; i < 4; i++) {
    r[i] = Math.fround(m[i]! * x);
    r[4 + i] = Math.fround(m[4 + i]! * y);
    r[8 + i] = Math.fround(m[8 + i]! * z);
  }
  return r;
}

/** `glm::rotate( m, angle, axis )` = m * R(angle, axis). */
function mat4Rotate(m: MAT4, angle: number, x: number, y: number, z: number): MAT4 {
  const a = Math.fround(angle);
  const c = Math.fround(cos(a));
  const s = Math.fround(sin(a));

  const len = Math.fround(Math.sqrt(x * x + y * y + z * z));
  const ax = Math.fround(x / len);
  const ay = Math.fround(y / len);
  const az = Math.fround(z / len);
  const tx = Math.fround((1 - c) * ax);
  const ty = Math.fround((1 - c) * ay);
  const tz = Math.fround((1 - c) * az);

  // Rotate[col][row]
  const r00 = Math.fround(c + tx * ax);
  const r01 = Math.fround(tx * ay + s * az);
  const r02 = Math.fround(tx * az - s * ay);
  const r10 = Math.fround(ty * ax - s * az);
  const r11 = Math.fround(c + ty * ay);
  const r12 = Math.fround(ty * az + s * ax);
  const r20 = Math.fround(tz * ax + s * ay);
  const r21 = Math.fround(tz * ay - s * ax);
  const r22 = Math.fround(c + tz * az);

  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    r[i] = Math.fround(m[i]! * r00 + m[4 + i]! * r01 + m[8 + i]! * r02);
    r[4 + i] = Math.fround(m[i]! * r10 + m[4 + i]! * r11 + m[8 + i]! * r12);
    r[8 + i] = Math.fround(m[i]! * r20 + m[4 + i]! * r21 + m[8 + i]! * r22);
    r[12 + i] = m[12 + i]!;
  }
  return r;
}

/**
 * Class to control vertex container and GPU with possibility of emulating old-style OpenGL
 * 1.0 state machine using modern OpenGL methods.
 */
export class VERTEX_MANAGER {
  /// Container for vertices, may be cached or noncached
  protected m_container: VERTEX_CONTAINER;

  /// GPU manager for data transfers and drawing operations
  protected m_gpu: GPU_MANAGER;

  /// State machine variables

  /// True in case there is no need to transform vertices
  protected m_noTransform: boolean;

  /// Currently used transform matrix
  protected m_transform: MAT4;

  /// Stack of transformation matrices, used for Push/PopMatrix
  protected m_transformStack: MAT4[] = [];

  /// Currently used color
  protected m_color: [number, number, number, number] = [0, 0, 0, 0];

  /// Currently used shader and its parameters
  protected m_shader: [number, number, number, number] = [0, 0, 0, 0];

  /// Currently reserved chunk to store vertices (an index, -1 for nullptr)
  protected m_reserved: number;

  /// Currently available reserved space
  protected m_reservedSpace: number;

  /**
   * @param aCached says if vertices should be cached in GPU or system memory. For data that
   *                does not change every frame, it is better to store vertices in GPU memory.
   */
  constructor(gl: WebGL2RenderingContext, aCached: boolean) {
    this.m_noTransform = true;
    this.m_transform = mat4Identity();
    this.m_reserved = -1;
    this.m_reservedSpace = 0;

    this.m_container = VERTEX_CONTAINER.MakeContainer(gl, aCached);
    this.m_gpu = GPU_MANAGER.MakeManager(gl, this.m_container);

    // There is no shader used by default
    for (let i = 0; i < SHADER_STRIDE; ++i) this.m_shader[i] = 0.0;
  }

  /** `~VERTEX_MANAGER`. */
  destroy(): void {
    this.m_container.destroy();
  }

  /**
   * Map vertex buffer.
   */
  Map(): void {
    this.m_container.Map();
  }

  /**
   * Unmap vertex buffer.
   */
  Unmap(): void {
    this.m_container.Unmap();
  }

  /**
   * Allocate space for vertices, so it will be used with subsequent Vertex() calls.
   *
   * @param aSize is the number of vertices that should be available in the reserved space.
   * @return True if successful, false otherwise.
   */
  Reserve(aSize: number): boolean {
    if (!aSize) return true;

    if (this.m_reservedSpace !== 0 || this.m_reserved !== -1) {
      if (VERTEX_MANAGER.show_err_reserve) {
        console.error('VERTEX_MANAGER::Reserve: Did not use all previous vertices allocated');
        VERTEX_MANAGER.show_err_reserve = false;
      }
    }

    this.m_reserved = this.m_container.Allocate(aSize);

    if (this.m_reserved === -1) {
      if (VERTEX_MANAGER.show_err_alloc) {
        console.error('VERTEX_MANAGER::Reserve: Vertex allocation error');
        VERTEX_MANAGER.show_err_alloc = false;
      }

      return false;
    }

    this.m_reservedSpace = aSize;

    return true;
  }

  // flags to avoid hanging by calling DisplayError too many times:
  private static show_err_reserve = true;
  private static show_err_alloc = true;
  private static show_err_vertex = true;
  private static show_err_vertices = true;

  /**
   * Add a vertex with the given coordinates to the currently set item.
   *
   * Color & shader parameters stored in aVertex are ignored, instead color & shader set
   * by Color() and Shader() functions are used. Vertex coordinates will have the current
   * transformation matrix applied.
   *
   * @param aX is the X coordinate of the new vertex.
   * @param aY is the Y coordinate of the new vertex.
   * @param aZ is the Z coordinate of the new vertex.
   * @return True if successful, false otherwise.
   */
  Vertex(aX: number, aY: number, aZ: number): boolean;
  Vertex(aXY: Vec2, aZ: number): boolean;
  Vertex(aVertex: VERTEX): boolean;
  Vertex(a: number | Vec2 | VERTEX, aY?: number, aZ?: number): boolean {
    if (typeof a !== 'number') {
      if (aY === undefined) {
        const v = a as VERTEX;
        return this.Vertex(v.x, v.y, v.z);
      }
      return this.Vertex(a.x, a.y, aY);
    }

    // Obtain the pointer to the vertex in the currently used container
    let newVertex: number;

    if (this.m_reservedSpace > 0) {
      newVertex = this.m_reserved++;
      --this.m_reservedSpace;

      if (this.m_reservedSpace === 0) this.m_reserved = -1;
    } else {
      newVertex = this.m_container.Allocate(1);

      if (newVertex === -1) {
        if (VERTEX_MANAGER.show_err_vertex) {
          console.error('VERTEX_MANAGER::Vertex: Vertex allocation error');
          VERTEX_MANAGER.show_err_vertex = false;
        }

        return false;
      }
    }

    this.putVertex(newVertex, a, aY!, aZ!);

    return true;
  }

  /**
   * Add one or more vertices to the currently set item.
   *
   * It takes advantage of allocating memory in advance, so should be faster than adding
   * vertices one by one. Color & shader parameters stored in aVertices are ignored, instead
   * color & shader set by Color() and Shader() functions are used. All the vertex
   * coordinates will have the current transformation matrix applied.
   *
   * @param aVertices contains vertices to be added.
   * @param aSize is the number of vertices to be added.
   * @return True if successful, false otherwise.
   */
  Vertices(aVertices: readonly VERTEX[], aSize: number): boolean {
    // Obtain pointer to the vertex in currently used container
    const newVertex = this.m_container.Allocate(aSize);

    if (newVertex === -1) {
      if (VERTEX_MANAGER.show_err_vertices) {
        console.error('VERTEX_MANAGER::Vertices: Vertex allocation error');
        VERTEX_MANAGER.show_err_vertices = false;
      }

      return false;
    }

    // Put vertices in already allocated memory chunk
    for (let i = 0; i < aSize; ++i) {
      this.putVertex(newVertex + i, aVertices[i]!.x, aVertices[i]!.y, aVertices[i]!.z);
    }

    return true;
  }

  /**
   * Change currently used color that will be applied to newly added vertices.
   *
   * @param aColor is the new color.
   */
  Color(aColor: Color4d): void;
  Color(aRed: number, aGreen: number, aBlue: number, aAlpha: number): void;
  Color(a: Color4d | number, aGreen?: number, aBlue?: number, aAlpha?: number): void {
    if (typeof a !== 'number') {
      // GLubyte = aColor.r * 255.0: the double narrowed to a byte
      this.m_color[0] = toGLubyte(a.r * 255.0);
      this.m_color[1] = toGLubyte(a.g * 255.0);
      this.m_color[2] = toGLubyte(a.b * 255.0);
      this.m_color[3] = toGLubyte(a.a * 255.0);
      return;
    }

    this.m_color[0] = toGLubyte(a * 255.0);
    this.m_color[1] = toGLubyte(aGreen! * 255.0);
    this.m_color[2] = toGLubyte(aBlue! * 255.0);
    this.m_color[3] = toGLubyte(aAlpha! * 255.0);
  }

  /**
   * Change currently used shader and its parameters that will be applied to newly added
   * vertices.
   *
   * Parameters depend on shader, for more information have a look at shaders source code.
   *
   * @see SHADER_TYPE
   *
   * @param aShaderType is the type of the shader.
   * @param aParam1 is the optional parameter.
   * @param aParam2 is the optional parameter.
   * @param aParam3 is the optional parameter.
   */
  Shader(aShaderType: number, aParam1 = 0.0, aParam2 = 0.0, aParam3 = 0.0): void {
    this.m_shader[0] = Math.fround(aShaderType);
    this.m_shader[1] = Math.fround(aParam1);
    this.m_shader[2] = Math.fround(aParam2);
    this.m_shader[3] = Math.fround(aParam3);
  }

  /**
   * Multiply the current matrix by a translation matrix, so newly vertices will be
   * translated by the given vector.
   *
   * The current matrix can be stored and restored using PushMatrix() and PopMatrix().
   *
   * @param aX is the X coordinate of a translation vector.
   * @param aY is the X coordinate of a translation vector.
   * @param aZ is the X coordinate of a translation vector.
   */
  Translate(aX: number, aY: number, aZ: number): void {
    this.m_transform = mat4Translate(this.m_transform, aX, aY, aZ);
  }

  /**
   * Multiply the current matrix by a rotation matrix, so the newly vertices will be
   * rotated by the given angles.
   *
   * The current matrix can be stored and restored using PushMatrix() and PopMatrix().
   *
   * @param aAngle is the angle (in radians).
   * @param aX is the X coordinate of a rotation axis.
   * @param aY is the Y coordinate of a rotation axis.
   * @param aZ is the Z coordinate of a rotation axis.
   */
  Rotate(aAngle: number, aX: number, aY: number, aZ: number): void {
    this.m_transform = mat4Rotate(this.m_transform, aAngle, aX, aY, aZ);
  }

  /**
   * Multiply the current matrix by a scaling matrix, so the newly vertices will be
   * scaled by the given factors.
   *
   * The current matrix can be stored and restored using PushMatrix() and PopMatrix().
   *
   * @param aX is the X axis scaling factor.
   * @param aY is the Y axis scaling factor.
   * @param aZ is the Z axis scaling factor.
   */
  Scale(aX: number, aY: number, aZ: number): void {
    this.m_transform = mat4Scale(this.m_transform, aX, aY, aZ);
  }

  /**
   * Push the current transformation matrix stack.
   */
  PushMatrix(): void {
    this.m_transformStack.push(this.m_transform);

    // Every transformation starts with PushMatrix
    this.m_noTransform = false;
  }

  /**
   * Pop the current transformation matrix stack.
   */
  PopMatrix(): void {
    wxASSERT(this.m_transformStack.length > 0);

    this.m_transform = this.m_transformStack.pop()!;

    if (this.m_transformStack.length === 0) {
      // We return back to the identity matrix, thus no vertex transformation is needed
      this.m_noTransform = true;
    }
  }

  /**
   * Set an item to start its modifications.
   *
   * After calling the function it is possible to add vertices using function Add().
   *
   * @param aItem is the item that is going to be modified.
   */
  SetItem(aItem: VERTEX_ITEM): void {
    this.m_container.SetItem(aItem);
  }

  /**
   * Clean after adding an item.
   */
  FinishItem(): void {
    if (this.m_reservedSpace !== 0 || this.m_reserved !== -1) {
      // wxLogTrace( traceVertexManager, "Did not use all previous vertices allocated" )
    }

    this.m_container.FinishItem();
  }

  /**
   * Free the memory occupied by the item, so it is no longer stored in the container.
   *
   * @param aItem is the item to be freed
   */
  FreeItem(aItem: VERTEX_ITEM): void {
    this.m_container.Delete(aItem);
  }

  /**
   * Change the color of all vertices owned by an item.
   *
   * @param aItem is the item to change.
   * @param aColor is the new color to be applied.
   */
  ChangeItemColor(aItem: VERTEX_ITEM, aColor: Color4d): void {
    const size = aItem.GetSize();
    const offset = aItem.GetOffset();

    const u8 = this.m_container.Storage().u8;
    let vertex = this.m_container.GetVertices(offset) * VERTEX_STRIDE * 4 + COLOR_OFFSET;

    for (let i = 0; i < size; ++i) {
      u8[vertex] = toGLubyte(aColor.r * 255.0);
      u8[vertex + 1] = toGLubyte(aColor.g * 255.0);
      u8[vertex + 2] = toGLubyte(aColor.b * 255.0);
      u8[vertex + 3] = toGLubyte(aColor.a * 255.0);
      vertex += VERTEX_STRIDE * 4;
    }

    this.m_container.SetDirtyRange(offset, size);
  }

  /**
   * Change the depth of all vertices owned by an item.
   *
   * @param aItem is the item to change.
   * @param aDepth is the new color to be applied.
   */
  ChangeItemDepth(aItem: VERTEX_ITEM, aDepth: number): void {
    const size = aItem.GetSize();
    const offset = aItem.GetOffset();

    const f32 = this.m_container.Storage().f32;
    let vertex = this.m_container.GetVertices(offset) * VERTEX_STRIDE;

    for (let i = 0; i < size; ++i) {
      f32[vertex + 2] = aDepth;
      vertex += VERTEX_STRIDE;
    }

    this.m_container.SetDirtyRange(offset, size);
  }

  /**
   * Return a pointer to the vertices owned by an item.
   *
   * @param aItem is the owner of vertices that are going to be returned.
   * @return Pointer to the vertices or -1 if the item is not stored at the container.
   */
  GetVertices(aItem: VERTEX_ITEM): number {
    if (aItem.GetSize() === 0) return -1; // The item is not stored in the container

    return this.m_container.GetVertices(aItem.GetOffset());
  }

  GetTransformation(): MAT4 {
    return this.m_transform;
  }

  /**
   * Set a shader program that is going to be used during rendering.
   *
   * @param aShader is the object containing compiled and linked shader program.
   */
  SetShader(aShader: SHADER): void {
    this.m_gpu.SetShader(aShader);
  }

  /**
   * Remove all the stored vertices from the container.
   */
  Clear(): void {
    this.m_container.Clear();
  }

  /**
   * Prepare buffers and items to start drawing.
   */
  BeginDrawing(): void {
    this.m_gpu.BeginDrawing();
  }

  /**
   * Draw an item to the buffer.
   *
   * @param aItem is the item to be drawn.
   */
  DrawItem(aItem: VERTEX_ITEM): void {
    this.m_gpu.DrawIndices(aItem);
  }

  /**
   * Finish drawing operations.
   */
  EndDrawing(): void {
    this.m_gpu.EndDrawing();
  }

  /**
   * Enable/disable Z buffer depth test.
   */
  EnableDepthTest(aEnabled: boolean): void {
    this.m_gpu.EnableDepthTest(aEnabled);
  }

  /**
   * Apply all transformation to the given coordinates and store them at the specified target.
   *
   * @param aTarget is the place where the new vertex is going to be stored (index).
   * @param aX is the X coordinate of the new vertex.
   * @param aY is the Y coordinate of the new vertex.
   * @param aZ is the Z coordinate of the new vertex.
   */
  protected putVertex(aTarget: number, aX: number, aY: number, aZ: number): void {
    const storage = this.m_container.Storage();
    const f32 = storage.f32;
    const u8 = storage.u8;
    const base = aTarget * VERTEX_STRIDE;

    // Modify the vertex according to the currently used transformations
    if (this.m_noTransform) {
      // Simply copy coordinates, when the transform matrix is the identity matrix
      f32[base] = aX;
      f32[base + 1] = aY;
      f32[base + 2] = aZ;
    } else {
      // Apply transformations
      const m = this.m_transform;
      const x = Math.fround(aX);
      const y = Math.fround(aY);
      const z = Math.fround(aZ);
      f32[base] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      f32[base + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      f32[base + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    }

    // Apply currently used color
    const cbase = aTarget * VERTEX_STRIDE * 4 + COLOR_OFFSET;
    for (let j = 0; j < COLOR_STRIDE; ++j) u8[cbase + j] = this.m_color[j]!;

    // Apply currently used shader
    const sbase = base + SHADER_OFFSET / 4;
    for (let j = 0; j < SHADER_STRIDE; ++j) f32[sbase + j] = this.m_shader[j]!;
  }
}

/** `GLubyte = double`: the conversion truncates and wraps modulo 256. */
function toGLubyte(v: number): number {
  return Math.trunc(v) & 0xff;
}
