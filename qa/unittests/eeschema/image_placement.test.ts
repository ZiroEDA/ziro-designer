// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing an image (SCH_DRAWING_TOOLS::PlaceImage).
 *
 * Upstream builds **one** SCH_BITMAP when the file is chosen and moves that same
 * object for the whole run —
 *
 *     SCH_BITMAP* image = aEvent.Parameter<SCH_BITMAP*>();
 *     …
 *     image->SetPosition( getViewControls()->GetCursorPosition() );
 *
 * — so the thing riding the cursor keeps one identity until it is dropped. Ours
 * rebuilt it from the raw base64 on every frame, which minted a fresh uuid each
 * time. The renderer caches a decoded bitmap under that uuid, so every frame was
 * a cache miss that never finished decoding before the next frame replaced it,
 * and nothing appeared until the click committed a stable one.
 */
import { describe, it, expect } from 'vitest';
import { makeImage } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { serialize } from '@ziroeda/sexpr/src/index.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
// 1x1 PNG; only the header is read, so the payload never has to decode.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('makeImage', () => {
  it('mints a new identity by default', () => {
    expect(makeImage(at(0, 0), PNG).uuid).not.toBe(makeImage(at(0, 0), PNG).uuid);
  });

  it('keeps the identity it is given, so a re-placed ghost is one object', () => {
    const first = makeImage(at(0, 0), PNG);
    const moved = makeImage(at(10, 20), first.data, first.scale, first.uuid);
    expect(moved.uuid).toBe(first.uuid);
    expect(moved.at).toEqual(at(10, 20));
    expect(moved.data).toBe(first.data);
  });

  it('re-places the serialized position too, not just the model', () => {
    // The ghost is committed straight into the document, so a stale `source`
    // would write the image back at the position it was first built at.
    const first = makeImage(at(0, 0), PNG);
    const moved = makeImage(at(10, 20), first.data, first.scale, first.uuid);
    const text = serialize(moved.source!);
    expect(text).toContain('(at 10 20)');
    expect(text).toContain(first.uuid);
    expect(text).not.toContain('(at 0 0)');
  });

  it('carries the scale through', () => {
    const first = makeImage(at(0, 0), PNG, 2.5);
    const moved = makeImage(at(5, 5), first.data, first.scale, first.uuid);
    expect(moved.scale).toBe(2.5);
    expect(serialize(moved.source!)).toContain('(scale 2.5)');
  });
});
