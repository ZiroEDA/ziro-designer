// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/kiway_player.h`, `common/kiway_player.cpp`: KIWAY_PLAYER, a frame
 * the KIWAY can open, close and send mail to.
 *
 * The modal-frame loop (`ShowModal` / `DismissModal`) and the interprocess
 * socket server are not ported: a browser page has neither a nested event
 * loop nor sockets.
 */
import { EDA_BASE_FRAME } from './eda_base_frame.js';
import { EDA_KIWAY_MAIL_RECEIVED, type KIWAY_MAIL_EVENT } from './kiway_mail.js';
import { wxEvtHandler, type wxEvent } from './wx/wx_event.js';

/** For the aCtl argument of OpenProjectFiles(). */
export const KICTL_NONKICAD_ONLY = 1 << 0; ///< chosen file is non-KiCad according to user
export const KICTL_KICAD_ONLY = 1 << 1; ///< chosen file is from KiCad according to user
export const KICTL_CREATE = 1 << 2; ///< caller thinks requested project files may not exist.
export const KICTL_IMPORT_LIB = 1 << 3; ///< import all footprints into a project library.
export const KICTL_REVERT = 1 << 4; ///< reverting to a previously-saved (KiCad) file.

export abstract class KIWAY_PLAYER extends EDA_BASE_FRAME {
  /** The wxFrame's own event handler: `EVT_KIWAY_EXPRESS( KIWAY_PLAYER::kiway_express )`. */
  private readonly m_eventHandler = new wxEvtHandler();

  protected m_modal = false; // true if frame is intended to be modal, not modeless

  constructor(...aArgs: ConstructorParameters<typeof EDA_BASE_FRAME>) {
    super(...aArgs);
    this.m_eventHandler.Connect(EDA_KIWAY_MAIL_RECEIVED, (aEvent: KIWAY_MAIL_EVENT) =>
      this.kiway_express(aEvent),
    );
  }

  /** `wxWindow::GetEventHandler()`. */
  GetEventHandler(): wxEvtHandler {
    return this.m_eventHandler;
  }

  /** `wxWindow::ProcessEvent()`: through the frame's event handler. */
  ProcessEvent(aEvent: wxEvent): boolean {
    return this.m_eventHandler.ProcessEvent(aEvent);
  }

  // `OpenProjectFiles( aFileList, aCtl )` is declared by each frame instead:
  // the files are the page's own objects (an image, a fetched Gerber), not
  // paths, and gerbview's load is asynchronous, so no one signature covers them.

  /** Receive a KIWAY_MAIL_EVENT. Override this in derived classes. */
  KiwayMailIn(_aEvent: KIWAY_MAIL_EVENT): void {}

  IsModal(): boolean {
    return this.m_modal;
  }

  SetModal(aIsModal: boolean): void {
    this.m_modal = aIsModal;
  }

  /** Event handler, routes to derivative specific virtual KiwayMailIn(). */
  protected kiway_express(aEvent: KIWAY_MAIL_EVENT): void {
    // logging support
    this.KiwayMailIn(aEvent); // call the virtual, override in derived.
  }
}
