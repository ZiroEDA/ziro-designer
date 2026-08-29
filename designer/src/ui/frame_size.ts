// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The size a KiCad frame opens at before it has any saved geometry.
 *
 * `EDA_BASE_FRAME`'s constructor takes both from two file-static lookups
 * (`common/eda_base_frame.cpp:96-120`) and every frame in the suite inherits
 * them — `m_frameSize = defaultSize( aFrameType, this )` at `:160`, and again
 * at `:1062` when `LoadWindowSettings` finds no stored size:
 *
 *     static const wxSize minSizeLookup( FRAME_T aFrameType, wxWindow* aWindow )
 *     {
 *         case KICAD_MAIN_FRAME_T: return FromDIP( wxSize( 406, 354 ) );
 *         default:                 return FromDIP( wxSize( 500, 400 ) );
 *     }
 *
 *     static const wxSize defaultSize( FRAME_T aFrameType, wxWindow* aWindow )
 *     {
 *         case KICAD_MAIN_FRAME_T: return FromDIP( wxSize( 850, 540 ) );
 *         default:                 return FromDIP( wxSize( 1280, 720 ) );
 *     }
 *
 * [chrome] These are the numbers wx is asked for, so they belong in one place
 * here too. They sat as a private `FRAME_SIZE` literal inside the Assign
 * Footprints dialog, which is how the footprint viewer it opens came to have
 * no default size at all.
 *
 * `FromDIP` is the identity at 100 % scaling, which is what the browser's CSS
 * pixel already is.
 */

export interface FrameSize {
  width: number;
  height: number;
}

/** [data] `defaultSize()`'s `default:` row, `common/eda_base_frame.cpp:118` —
 *  every frame but the project manager. */
export const EDA_FRAME_DEFAULT_SIZE: FrameSize = { width: 1280, height: 720 };

/** [data] `minSizeLookup()`'s `default:` row, `common/eda_base_frame.cpp:105`. */
export const EDA_FRAME_MIN_SIZE: FrameSize = { width: 500, height: 400 };

/** [data] `defaultSize()`'s `KICAD_MAIN_FRAME_T` row (the project manager),
 *  `common/eda_base_frame.cpp:115`. */
export const KICAD_MANAGER_FRAME_DEFAULT_SIZE: FrameSize = { width: 850, height: 540 };

/** [data] `minSizeLookup()`'s `KICAD_MAIN_FRAME_T` row,
 *  `common/eda_base_frame.cpp:102`. */
export const KICAD_MANAGER_FRAME_MIN_SIZE: FrameSize = { width: 406, height: 354 };
