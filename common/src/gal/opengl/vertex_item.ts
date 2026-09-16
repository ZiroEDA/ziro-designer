// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/vertex_item.h` + `.cpp`: `KIGFX::VERTEX_ITEM`, a stored group
 * of vertices - its offset and size in the manager's container.
 */

import type { VERTEX_MANAGER } from './vertex_manager.js';

export class VERTEX_ITEM {
  /** `friend class CACHED_CONTAINER; friend class VERTEX_MANAGER`. */
  m_manager: VERTEX_MANAGER;
  m_offset: number;
  m_size: number;

  constructor(aManager: VERTEX_MANAGER) {
    this.m_manager = aManager;
    this.m_offset = 0;
    this.m_size = 0;

    // As the item is created, we are going to modify it, so call to SetItem() is needed
    this.m_manager.SetItem(this);
  }

  /** `~VERTEX_ITEM`: the group's memory goes back to the container. */
  destroy(): void {
    this.m_manager.FreeItem(this);
  }

  /**
   * Return information about number of vertices stored.
   *
   * @return Number of vertices.
   */
  GetSize(): number {
    return this.m_size;
  }

  /**
   * Return data offset in the container.
   *
   * @return Data offset expressed as a number of vertices.
   */
  GetOffset(): number {
    return this.m_offset;
  }

  /**
   * Return pointer to the data used by the VERTEX_ITEM.
   */
  GetVertices(): number {
    return this.m_manager.GetVertices(this);
  }

  /**
   * Set data offset in the container.
   *
   * @param aOffset is the offset expressed as a number of vertices.
   */
  setOffset(aOffset: number): void {
    this.m_offset = aOffset;
  }

  /**
   * Set data size in the container.
   *
   * @param aSize is the size expressed as a number of vertices.
   */
  setSize(aSize: number): void {
    this.m_size = aSize;
  }
}
