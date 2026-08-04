// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The report rows the cleanup dialogs list. Counterparts: `CLEANUP_RC_CODE`
 * (pcbnew/cleanup_item.h:29) and `CLEANUP_ITEM::GetErrorText`
 * (pcbnew/cleanup_item.cpp:32).
 *
 * ## Why the codes are strings here and integers upstream
 *
 * `CLEANUP_FIRST = DRCE_LAST + 1` exists so cleanup rows can travel through the
 * same `RC_ITEM` machinery as DRC violations without their codes colliding.
 * Nothing reads the numbers themselves — they are never serialised and never
 * compared against a DRC code — so the offset carries no information worth
 * reproducing, and a string union catches a mistyped code at compile time where
 * an integer would not.
 *
 * The enum order *is* reproduced, because it is the order the dialog's
 * "Change" list groups rows in.
 *
 * ## The four graphics codes are here and never emitted here
 *
 * `CLEANUP_NULL_GRAPHIC` … `CLEANUP_MERGE_PAD` belong to `GRAPHICS_CLEANER`
 * (Cleanup Graphics), which shares this enum upstream. They are defined here
 * because the enum is shared; the tracks cleaner never produces one.
 *
 * ## The `Rc` in the names
 *
 * `graphics_cleaner.ts` reached this ground first and took `CleanupCode` /
 * `CleanupItem` for a narrower pair of its own — a two-value code union and a
 * `{ code, id, message }` row, rather than `RC_ITEM`'s `{ code, title, items }`
 * with its up-to-two item references. Renaming that engine's exported types is
 * a change to a shipped API and is not this port's business, so these carry the
 * `Rc` of `CLEANUP_RC_CODE` and of the `RC_ITEM` a `CLEANUP_ITEM` *is*. When
 * the graphics cleaner is next revisited it should fold onto these.
 */

/** `CLEANUP_RC_CODE`, in enum order. */
export type CleanupRcCode =
  | 'shorting_track'
  | 'shorting_via'
  | 'redundant_via'
  | 'duplicate_track'
  | 'merge_tracks'
  | 'dangling_track'
  | 'dangling_via'
  | 'zero_length_track'
  | 'track_in_pad'
  | 'null_graphic'
  | 'duplicate_graphic'
  | 'lines_to_rect'
  | 'merge_pad';

/**
 * `CLEANUP_ITEM::GetErrorText`. The strings are upstream's `_HKI` literals
 * verbatim, US spelling and all ("co-linear", not "collinear"), because they
 * are the msgid the translation catalogue is keyed by.
 */
export function cleanupErrorText(aCode: CleanupRcCode): string {
  switch (aCode) {
    // For cleanup tracks and vias:
    case 'shorting_track':
      return 'Remove track shorting two nets';
    case 'shorting_via':
      return 'Remove via shorting two nets';
    case 'redundant_via':
      return 'Remove redundant via';
    case 'duplicate_track':
      return 'Remove duplicate track';
    case 'merge_tracks':
      return 'Merge co-linear tracks';
    case 'dangling_track':
      return 'Remove track not connected at both ends';
    case 'dangling_via':
      return 'Remove via connected on less than 2 layers';
    case 'zero_length_track':
      return 'Remove zero-length track';
    case 'track_in_pad':
      return 'Remove track inside pad';

    // For cleanup graphics:
    case 'null_graphic':
      return 'Remove zero-size graphic';
    case 'duplicate_graphic':
      return 'Remove duplicated graphic';
    case 'lines_to_rect':
      return 'Convert lines to rectangle';
    case 'merge_pad':
      return 'Merge overlapping shapes into pad';
  }
}

/**
 * One row of the cleanup report — `CLEANUP_ITEM`, which is an `RC_ITEM` with
 * `m_errorCode`, `m_errorTitle` and up to two item references.
 *
 * `items` holds `boardItemId()` strings resolved against the **input** board,
 * never against the cleaned-up one: a dry run reports against a board that was
 * not modified, and the dialog's click-to-locate has to resolve those ids while
 * the user decides whether to apply the changes at all.
 *
 * Only two upstream call sites pass a second item — `CLEANUP_MERGE_TRACKS`
 * (`SetItems( aSeg1, aSeg2 )`) and the through-hole-pad flavour of
 * `CLEANUP_REDUNDANT_VIA` (`SetItems( via, pad )`).
 */
export interface CleanupRcItem {
  code: CleanupRcCode;
  /** `m_errorTitle`, filled in by the constructor from the code. */
  title: string;
  items: string[];
}

/** `std::make_shared<CLEANUP_ITEM>( code )` followed by `SetItems( … )`. */
export function makeCleanupItem(aCode: CleanupRcCode, ...aItems: string[]): CleanupRcItem {
  return { code: aCode, title: cleanupErrorText(aCode), items: aItems };
}
