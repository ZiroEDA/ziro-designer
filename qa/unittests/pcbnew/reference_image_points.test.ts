// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How the board editor draws reference images. The point editing of an image is
 * PCB_POINT_EDITOR's and is pinned in tools/pcb_point_editor.test.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('and the canvas draws what a selected or half-placed image needs', () => {
  const EDITOR = readFileSync(
    fileURLToPath(new URL('../../../pcbnew/pcb_edit_frame_ui.tsx', import.meta.url)),
    'utf8',
  );
  const RENDER = readFileSync(
    fileURLToPath(new URL('../../../pcbnew/renderBoard.ts', import.meta.url)),
    'utf8',
  );

  // A selected image's LAYER_ANCHOR box is PCB_PAINTER's: pcb_painter.test.ts.
  it('dims a placed image by the image opacity, as the painter does', () => {
    // `color.a *= m_imageOpacity` (`pcb_painter.cpp:578`). Appearance > Objects
    // has had the slider all along and `DEFAULT_OPACITY.images` has been 0.6;
    // the value simply never reached the renderer, so every reference image
    // painted at full strength over the board it is meant to sit under.
    expect(RENDER).toContain('imageOpacity: number;');
    expect(RENDER).toContain('opts.imageOpacity * la');
    expect(EDITOR).toContain('imageOpacity: opacity.images,');
  });
});

describe('the two ways a picture failed to appear at all', () => {
  const EDITOR = readFileSync(
    fileURLToPath(new URL('../../../pcbnew/pcb_edit_frame_ui.tsx', import.meta.url)),
    'utf8',
  );

  it('the one image the editor still decodes is the one riding the cursor', () => {
    // A picture failing to appear used to be a raster problem: the offscreen
    // pass drew the fallback OUTLINE while the payload decoded, and its guard
    // was `viewMatchesCache() && !sceneDirtyRef.current`, so on a freshly
    // loaded board a bare `requestDraw` re-blitted that outline for ever. The
    // decode callback had to dirty the scene, not just ask for a frame.
    //
    // There is no raster now. A reference image ON the board is decoded by
    // `WX_IMAGE::LoadFile` as the file is parsed - synchronously, before the
    // item exists - and drawn by `PCB_PAINTER::drawReferenceImage` through
    // `GAL::DrawBitmap` and `GL_BITMAP_CACHE`. Nothing is pending, so nothing
    // has to re-trigger a render.
    //
    //
    // Since DRAWING_TOOL::PlaceReferenceImage runs on TOOL_MANAGER (10-02) the
    // riding image is the item itself in the VIEW's preview
    // (`m_view->AddToPreview( image, false )`), drawn by the same painter, so
    // the editor decodes nothing.
    expect(EDITOR).not.toContain('imageCacheRef');
    expect(EDITOR).not.toContain('sceneDirtyRef');
  });
});
