// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/gpu_manager.h` + `.cpp`: `KIGFX::GPU_MANAGER`, the class that
 * hands a container's vertices to the GPU and draws them.
 *
 * Two things the C++ does with client-side memory have no WebGL form and
 * are done with streaming GL buffers instead: the cached manager's index
 * array (`glDrawElements` from RAM) goes through an ELEMENT_ARRAY_BUFFER
 * uploaded per frame, and the non-cached container's vertices
 * (`glVertexPointer` on RAM) through an ARRAY_BUFFER uploaded per frame. The
 * fixed-function vertex/colour arrays are the `a_position` / `a_color`
 * attributes of the shader (kicad_vert.ts).
 */

import type { CACHED_CONTAINER } from './vertex_container.js';
import type { VERTEX_CONTAINER } from './vertex_container.js';
import type { SHADER } from './shader.js';
import {
  COLOR_OFFSET,
  COLOR_STRIDE,
  COORD_OFFSET,
  COORD_STRIDE,
  SHADER_OFFSET,
  SHADER_STRIDE,
  VERTEX_SIZE,
} from './vertex_common.js';
import type { VERTEX_ITEM } from './vertex_item.js';

/**
 * Class to handle uploading vertices and indices to GPU in drawing purposes.
 */
export abstract class GPU_MANAGER {
  ///< Drawing status flag.
  protected m_isDrawing: boolean;

  ///< Container that stores vertices data.
  protected m_container: VERTEX_CONTAINER;

  ///< Shader handling
  protected m_shader: SHADER | null;

  ///< Location of shader attributes (for glVertexAttribPointer)
  protected m_shaderAttrib: number;

  ///< The fixed pipeline's vertex and colour arrays, as attributes.
  protected m_positionAttrib: number;
  protected m_colorAttrib: number;

  ///< true: enable Z test when drawing
  protected m_enableDepthTest: boolean;

  static MakeManager(gl: WebGL2RenderingContext, aContainer: VERTEX_CONTAINER): GPU_MANAGER {
    if (aContainer.IsCached()) return new GPU_CACHED_MANAGER(gl, aContainer);

    return new GPU_NONCACHED_MANAGER(gl, aContainer);
  }

  protected constructor(
    protected readonly gl: WebGL2RenderingContext,
    aContainer: VERTEX_CONTAINER,
  ) {
    this.m_isDrawing = false;
    this.m_container = aContainer;
    this.m_shader = null;
    this.m_shaderAttrib = 0;
    this.m_positionAttrib = 0;
    this.m_colorAttrib = 0;
    this.m_enableDepthTest = true;
  }

  /**
   * Prepare the stored data to be drawn.
   */
  abstract BeginDrawing(): void;

  /**
   * Make the GPU draw given range of vertices.
   *
   * @param aItem is the vertex item to be drawn.
   */
  abstract DrawIndices(aItem: VERTEX_ITEM): void;

  /**
   * Clear the container after drawing routines.
   */
  abstract EndDrawing(): void;

  /**
   * Allow using shaders with the stored data.
   *
   * @param aShader is the object containing compiled and linked shader program.
   */
  SetShader(aShader: SHADER): void {
    this.m_shader = aShader;
    this.m_shaderAttrib = this.m_shader.GetAttribute('a_shaderParams');
    this.m_positionAttrib = this.m_shader.GetAttribute('a_position');
    this.m_colorAttrib = this.m_shader.GetAttribute('a_color');

    if (this.m_shaderAttrib === -1) {
      console.error('Could not get the shader attribute location');
    }
  }

  /**
   * Enable/disable Z buffer depth test.
   */
  EnableDepthTest(aEnabled: boolean): void {
    this.m_enableDepthTest = aEnabled;
  }

  /** `glEnableClientState( GL_VERTEX_ARRAY / GL_COLOR_ARRAY )` + the pointers, on the bound buffer. */
  protected enableVertexArrays(): void {
    const gl = this.gl;

    gl.enableVertexAttribArray(this.m_positionAttrib);
    gl.vertexAttribPointer(
      this.m_positionAttrib,
      COORD_STRIDE,
      gl.FLOAT,
      false,
      VERTEX_SIZE,
      COORD_OFFSET,
    );
    gl.enableVertexAttribArray(this.m_colorAttrib);
    gl.vertexAttribPointer(
      this.m_colorAttrib,
      COLOR_STRIDE,
      gl.UNSIGNED_BYTE,
      true,
      VERTEX_SIZE,
      COLOR_OFFSET,
    );
  }

  protected disableVertexArrays(): void {
    this.gl.disableVertexAttribArray(this.m_colorAttrib);
    this.gl.disableVertexAttribArray(this.m_positionAttrib);
  }
}

/** A range of vertex indices to render. */
class VRANGE {
  m_start: number;
  m_end: number;
  m_isContinuous: boolean;

  constructor(aStart: number, aEnd: number, aContinuous: boolean) {
    this.m_start = aStart;
    this.m_end = aEnd;
    this.m_isContinuous = aContinuous;
  }
}

export class GPU_CACHED_MANAGER extends GPU_MANAGER {
  ///< Buffers initialization flag
  protected m_buffersInitialized: boolean;

  ///< Pointer to the current indices buffer
  protected m_indices: Uint32Array;

  ///< Current indices buffer size
  protected m_indicesCapacity: number;

  ///< Ranges of visible vertex indices to render
  protected m_vranges: VRANGE[] = [];

  ///< Number of huge VRANGEs (i.e. large zones) with separate draw calls
  protected m_totalHuge: number;

  ///< Number of regular VRANGEs (small items) pooled into single draw call
  protected m_totalNormal: number;

  ///< Current size of index buffer
  protected m_indexBufSize: number;

  ///< Maximum size taken by the index buffer for all frames rendered so far
  protected m_indexBufMaxSize: number;

  ///< Size of the current VRANGE
  protected m_curVrangeSize: number;

  ///< The GL buffer the client-side index array is streamed through.
  protected m_indexBuffer: WebGLBuffer | null;

  constructor(gl: WebGL2RenderingContext, aContainer: VERTEX_CONTAINER) {
    super(gl, aContainer);
    this.m_buffersInitialized = false;
    this.m_indices = new Uint32Array(0);
    this.m_indicesCapacity = 0;
    this.m_totalHuge = 0;
    this.m_totalNormal = 0;
    this.m_indexBufSize = 0;
    this.m_indexBufMaxSize = 0;
    this.m_curVrangeSize = 0;
    this.m_indexBuffer = gl.createBuffer();
  }

  ///< @copydoc GPU_MANAGER::BeginDrawing()
  BeginDrawing(): void {
    console.assert(!this.m_isDrawing);

    this.m_curVrangeSize = 0;
    this.m_indexBufMaxSize = 0;
    this.m_indexBufSize = 0;
    this.m_vranges = [];

    this.m_isDrawing = true;
  }

  ///< @copydoc GPU_MANAGER::DrawIndices()
  DrawIndices(aItem: VERTEX_ITEM): void {
    // Hot path: don't use wxASSERT
    const offset = aItem.GetOffset();
    const size = aItem.GetSize();

    if (size === 0) return;

    if (size <= 1000) {
      this.m_totalNormal += size;
      this.m_vranges.push(new VRANGE(offset, offset + size - 1, false));
      this.m_curVrangeSize += size;
    } else {
      this.m_totalHuge += size;
      this.m_vranges.push(new VRANGE(offset, offset + size - 1, true));
      this.m_indexBufSize = Math.max(this.m_curVrangeSize, this.m_indexBufSize);
      this.m_curVrangeSize = 0;
    }
  }

  ///< @copydoc GPU_MANAGER::EndDrawing()
  EndDrawing(): void {
    console.assert(this.m_isDrawing);
    const gl = this.gl;

    const cached = this.m_container as CACHED_CONTAINER;

    if (cached.IsMapped()) cached.Unmap();

    this.m_indexBufSize = Math.max(this.m_curVrangeSize, this.m_indexBufSize);
    this.m_indexBufMaxSize = Math.max(2 * this.m_indexBufSize, this.m_indexBufMaxSize);
    this.resizeIndices(this.m_indexBufMaxSize);

    if (this.m_enableDepthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);

    // Prepare buffers
    // Bind vertices data buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, cached.GetBufferHandle());

    if (this.m_shader !== null) {
      // Use shader if applicable
      this.m_shader.Use();
      gl.enableVertexAttribArray(this.m_shaderAttrib);
      gl.vertexAttribPointer(
        this.m_shaderAttrib,
        SHADER_STRIDE,
        gl.FLOAT,
        false,
        VERTEX_SIZE,
        SHADER_OFFSET,
      );
    }

    this.enableVertexArrays();

    const n_ranges = this.m_vranges.length;
    let n = 0;
    let iptr = 0;
    let icnt = 0;

    let drawCalls = 0;

    const drawElements = (): void => {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.m_indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.m_indices.subarray(0, icnt), gl.STREAM_DRAW);
      gl.drawElements(gl.TRIANGLES, icnt, gl.UNSIGNED_INT, 0);
    };

    while (n < n_ranges) {
      const cur = this.m_vranges[n]!;

      if (cur.m_isContinuous) {
        if (icnt > 0) {
          drawElements();
          drawCalls++;
        }

        icnt = 0;
        iptr = 0;

        gl.drawArrays(gl.TRIANGLES, cur.m_start, cur.m_end - cur.m_start + 1);
        drawCalls++;
      } else {
        for (let i = cur.m_start; i <= cur.m_end; i++) {
          this.m_indices[iptr++] = i;
          icnt++;
        }
      }

      n++;
    }

    if (icnt > 0) {
      drawElements();
      drawCalls++;
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    cached.ClearDirty();

    // Deactivate vertex array
    this.disableVertexArrays();

    if (this.m_shader !== null) {
      gl.disableVertexAttribArray(this.m_shaderAttrib);
      this.m_shader.Deactivate();
    }

    this.m_isDrawing = false;
  }

  ///< Resizes the indices buffer to aNewSize if necessary
  protected resizeIndices(aNewSize: number): void {
    if (aNewSize > this.m_indicesCapacity) {
      this.m_indicesCapacity = aNewSize;
      this.m_indices = new Uint32Array(this.m_indicesCapacity);
    }
  }
}

export class GPU_NONCACHED_MANAGER extends GPU_MANAGER {
  ///< The GL buffer the client-side vertex array is streamed through.
  protected m_vertexBuffer: WebGLBuffer | null;

  constructor(gl: WebGL2RenderingContext, aContainer: VERTEX_CONTAINER) {
    super(gl, aContainer);
    this.m_vertexBuffer = gl.createBuffer();
  }

  ///< @copydoc GPU_MANAGER::BeginDrawing()
  BeginDrawing(): void {
    // Nothing has to be prepared
  }

  ///< @copydoc GPU_MANAGER::DrawIndices()
  DrawIndices(aItem: VERTEX_ITEM): void {
    console.assert(false, 'Not implemented yet');
  }

  ///< @copydoc GPU_MANAGER::EndDrawing()
  EndDrawing(): void {
    const gl = this.gl;

    if (this.m_container.GetSize() === 0) return;

    const vertices = this.m_container.GetAllVertices()!;

    if (this.m_enableDepthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);

    // Prepare buffers: the client-side arrays, streamed to the GPU
    gl.bindBuffer(gl.ARRAY_BUFFER, this.m_vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      vertices.u8.subarray(0, this.m_container.GetSize() * VERTEX_SIZE),
      gl.STREAM_DRAW,
    );

    if (this.m_shader !== null) {
      // Use shader if applicable
      this.m_shader.Use();
      gl.enableVertexAttribArray(this.m_shaderAttrib);
      gl.vertexAttribPointer(
        this.m_shaderAttrib,
        SHADER_STRIDE,
        gl.FLOAT,
        false,
        VERTEX_SIZE,
        SHADER_OFFSET,
      );
    }

    this.enableVertexArrays();

    gl.drawArrays(gl.TRIANGLES, 0, this.m_container.GetSize());

    // Deactivate vertex array
    this.disableVertexArrays();

    if (this.m_shader !== null) {
      gl.disableVertexAttribArray(this.m_shaderAttrib);
      this.m_shader.Deactivate();
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.m_container.Clear();
  }
}
