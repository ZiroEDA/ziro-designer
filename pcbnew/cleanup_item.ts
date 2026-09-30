// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CLEANUP_RC_CODE`, `CLEANUP_ITEM` and `VECTOR_CLEANUP_ITEMS_PROVIDER`
 * (pcbnew/cleanup_item.h, pcbnew/cleanup_item.cpp): the rows Cleanup Tracks &
 * Vias and Cleanup Graphics list.
 *
 * A `CLEANUP_ITEM` is an `RC_ITEM`, so it holds the KIIDs of up to two items,
 * not the items: a dry run's rows stay valid while the board is unchanged, and
 * the dialog resolves them against the live BOARD to select what a row names.
 */
import { RC_ITEM, RC_ITEMS_PROVIDER } from '@ziroeda/common/rc_item.js';
import { PCB_DRC_CODE } from './drc/drc_item.js';

/**
 * `CLEANUP_FIRST = DRCE_LAST + 1` (cleanup_item.h:29): where the cleanup codes
 * start, so they travel through the RC_ITEM machinery without colliding with a
 * DRC code; `PCB_BASE_FRAME::GetSeverity` reads it to answer RPT_SEVERITY_ACTION.
 */
export const CLEANUP_FIRST = PCB_DRC_CODE.DRCE_LAST + 1;

/** `enum CLEANUP_RC_CODE` (cleanup_item.h:31-45). */
export const CLEANUP_RC_CODE = {
  CLEANUP_SHORTING_TRACK: CLEANUP_FIRST,
  CLEANUP_SHORTING_VIA: CLEANUP_FIRST + 1,
  CLEANUP_REDUNDANT_VIA: CLEANUP_FIRST + 2,
  CLEANUP_DUPLICATE_TRACK: CLEANUP_FIRST + 3,
  CLEANUP_MERGE_TRACKS: CLEANUP_FIRST + 4,
  CLEANUP_DANGLING_TRACK: CLEANUP_FIRST + 5,
  CLEANUP_DANGLING_VIA: CLEANUP_FIRST + 6,
  CLEANUP_ZERO_LENGTH_TRACK: CLEANUP_FIRST + 7,
  CLEANUP_TRACK_IN_PAD: CLEANUP_FIRST + 8,
  CLEANUP_NULL_GRAPHIC: CLEANUP_FIRST + 9,
  CLEANUP_DUPLICATE_GRAPHIC: CLEANUP_FIRST + 10,
  CLEANUP_LINES_TO_RECT: CLEANUP_FIRST + 11,
  CLEANUP_MERGE_PAD: CLEANUP_FIRST + 12,
} as const;

export type CLEANUP_RC_CODE = (typeof CLEANUP_RC_CODE)[keyof typeof CLEANUP_RC_CODE];

const C = CLEANUP_RC_CODE;

/**
 * `CLEANUP_ITEM::GetErrorText`'s table. The strings are upstream's `_HKI`
 * literals verbatim ("co-linear", not "collinear"), because they are the msgid
 * the translation catalogue is keyed by.
 */
export function cleanupErrorText(aCode: number): string {
  switch (aCode) {
    // For cleanup tracks and vias:
    case C.CLEANUP_SHORTING_TRACK:
      return 'Remove track shorting two nets';
    case C.CLEANUP_SHORTING_VIA:
      return 'Remove via shorting two nets';
    case C.CLEANUP_REDUNDANT_VIA:
      return 'Remove redundant via';
    case C.CLEANUP_DUPLICATE_TRACK:
      return 'Remove duplicate track';
    case C.CLEANUP_MERGE_TRACKS:
      return 'Merge co-linear tracks';
    case C.CLEANUP_DANGLING_TRACK:
      return 'Remove track not connected at both ends';
    case C.CLEANUP_DANGLING_VIA:
      return 'Remove via connected on less than 2 layers';
    case C.CLEANUP_ZERO_LENGTH_TRACK:
      return 'Remove zero-length track';
    case C.CLEANUP_TRACK_IN_PAD:
      return 'Remove track inside pad';

    // For cleanup graphics:
    case C.CLEANUP_NULL_GRAPHIC:
      return 'Remove zero-size graphic';
    case C.CLEANUP_DUPLICATE_GRAPHIC:
      return 'Remove duplicated graphic';
    case C.CLEANUP_LINES_TO_RECT:
      return 'Convert lines to rectangle';
    case C.CLEANUP_MERGE_PAD:
      return 'Merge overlapping shapes into pad';

    default:
      // wxFAIL_MSG( wxT( "Missing cleanup item description" ) )
      return 'Unknown cleanup action';
  }
}

export class CLEANUP_ITEM extends RC_ITEM {
  constructor(aErrorCode: number) {
    super();
    this.m_errorCode = aErrorCode;
    this.m_errorTitle = cleanupErrorText(aErrorCode);
  }

  /**
   * `GetErrorText( int aErrorCode = -1, bool aTranslate = true )`, which hides
   * RC_ITEM's: called with a boolean it is RC_ITEM's own signature, and both
   * answer from the code.
   */
  override GetErrorText(aCode: number | boolean = -1, _aTranslate = true): string {
    const code = typeof aCode === 'number' && aCode >= 0 ? aCode : this.m_errorCode;

    return cleanupErrorText(code);
  }
}

/**
 * `VECTOR_CLEANUP_ITEMS_PROVIDER`: the dialog's RC_ITEMS_PROVIDER over the
 * cleaner's list. No ownership is taken of the vector.
 */
export class VECTOR_CLEANUP_ITEMS_PROVIDER extends RC_ITEMS_PROVIDER {
  constructor(private readonly m_sourceVector: CLEANUP_ITEM[]) {
    super();
  }

  SetSeverities(_aSeverities: number): void {}

  GetSeverities(): number {
    return 0;
  }

  GetCount(_aSeverity = -1): number {
    return this.m_sourceVector.length;
  }

  GetItem(aIndex: number): RC_ITEM | null {
    return this.m_sourceVector[aIndex] ?? null;
  }

  GetCleanupItem(aIndex: number): CLEANUP_ITEM | null {
    return this.m_sourceVector[aIndex] ?? null;
  }

  DeleteItem(aIndex: number, aDeep: boolean): void {
    if (aDeep) this.m_sourceVector.splice(aIndex, 1);
  }
}
