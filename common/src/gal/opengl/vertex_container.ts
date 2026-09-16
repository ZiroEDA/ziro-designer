// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/vertex_container.h` + `.cpp`, `noncached_container.h` + `.cpp`,
 * `cached_container.h` + `.cpp`, `cached_container_ram.h` + `.cpp` and
 * `cached_container_gpu.h` + `.cpp`: the stores of vertices a VERTEX_MANAGER
 * fills. One module, because `MakeContainer` names the subclasses and a
 * subclass module importing its base back would leave `extends` undefined
 * mid-cycle.
 */

import { checkGlError } from './utils.js';
import { VERTEX_SIZE, VERTEX_STORAGE } from './vertex_common.js';
import type { VERTEX_ITEM } from './vertex_item.js';

export abstract class VERTEX_CONTAINER {
  ///< Free space left in the container, expressed in vertices
  protected m_freeSpace: number;

  ///< Current container size, expressed in vertices
  protected m_currentSize: number;

  ///< Store the initial size, so it can be resized to this on Clear()
  protected m_initialSize: number;

  ///< Actual storage memory
  protected m_vertices: VERTEX_STORAGE | null;

  // Status flags
  protected m_failed: boolean;
  protected m_dirty: boolean;

  ///< Default initial size of a container (expressed in vertices)
  static readonly DEFAULT_SIZE = 1048576;

  /**
   * Return a pointer to a new container of an appropriate type.
   *
   * WebGL has no buffer mapping, which is the reason the C++ picks
   * CACHED_CONTAINER_RAM for the drivers that cannot map (X.Org, nouveau);
   * the same choice is made here for every context.
   */
  static MakeContainer(aGl: WebGL2RenderingContext, aCached: boolean): VERTEX_CONTAINER {
    if (aCached) {
      // Open source drivers do not cope well with GPU memory mapping,
      // so the vertex data has to be kept in RAM
      return new CACHED_CONTAINER_RAM(aGl);
    }

    return new NONCACHED_CONTAINER(aGl);
  }

  protected constructor(aSize: number = VERTEX_CONTAINER.DEFAULT_SIZE) {
    this.m_freeSpace = aSize;
    this.m_currentSize = aSize;
    this.m_initialSize = aSize;
    this.m_vertices = null;
    this.m_failed = false;
    this.m_dirty = true;
  }

  /** `~VERTEX_CONTAINER`. */
  destroy(): void {}

  /**
   * Return true if the container is cached, i.e. it does not need to be
   * recreated every frame.
   */
  abstract IsCached(): boolean;

  /**
   * Prepare the container for vertices updates.
   */
  Map(): void {}

  /**
   * Finish the vertices updates stage.
   */
  Unmap(): void {}

  /**
   * Set the item in order to modify or finishes its current modifications.
   *
   * @param aItem is the item or NULL in case of finishing the item.
   */
  abstract SetItem(aItem: VERTEX_ITEM | null): void;

  /**
   * Clean up after adding an item.
   */
  FinishItem(): void {}

  /**
   * Return allocated space for the requested number of vertices associated with the
   * current item (set with SetItem()).
   *
   * The allocated space is added at the end of the chunk used by the current item and
   * may serve to store new vertices.
   *
   * @param aSize is the number of vertices to be allocated.
   * @return Index of the allocated space, or -1 in case of failure (the C++ null pointer).
   */
  abstract Allocate(aSize: number): number;

  /**
   * Erase the selected item.
   *
   * @param aItem is the item to be erased.
   */
  abstract Delete(aItem: VERTEX_ITEM): void;

  /**
   * Remove all data stored in the container and restores its original state.
   */
  abstract Clear(): void;

  /**
   * Return pointer to the vertices stored in the container.
   */
  GetAllVertices(): VERTEX_STORAGE | null {
    return this.m_vertices;
  }

  /**
   * Return vertices stored at the specific offset.
   *
   * @param aOffset is the offset.
   */
  GetVertices(aOffset: number): number {
    return aOffset;
  }

  /**
   * Return the storage the indices address.
   */
  Storage(): VERTEX_STORAGE {
    return this.m_vertices!;
  }

  /**
   * Return the current size of the container, expressed in vertices.
   */
  GetSize(): number {
    return this.m_currentSize;
  }

  /**
   * Return information about the container cache state.
   *
   * @return True in case the vertices have to be reuploaded.
   */
  IsDirty(): boolean {
    return this.m_dirty;
  }

  /**
   * Set the dirty flag, so vertices in the container are going to be reuploaded to the GPU on
   * the next frame.
   */
  SetDirty(): void {
    this.m_dirty = true;
  }

  /**
   * Clear the dirty flag to prevent reuploading vertices to the GPU memory.
   */
  ClearDirty(): void {
    this.m_dirty = false;
  }

  /**
   * Return size of the used memory space.
   *
   * @return Size of the used memory space (expressed as a number of vertices).
   */
  protected usedSpace(): number {
    return this.m_currentSize - this.m_freeSpace;
  }
}

/**
 * Class to store instances of VERTEX without caching.
 *
 * The data is not stored in GPU memory.
 */
export class NONCACHED_CONTAINER extends VERTEX_CONTAINER {
  ///< Index of the free first space where a vertex can be stored
  protected m_freePtr: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    aSize: number = VERTEX_CONTAINER.DEFAULT_SIZE,
  ) {
    super(aSize);
    this.m_freePtr = 0;

    // malloc + memset( 0x00 ): a fresh ArrayBuffer is zeroed
    this.m_vertices = new VERTEX_STORAGE(aSize);
  }

  IsCached(): boolean {
    return false;
  }

  /// @copydoc VERTEX_CONTAINER::SetItem( VERTEX_ITEM* aItem )
  SetItem(aItem: VERTEX_ITEM | null): void {
    // Nothing has to be done, as the noncached container
    // does not care about VERTEX_ITEMs ownership
  }

  /// @copydoc VERTEX_CONTAINER::Allocate( unsigned int aSize )
  Allocate(aSize: number): number {
    if (this.m_freeSpace < aSize) {
      // Double the space
      const newVertices = VERTEX_STORAGE.grow(this.m_vertices!, this.m_currentSize * 2);

      this.m_vertices = newVertices;
      this.m_freeSpace += this.m_currentSize;
      this.m_currentSize *= 2;
    }

    const freeVertex = this.m_freePtr;

    // Move to the next free chunk
    this.m_freePtr += aSize;
    this.m_freeSpace -= aSize;

    return freeVertex;
  }

  /// @copydoc VERTEX_CONTAINER::Delete( VERTEX_ITEM* aItem )
  Delete(aItem: VERTEX_ITEM): void {}

  /// @copydoc VERTEX_CONTAINER::Clear()
  Clear(): void {
    this.m_freePtr = 0;
    this.m_freeSpace = this.m_currentSize;
  }

  /// @copydoc VERTEX_CONTAINER::GetSize()
  override GetSize(): number {
    // As the m_freePtr points to the first free space, we can safely assume
    // that this is the number of vertices stored inside
    return this.m_freePtr;
  }
}

///< Maps size of free memory chunks to their offsets: [size, offset]
type CHUNK = [number, number];

/**
 * Class to store VERTEX instances with caching.
 *
 * It allows storing VERTEX_ITEM instances with caching. It also has the ability to
 * allocate space on the fly, along with automatic resizing and defragmentation.
 */
export abstract class CACHED_CONTAINER extends VERTEX_CONTAINER {
  ///< Store size & offset of free chunks. A std::multimap keyed on size: kept sorted by
  ///< size, so `lower_bound( aSize )` is the first chunk at least that big.
  protected m_freeChunks: CHUNK[] = [];

  ///< Stored VERTEX_ITEMs (a std::set: iterated in insertion order here, which the
  ///< defragmentation's compaction order follows).
  protected m_items: Set<VERTEX_ITEM> = new Set();

  ///< Currently modified item
  protected m_item: VERTEX_ITEM | null;

  ///< Properties of currently modified chunk & item
  protected m_chunkSize: number;
  protected m_chunkOffset: number;

  ///< Maximal vertex index number stored in the container
  protected m_maxIndex: number;

  protected constructor(aSize: number = VERTEX_CONTAINER.DEFAULT_SIZE) {
    super(aSize);
    this.m_item = null;
    this.m_chunkSize = 0;
    this.m_chunkOffset = 0;
    this.m_maxIndex = 0;

    // In the beginning there is only free space
    this.insertFreeChunk(aSize, 0);
  }

  IsCached(): boolean {
    return true;
  }

  SetItem(aItem: VERTEX_ITEM | null): void {
    console.assert(aItem !== null);

    const itemSize = aItem!.GetSize();
    this.m_item = aItem;
    this.m_chunkSize = itemSize;

    // Get the previously set offset if the item was stored previously
    this.m_chunkOffset = itemSize > 0 ? aItem!.GetOffset() : -1;
  }

  ///< @copydoc VERTEX_CONTAINER::FinishItem()
  override FinishItem(): void {
    console.assert(this.m_item !== null);

    const itemSize = this.m_item!.GetSize();

    // Finishing the previously edited item
    if (itemSize < this.m_chunkSize) {
      // There is some not used but reserved memory left, so we should return it to the pool
      const itemOffset = this.m_item!.GetOffset();

      // Add the not used memory back to the pool
      this.addFreeChunk(itemOffset + itemSize, this.m_chunkSize - itemSize);
      // mergeFreeChunks();   // veery slow and buggy

      this.m_maxIndex = Math.max(itemOffset + itemSize, this.m_maxIndex);
    }

    if (itemSize > 0) this.m_items.add(this.m_item!);

    this.m_item = null;
    this.m_chunkSize = 0;
    this.m_chunkOffset = 0;
  }

  Allocate(aSize: number): number {
    console.assert(this.m_item !== null);
    console.assert(this.IsMapped());

    if (this.m_failed) return -1;

    const itemSize = this.m_item!.GetSize();
    const newSize = itemSize + aSize;

    if (newSize > this.m_chunkSize) {
      // There is not enough space in the currently reserved chunk, so we have to resize it
      if (!this.reallocate(newSize)) {
        this.m_failed = true;
        return -1;
      }
    }

    // Guard against a null vertex buffer (can occur if the GPU mapping was silently
    // invalidated, e.g. on macOS under memory pressure).
    if (!this.m_vertices) {
      this.m_failed = true;
      return -1;
    }

    const reserved = this.m_chunkOffset + itemSize;

    // Now the item officially possesses the memory chunk
    this.m_item!.setSize(newSize);

    // The content has to be updated
    this.m_dirty = true;

    return reserved;
  }

  ///< @copydoc VERTEX_CONTAINER::Delete()
  Delete(aItem: VERTEX_ITEM): void {
    console.assert(this.m_items.has(aItem) || aItem.GetSize() === 0);

    const size = aItem.GetSize();

    if (size === 0) return; // Item is not stored here

    const offset = aItem.GetOffset();

    // Insert a free memory chunk entry in the place where item was stored
    this.addFreeChunk(offset, size);

    // Indicate that the item is not stored in the container anymore
    aItem.setSize(0);

    this.m_items.delete(aItem);

    // This dynamic memory freeing optimize memory usage, but in fact can create
    // out of memory issues because freeing and reallocation large chunks of memory
    // can create memory fragmentation and no room to reallocate large chunks
    // after many free/reallocate cycles during a session using the same complex board
    // So it can be disable.
    // Currently: it is disable to avoid "out of memory" issues
  }

  ///< @copydoc VERTEX_CONTAINER::Clear()
  Clear(): void {
    this.m_freeSpace = this.m_currentSize;
    this.m_maxIndex = 0;
    this.m_failed = false;

    // Set the size of all the stored VERTEX_ITEMs to 0, so it is clear that they are not held
    // in the container anymore
    for (const it of this.m_items) it.setSize(0);

    this.m_items.clear();

    // Now there is only free space left
    this.m_freeChunks = [];
    this.insertFreeChunk(this.m_freeSpace, 0);
  }

  /**
   * Return handle to the vertex buffer. It might be negative if the buffer is not initialized.
   */
  abstract GetBufferHandle(): WebGLBuffer | null;

  /**
   * Return true if vertex buffer is currently mapped.
   */
  abstract IsMapped(): boolean;

  ///< @copydoc VERTEX_CONTAINER::Map()
  abstract override Map(): void;

  ///< @copydoc VERTEX_CONTAINER::Unmap()
  abstract override Unmap(): void;

  AllItemsSize(): number {
    return 0;
  }

  /**
   * Resize the chunk that stores the current item to the given size. The current item will
   * be moved to the new location if the reallocation fails, the vertex buffer is not resized.
   *
   * @param aSize is the requested chunk size.
   * @return true in case of success, false otherwise
   */
  protected reallocate(aSize: number): boolean {
    console.assert(aSize > 0);
    console.assert(this.IsMapped());

    const itemSize = this.m_item!.GetSize();

    // Find a free space chunk >= aSize
    let newChunk = this.lowerBound(aSize);

    // Is there enough space to store vertices?
    if (newChunk === -1) {
      let result: boolean;

      // Would it be enough to double the current space?
      if (aSize < this.m_freeSpace + this.m_currentSize) {
        // Yes: exponential growing
        result = this.defragmentResize(this.m_currentSize * 2);
      } else {
        // No: grow to the nearest greater power of 2
        result = this.defragmentResize(2 ** Math.ceil(Math.log2(this.m_currentSize * 2 + aSize)));
      }

      if (!result) return false;

      newChunk = this.lowerBound(aSize);
      console.assert(newChunk !== -1);
    }

    // Parameters of the allocated chunk
    const newChunkSize = this.getChunkSize(this.m_freeChunks[newChunk]!);
    const newChunkOffset = this.getChunkOffset(this.m_freeChunks[newChunk]!);

    console.assert(newChunkSize >= aSize);
    console.assert(newChunkOffset < this.m_currentSize);

    // Check if the item was previously stored in the container
    if (itemSize > 0) {
      // Safety check: m_vertices must be valid at this point.  On some platforms (notably
      // macOS with Metal-backed OpenGL), the GPU buffer mapping can silently fail or be
      // invalidated under memory pressure, leaving m_vertices null even after a successful
      // defragmentResize().  Bail out rather than crash on the memcpy.
      if (!this.m_vertices) return false;

      // The item was reallocated, so we have to copy all the old data to the new place
      VERTEX_STORAGE.copy(
        this.m_vertices,
        this.m_chunkOffset,
        this.m_vertices,
        newChunkOffset,
        itemSize,
      );

      // Free the space used by the previous chunk
      this.addFreeChunk(this.m_chunkOffset, this.m_chunkSize);
    }

    // Remove the new allocated chunk from the free space pool
    this.m_freeChunks.splice(newChunk, 1);
    this.m_freeSpace -= newChunkSize;

    this.m_chunkSize = newChunkSize;
    this.m_chunkOffset = newChunkOffset;

    this.m_item!.setOffset(this.m_chunkOffset);

    return true;
  }

  /**
   * Remove empty spaces between chunks and optionally resizes the container.
   *
   * After the operation there is continuous space for storing vertices at the end of
   * the container.
   *
   * @param aNewSize is the new size of container, expressed in vertices
   * @return false in case of failure (e.g. memory shortage)
   */
  protected abstract defragmentResize(aNewSize: number): boolean;

  /**
   * Transfer all stored data to a new buffer, removing empty spaces between the data chunks
   * in the container.
   *
   * @param aTarget is the destination for the defragmented data.
   */
  protected defragment(aTarget: VERTEX_STORAGE): void {
    // Defragmentation
    let newOffset = 0;

    for (const item of this.m_items) {
      const itemOffset = item.GetOffset();
      const itemSize = item.GetSize();

      // Move an item to the new container
      VERTEX_STORAGE.copy(this.m_vertices!, itemOffset, aTarget, newOffset, itemSize);

      // Update new offset
      item.setOffset(newOffset);

      // Move to the next free space
      newOffset += itemSize;
    }

    // Move the current item and place it at the end
    if (this.m_item!.GetSize() > 0) {
      VERTEX_STORAGE.copy(
        this.m_vertices!,
        this.m_item!.GetOffset(),
        aTarget,
        newOffset,
        this.m_item!.GetSize(),
      );

      this.m_item!.setOffset(newOffset);
      this.m_chunkOffset = newOffset;
    }

    this.m_maxIndex = this.usedSpace();
  }

  /**
   * Look for consecutive free memory chunks and merges them, decreasing fragmentation of
   * memory.
   */
  protected mergeFreeChunks(): void {
    if (this.m_freeChunks.length <= 1)
      // There are no chunks that can be merged
      return;

    // Reversed free chunks map - this one stores chunk size with its offset as the key
    const freeChunks: CHUNK[] = [];

    for (const [size, off] of this.m_freeChunks) freeChunks.push([off, size]);

    this.m_freeChunks = [];

    freeChunks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    let offset = freeChunks[0]![0];
    let size = freeChunks[0]![1];
    freeChunks.shift();

    for (const itf of freeChunks) {
      if (itf[0] === offset + size) {
        // These chunks can be merged, so just increase the current chunk size and go on
        size += itf[1];
      } else {
        // These chunks cannot be merged
        // So store the previous one
        this.insertFreeChunk(size, offset);

        // and let's check the next chunk
        offset = itf[0];
        size = itf[1];
      }
    }

    // Add the last one
    this.insertFreeChunk(size, offset);
  }

  /**
   * Return size of the given chunk.
   *
   * @param aChunk is the chunk.
   */
  protected getChunkSize(aChunk: CHUNK): number {
    return aChunk[0];
  }

  /**
   * Return offset of the chunk.
   *
   * @param aChunk is the chunk.
   */
  protected getChunkOffset(aChunk: CHUNK): number {
    return aChunk[1];
  }

  /**
   * Add a chunk marked as free.
   */
  protected addFreeChunk(aOffset: number, aSize: number): void {
    console.assert(aOffset + aSize <= this.m_currentSize);
    console.assert(aSize > 0);

    this.insertFreeChunk(aSize, aOffset);
    this.m_freeSpace += aSize;
  }

  /** `m_freeChunks.insert( { aSize, aOffset } )`: the multimap keeps equal keys in insertion order. */
  protected insertFreeChunk(aSize: number, aOffset: number): void {
    let i = this.m_freeChunks.length;
    while (i > 0 && this.m_freeChunks[i - 1]![0] > aSize) i--;
    this.m_freeChunks.splice(i, 0, [aSize, aOffset]);
  }

  /** `m_freeChunks.lower_bound( aSize )`: the first chunk of at least aSize, or -1 for end(). */
  protected lowerBound(aSize: number): number {
    for (let i = 0; i < this.m_freeChunks.length; i++) {
      if (this.m_freeChunks[i]![0] >= aSize) return i;
    }
    return -1;
  }
}

/**
 * Specialization of CACHED_CONTAINER that stores data in RAM.
 *
 * This is mainly for video cards/drivers that do not cope well with video memory mapping.
 */
export class CACHED_CONTAINER_RAM extends CACHED_CONTAINER {
  ///< Handle to vertices buffer
  protected m_verticesBuffer: WebGLBuffer | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    aSize: number = VERTEX_CONTAINER.DEFAULT_SIZE,
  ) {
    super(aSize);
    this.m_verticesBuffer = gl.createBuffer();
    checkGlError(gl, 'generating vertices buffer');

    this.m_vertices = new VERTEX_STORAGE(aSize);
  }

  override destroy(): void {
    this.gl.deleteBuffer(this.m_verticesBuffer);
    this.m_vertices = null;
  }

  ///< @copydoc VERTEX_CONTAINER::Unmap()
  Map(): void {}

  ///< @copydoc VERTEX_CONTAINER::Unmap()
  Unmap(): void {
    if (!this.m_dirty) return;

    const gl = this.gl;

    // Upload vertices coordinates and shader types to GPU memory
    gl.bindBuffer(gl.ARRAY_BUFFER, this.m_verticesBuffer);
    checkGlError(gl, 'binding vertices buffer');
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.m_vertices!.u8.subarray(0, this.m_maxIndex * VERTEX_SIZE),
      gl.STREAM_DRAW,
    );
    checkGlError(gl, 'transferring vertices');
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    checkGlError(gl, 'unbinding vertices buffer');
  }

  IsMapped(): boolean {
    return true;
  }

  GetBufferHandle(): WebGLBuffer | null {
    return this.m_verticesBuffer; // make common with CACHED_CONTAINER_RAM
  }

  protected defragmentResize(aNewSize: number): boolean {
    // No shrinking if we cannot fit all the data
    if (this.usedSpace() > aNewSize) return false;

    const newBufferMem = new VERTEX_STORAGE(aNewSize);

    this.defragment(newBufferMem);

    // Switch to the new vertex buffer
    this.m_vertices = newBufferMem;

    this.m_freeSpace += aNewSize - this.m_currentSize;
    this.m_currentSize = aNewSize;

    // Now there is only one big chunk of free memory
    this.m_freeChunks = [];
    this.insertFreeChunk(this.m_freeSpace, this.m_currentSize - this.m_freeSpace);

    this.m_dirty = true;

    return true;
  }
}

/**
 * Specialization of CACHED_CONTAINER that stores data in video memory via memory mapping.
 *
 * WebGL has no `glMapBuffer`, so `Map()` fails the way the C++ does when the
 * driver returns null, and `MakeContainer` never chooses this class; it is
 * here so the class set is the reference's.
 */
export class CACHED_CONTAINER_GPU extends CACHED_CONTAINER {
  ///< Flag saying if vertex buffer is currently mapped
  protected m_isMapped: boolean;

  ///< Vertex buffer handle
  protected m_glBufferHandle: WebGLBuffer | null;

  ///< Flag saying whether it is safe to use glCopyBufferSubData
  protected m_useCopyBuffer: boolean;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    aSize: number = VERTEX_CONTAINER.DEFAULT_SIZE,
  ) {
    super(aSize);
    this.m_isMapped = false;
    this.m_glBufferHandle = null;

    // GLAD_GL_ARB_copy_buffer: WebGL2 has copyBufferSubData; the Intel/etnaviv
    // workaround has no driver string to key on here.
    this.m_useCopyBuffer = true;

    this.m_glBufferHandle = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.m_glBufferHandle);
    gl.bufferData(gl.ARRAY_BUFFER, this.m_currentSize * VERTEX_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    checkGlError(gl, 'allocating video memory for cached container');
  }

  override destroy(): void {
    if (this.m_isMapped) this.Unmap();

    this.gl.deleteBuffer(this.m_glBufferHandle);
  }

  GetBufferHandle(): WebGLBuffer | null {
    return this.m_glBufferHandle;
  }

  IsMapped(): boolean {
    return this.m_isMapped;
  }

  ///< @copydoc VERTEX_CONTAINER::Map()
  Map(): void {
    // wxCHECK( !IsMapped(), /*void*/ )
    if (this.IsMapped()) return;

    // glMapBuffer returned null: WebGL has no buffer mapping.
    this.m_vertices = null;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    throw new Error('Could not map vertex buffer: glMapBuffer returned null');
  }

  ///< @copydoc VERTEX_CONTAINER::Unmap()
  Unmap(): void {
    // wxCHECK( IsMapped(), /*void*/ )
    if (!this.IsMapped()) return;

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.m_vertices = null;
    this.m_isMapped = false;
  }

  override AllItemsSize(): number {
    let size = 0;

    for (const item of this.m_items) size += item.GetSize();

    return size;
  }

  protected defragmentResize(aNewSize: number): boolean {
    // wxCHECK( IsMapped(), false )
    return false;
  }
}
