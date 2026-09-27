// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/kiway.h`: KIWAY, as far as a frame calls it.
 *
 * Upstream KIWAY loads the kiface DSOs and owns every KIWAY_PLAYER window; here
 * the program does both - an editor is a route, and the project manager is the
 * page every editor goes home to - so KIWAY is the interface the program hands
 * each frame (`EDA_BASE_FRAME::SetKiway`), and each method is what the program
 * does for the call of the same name.
 */
import type { FRAME_T } from './frame_type.js';

export interface KIWAY {
  /** `KIWAY::OnKiCadExit()`: leave the suite (here, go back to the project manager). */
  OnKiCadExit(): void;

  /**
   * `KIWAY::Player( aFrameType, true )` + `showFrame()`: open or raise that
   * editor. False where the program has no such player.
   */
  Player(aFrameType: FRAME_T): boolean;

  /**
   * `Kiway().GetTop()` is `KICAD_MAIN_FRAME_T`: whether a project manager
   * exists to switch to. False is upstream's stand-alone mode.
   */
  HasProjectManager(): boolean;

  /** `showFrame( Kiway().GetTop() )`: raise the project manager. */
  ShowProjectManager(): void;

  /**
   * `KIFACE::CreateKiWindow( parent, aDialogId, &Kiway() )` for the dialogs
   * another kiface owns - the library tables, Configure Paths. False when that
   * kiface is not available, which upstream also swallows.
   */
  CreateKiWindow(aClassId: FRAME_T): boolean;
}
