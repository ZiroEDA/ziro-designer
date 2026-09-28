// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/kiway_mail.h`, `common/kiway_mail.cpp`: KIWAY_MAIL_EVENT, which
 * carries a payload from one KIWAY_PLAYER to another within a PROJECT.
 */
import type { FRAME_T } from './frame_type.js';
import type { MAIL_T } from './mail_type.js';
import { wxEvent, wxNewEventType } from './wx/wx_event.js';

/**
 * `std::string&`: the payload is held by reference, so a recipient that
 * answers (`MAIL_SCH_GET_NETLIST`, `MAIL_SCH_GET_ITEM`) writes into the
 * sender's string.
 */
export interface MAIL_PAYLOAD {
  value: string;
}

/** `wxDEFINE_EVENT( EDA_KIWAY_MAIL_RECEIVED, KIWAY_MAIL_EVENT )`. */
export const EDA_KIWAY_MAIL_RECEIVED = wxNewEventType();

/** Carry a payload from one KIWAY_PLAYER to another within a PROJECT. */
export class KIWAY_MAIL_EVENT extends wxEvent {
  private readonly m_destination: FRAME_T; ///< could have been a bitmap indicating multiple recipients.
  private readonly m_command: MAIL_T; ///< wxEvent's re-purposed control id.
  private readonly m_payload: MAIL_PAYLOAD; ///< very often s-expression text, but not always.

  constructor(
    aDestination: FRAME_T,
    aCommand: MAIL_T,
    aPayload: MAIL_PAYLOAD,
    aSource: unknown = null,
  ) {
    super(EDA_KIWAY_MAIL_RECEIVED);
    this.m_destination = aDestination;
    this.m_command = aCommand;
    this.m_payload = aPayload;
    this.SetEventObject(aSource);
  }

  /** Return the destination player id of the message. */
  Dest(): FRAME_T {
    return this.m_destination;
  }

  /** Return the MAIL_T associated with this mail. */
  Command(): MAIL_T {
    return this.m_command;
  }

  /** Return the payload, which can be any text but it typically self identifying s-expression. */
  GetPayload(): string {
    return this.m_payload.value;
  }

  SetPayload(aPayload: string): void {
    this.m_payload.value = aPayload;
  }
}
