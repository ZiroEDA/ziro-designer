// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/kiway.h`, `common/kiway.cpp`: KIWAY, the way between the frames of
 * one project.
 *
 * Upstream KIWAY loads the kiface DSOs and creates every KIWAY_PLAYER window
 * itself; here the program does both - an editor is a view it mounts, and the
 * project manager is the page every editor goes home to - so the program hands
 * KIWAY a {@link KIWAY_PROGRAM} for those, and KIWAY keeps the rest: which
 * players are alive, and the mail between them.
 *
 * One difference follows from mounting. `KIFACE::CreateKiWindow` returns the
 * frame; a mounted view registers its player a render later
 * ({@link KIWAY.SetPlayerFrame}). Mail sent to a player that {@link KIWAY.Player}
 * has asked the program to create is held until it registers, which is what
 * upstream's synchronous creation gives its callers for free
 * (`Player( FRAME_FOOTPRINT_EDITOR, true )` then `ExpressMail( ..., MAIL_FP_EDIT )`).
 */
import { FRAME_T } from './frame_type.js';
import type { KIWAY_PLAYER } from './kiway_player.js';
import { KIWAY_MAIL_EVENT, type MAIL_PAYLOAD } from './kiway_mail.js';
import type { MAIL_T } from './mail_type.js';
import type { wxEvent } from './wx/wx_event.js';

/** `KIWAY::FACE_T`: the kiface DSOs a frame type belongs to. */
export enum FACE_T {
  FACE_SCH, ///< eeschema DSO
  FACE_PCB, ///< pcbnew DSO
  FACE_CVPCB,
  FACE_GERBVIEW,
  FACE_PL_EDITOR,
  FACE_PCB_CALCULATOR,
  FACE_BMP2CMP,
  FACE_PYTHON,

  KIWAY_FACE_COUNT,
}

/** What the program does for KIWAY: the kifaces' windows and the top frame. */
export interface KIWAY_PROGRAM {
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

export class KIWAY {
  private readonly m_program: KIWAY_PROGRAM;

  /** `m_playerFrameId`: the live player of each FRAME_T. */
  private readonly m_playerFrame = new Map<FRAME_T, KIWAY_PLAYER>();

  /** Mail for players the program is still creating, delivered when they register. */
  private readonly m_pendingMail = new Map<FRAME_T, KIWAY_MAIL_EVENT[]>();

  constructor(aProgram: KIWAY_PROGRAM) {
    this.m_program = aProgram;
  }

  /**
   * A simple mapping function which returns the FACE_T which is known to
   * implement @a aFrameType; `FACE_T( -1 )` for none (kiway.cpp:345-386).
   */
  static KifaceType(aFrameType: FRAME_T): FACE_T {
    switch (aFrameType) {
      case FRAME_T.FRAME_SCH:
      case FRAME_T.FRAME_SCH_SYMBOL_EDITOR:
      case FRAME_T.FRAME_SCH_VIEWER:
      case FRAME_T.FRAME_SYMBOL_CHOOSER:
      case FRAME_T.FRAME_SIMULATOR:
        return FACE_T.FACE_SCH;

      case FRAME_T.FRAME_PCB_EDITOR:
      case FRAME_T.FRAME_FOOTPRINT_EDITOR:
      case FRAME_T.FRAME_FOOTPRINT_VIEWER:
      case FRAME_T.FRAME_FOOTPRINT_CHOOSER:
      case FRAME_T.FRAME_FOOTPRINT_WIZARD:
      case FRAME_T.FRAME_PCB_DISPLAY3D:
        return FACE_T.FACE_PCB;

      case FRAME_T.FRAME_CVPCB:
      case FRAME_T.FRAME_CVPCB_DISPLAY:
        return FACE_T.FACE_CVPCB;

      case FRAME_T.FRAME_PYTHON:
        return FACE_T.FACE_PYTHON;

      case FRAME_T.FRAME_GERBER:
        return FACE_T.FACE_GERBVIEW;

      case FRAME_T.FRAME_PL_EDITOR:
        return FACE_T.FACE_PL_EDITOR;

      case FRAME_T.FRAME_CALC:
        return FACE_T.FACE_PCB_CALCULATOR;

      case FRAME_T.FRAME_BM2CMP:
        return FACE_T.FACE_BMP2CMP;

      default:
        return -1 as FACE_T;
    }
  }

  OnKiCadExit(): void {
    this.m_program.OnKiCadExit();
  }

  /**
   * `Player( aFrameType, true )` + `showFrame()`: open or raise that editor.
   * A player not yet alive is being created from here on, so mail sent to it
   * waits for it.
   */
  Player(aFrameType: FRAME_T): boolean {
    const shown = this.m_program.Player(aFrameType);

    if (shown && !this.m_playerFrame.has(aFrameType) && !this.m_pendingMail.has(aFrameType))
      this.m_pendingMail.set(aFrameType, []);

    return shown;
  }

  HasProjectManager(): boolean {
    return this.m_program.HasProjectManager();
  }

  ShowProjectManager(): void {
    this.m_program.ShowProjectManager();
  }

  CreateKiWindow(aClassId: FRAME_T): boolean {
    return this.m_program.CreateKiWindow(aClassId);
  }

  /** `GetPlayerFrame( aFrameType )`: the live player of that type, or null. */
  GetPlayerFrame(aFrameType: FRAME_T): KIWAY_PLAYER | null {
    return this.m_playerFrame.get(aFrameType) ?? null;
  }

  /**
   * `m_playerFrameId[aFrameType].store( frame->GetId() )`, which upstream does
   * as `CreateKiWindow` returns: the player is alive, and any mail held for it
   * is delivered.
   */
  SetPlayerFrame(aFrameType: FRAME_T, aFrame: KIWAY_PLAYER): void {
    this.m_playerFrame.set(aFrameType, aFrame);

    const pending = this.m_pendingMail.get(aFrameType);
    this.m_pendingMail.delete(aFrameType);

    for (const mail of pending ?? []) aFrame.ProcessEvent(mail);
  }

  /**
   * Notify the KIWAY that a player frame is closing: `m_playerFrameId[aFrameType]
   * = wxID_NONE`. Only the frame registered for that type is forgotten.
   */
  PlayerDidClose(aFrameType: FRAME_T, aFrame?: KIWAY_PLAYER): void {
    if (aFrame && this.m_playerFrame.get(aFrameType) !== aFrame) return;

    this.m_playerFrame.delete(aFrameType);
    this.m_pendingMail.delete(aFrameType);
  }

  /**
   * Send `aPayload` to `aDestination` from `aSource`. The recipient receives it
   * in `KIWAY_PLAYER::KiwayMailIn()`, and an answer comes back in `aPayload`.
   */
  ExpressMail(
    aDestination: FRAME_T,
    aCommand: MAIL_T,
    aPayload: MAIL_PAYLOAD,
    aSource: unknown = null,
  ): void {
    const mail = new KIWAY_MAIL_EVENT(aDestination, aCommand, aPayload, aSource);

    this.ProcessEvent(mail);
  }

  /** `ProcessEvent`: route mail to its recipient, if it is alive. */
  ProcessEvent(aEvent: wxEvent): boolean {
    if (aEvent instanceof KIWAY_MAIL_EVENT) {
      const dest = aEvent.Dest();

      // see if recipient is alive
      const alive = this.GetPlayerFrame(dest);

      if (alive) return alive.ProcessEvent(aEvent);

      const pending = this.m_pendingMail.get(dest);

      if (pending) {
        pending.push(aEvent);
        return true;
      }
    }

    return false;
  }
}
