// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CACHED_CONTAINER_RAM through the add/delete churn of a drag: every live item keeps its own
 * vertices, and the GPU copy equals the RAM copy.
 *
 * reallocate held the chosen free chunk as an array index where upstream holds a multimap
 * iterator; the addFreeChunk between choosing and erasing it shifted the index, so the chunk
 * just freed was erased instead and the chunk handed out stayed free - the next item was
 * allocated on top of it.
 *
 * And our Unmap sends only the vertices touched since the last upload (the GPU container's
 * glUnmapBuffer behaviour), and the whole buffer only when it reallocates. On a reallocating
 * frame that whole-buffer upload stopped at m_maxIndex, which FinishItem moves only for an item
 * that leaves slack - so an item written above it that frame never reached the GPU, and with no
 * later full upload to heal it the canvas drew another item's vertices or nothing: during a
 * schematic drag, neighbouring symbols lost their pins and stray fragments trailed the move.
 *
 * The GL here is the GPU: bufferData allocates its copy, bufferSubData writes into it.
 */
import { VERTEX_SIZE, type VERTEX_STORAGE } from '@ziroeda/common/gal/opengl/vertex_common.js';
import { CACHED_CONTAINER_RAM } from '@ziroeda/common/gal/opengl/vertex_container.js';
import { VERTEX_ITEM } from '@ziroeda/common/gal/opengl/vertex_item.js';
import type { VERTEX_MANAGER } from '@ziroeda/common/gal/opengl/vertex_manager.js';
import { describe, expect, it } from 'vitest';

/** A WebGL2 context whose one buffer is a byte array. */
function gpu() {
  const state = { bytes: new Uint8Array(0) };
  const gl = {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    NO_ERROR: 0,
    createBuffer: () => ({}),
    deleteBuffer: () => {},
    bindBuffer: () => {},
    getError: () => 0,
    bufferData: (_t: number, aSize: number) => {
      state.bytes = new Uint8Array(aSize);
    },
    bufferSubData: (_t: number, aOffset: number, aData: Uint8Array) => {
      state.bytes.set(aData, aOffset);
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
}

/** A deterministic PRNG, so a failure names its seed. */
function lcg(aSeed: number): () => number {
  let s = aSeed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function churn(aSeed: number): string[] {
  const { gl, state } = gpu();
  const container = new CACHED_CONTAINER_RAM(gl, 16);
  const manager = {
    SetItem: (aItem: VERTEX_ITEM) => container.SetItem(aItem),
    FreeItem: (aItem: VERTEX_ITEM) => container.Delete(aItem),
  } as unknown as VERTEX_MANAGER;
  const storage = (): VERTEX_STORAGE =>
    (container as unknown as { m_vertices: VERTEX_STORAGE }).m_vertices;
  const live: { item: VERTEX_ITEM; tag: number }[] = [];
  const rand = lcg(aSeed);
  const faults: string[] = [];
  let tag = 1;

  for (let frame = 0; frame < 60; ++frame) {
    container.Map();

    // A drag frame: some items go, some are drawn anew, a few vertex by vertex.
    for (let d = 0; d < 3 && live.length > 0; ++d) {
      const [gone] = live.splice(Math.floor(rand() * live.length), 1);
      gone!.item.destroy();
    }

    for (let n = 0; n < 4; ++n) {
      const item = new VERTEX_ITEM(manager);
      const pieces = 1 + Math.floor(rand() * 3);

      for (let p = 0; p < pieces; ++p) {
        const count = 1 + Math.floor(rand() * 6);
        const at = container.Allocate(count);

        // Each item's vertices carry its own tag in every float.
        storage().f32.fill(tag, at * (VERTEX_SIZE / 4), (at + count) * (VERTEX_SIZE / 4));
      }

      container.FinishItem();
      live.push({ item, tag });
      ++tag;
    }

    container.Unmap();

    for (const { item, tag: t } of live) {
      const from = item.GetOffset() * VERTEX_SIZE;
      const to = from + item.GetSize() * VERTEX_SIZE;
      const holds = (aBytes: Uint8Array): boolean =>
        new Float32Array(aBytes.slice(from, to).buffer).every((f) => f === t) &&
        aBytes.length >= to;

      // In RAM first: an item overwritten by another means two were given the same vertices.
      if (!holds(storage().u8)) {
        faults.push(`seed ${aSeed} frame ${frame}: item ${t} overwritten in RAM`);
        break;
      }

      if (!holds(state.bytes)) {
        faults.push(`seed ${aSeed} frame ${frame}: item ${t} missing on the GPU`);
        break;
      }
    }

    if (faults.length) break;
  }

  return faults;
}

describe('CACHED_CONTAINER_RAM through a drag-like churn', () => {
  it('gives every live item its own vertices, and the GPU the same bytes as RAM', () => {
    const faults: string[] = [];

    for (let seed = 1; seed <= 40; ++seed) faults.push(...churn(seed));

    expect(faults).toEqual([]);
  });
});
