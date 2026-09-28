// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/layer_pairs.h` / `.cpp`: `LAYER_PAIR_SETTINGS`, the management class
 * over a board's layer-pair presets (the "swap active layers" list the
 * via-stitching and diff-pair tools cycle through) — plus its two change
 * events.
 *
 * `LAYER_PAIR` and `LAYER_PAIR_INFO` (the pair itself, and a pair plus its
 * enabled flag and name) are not ported here: they already live in
 * `common/project/board_project_settings.ts`, a direct port of the same-named
 * structs from `include/project/board_project_settings.h` (the header this
 * class's `.h` itself includes them from). This file is only the management
 * class layer_pairs.h/.cpp adds on top.
 *
 * `QueueEvent` (async: posted for the next idle loop) becomes a direct
 * `ProcessEvent` call — `common/wx/wx_event.ts`'s `wxEvtHandler` has no event
 * queue or idle loop to post into, and every other synchronous-model port
 * here (the grid arc, the tool dispatcher) reads events the moment they're
 * raised.
 */
import { LAYER_PAIR, LAYER_PAIR_INFO } from '@ziroeda/common/project/board_project_settings.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { wxEvent, wxEvtHandler, wxNewEventType } from '@ziroeda/common/wx/wx_event.js';

/** `wxDECLARE_EVENT( PCB_LAYER_PAIR_PRESETS_CHANGED, wxCommandEvent )`. */
export const PCB_LAYER_PAIR_PRESETS_CHANGED = wxNewEventType();
/** `wxDECLARE_EVENT( PCB_CURRENT_LAYER_PAIR_CHANGED, wxCommandEvent )`. */
export const PCB_CURRENT_LAYER_PAIR_CHANGED = wxNewEventType();

/**
 * `IsAnEnabledPreset` (`layer_pairs.cpp:32`, file-local): is `aPair` one of
 * `aSettings`'s enabled presets, regardless of order?
 */
function isAnEnabledPreset(aPair: LAYER_PAIR, aSettings: LAYER_PAIR_SETTINGS): boolean {
  return aSettings
    .GetLayerPairs()
    .some((preset) => preset.GetLayerPair().HasSameLayers(aPair) && preset.IsEnabled());
}

/**
 * Management class for layer pairs in a PCB (`class LAYER_PAIR_SETTINGS`).
 */
export class LAYER_PAIR_SETTINGS extends wxEvtHandler {
  // Ordered store of all preset layer pairs
  private m_pairs: LAYER_PAIR_INFO[] = [];

  // Keep track of the last manual pair (set, but not a preset) for quick switching back
  private m_lastManualPair: LAYER_PAIR | undefined;

  private m_currentPair: LAYER_PAIR;

  constructor() {
    super();
    this.m_currentPair = new LAYER_PAIR(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
  }

  /** The compiler-generated copy constructor. */
  static copyOf(aOther: LAYER_PAIR_SETTINGS): LAYER_PAIR_SETTINGS {
    const copy = new LAYER_PAIR_SETTINGS();
    copy.m_pairs = aOther.m_pairs.slice();
    copy.m_currentPair = aOther.m_currentPair;
    return copy;
  }

  private addLayerPairInternal(aPairInfo: LAYER_PAIR_INFO): boolean {
    const newPair = aPairInfo.GetLayerPair();
    const alreadyExists = this.m_pairs.some((existing) =>
      newPair.HasSameLayers(existing.GetLayerPair()),
    );

    if (alreadyExists) return false;

    // If we're adding a pair that matches the last manual pair
    // we no longer need the manual one
    if (this.m_lastManualPair && this.m_lastManualPair.HasSameLayers(newPair)) {
      this.m_lastManualPair = undefined;
    }

    this.m_pairs.push(aPairInfo);
    return true;
  }

  AddLayerPair(aPair: LAYER_PAIR_INFO): boolean {
    const ret = this.addLayerPairInternal(aPair);
    this.ProcessEvent(new wxEvent(PCB_LAYER_PAIR_PRESETS_CHANGED));
    return ret;
  }

  private removeLayerPairInternal(aPair: LAYER_PAIR): boolean {
    const i = this.m_pairs.findIndex((p) => p.GetLayerPair().HasSameLayers(aPair));

    if (i < 0) return false;

    this.m_pairs.splice(i, 1);
    return true;
  }

  /** Remove the matching layer pair from the store, if present. */
  RemoveLayerPair(aPair: LAYER_PAIR): boolean {
    const ret = this.removeLayerPairInternal(aPair);
    this.ProcessEvent(new wxEvent(PCB_LAYER_PAIR_PRESETS_CHANGED));
    return ret;
  }

  /** Returns a span (array) of all stored layer pairs. */
  GetLayerPairs(): readonly LAYER_PAIR_INFO[] {
    return this.m_pairs;
  }

  /**
   * Get a vector of all enabled layer pairs, in order.
   *
   * This includes a "manual" pair, if one is set and isn't in the list of presets.
   */
  GetEnabledLayerPairs(): { pairs: LAYER_PAIR_INFO[]; current: number } {
    const enabledPairs: LAYER_PAIR_INFO[] = [];
    let current = -1;

    if (this.m_lastManualPair) {
      enabledPairs.push(new LAYER_PAIR_INFO(this.m_lastManualPair, true, 'Manual'));

      if (this.m_currentPair.HasSameLayers(this.m_lastManualPair)) {
        current = 0;
      }
    }

    for (const pair of this.m_pairs) {
      if (pair.IsEnabled()) {
        enabledPairs.push(pair);

        if (this.m_currentPair.HasSameLayers(pair.GetLayerPair())) {
          current = enabledPairs.length - 1;
        }
      }
    }

    return { pairs: enabledPairs, current };
  }

  /**
   * Replace the stored layer pairs with the given list.
   *
   * The same conditions are maintained as for AddLayerPair.
   */
  SetLayerPairs(aPairs: readonly LAYER_PAIR_INFO[]): void {
    // Replace all pairs with the given list
    this.m_pairs = [];

    for (const pair of aPairs) {
      // Skip dupes and other
      this.addLayerPairInternal(pair);
    }

    this.ProcessEvent(new wxEvent(PCB_LAYER_PAIR_PRESETS_CHANGED));
  }

  GetCurrentLayerPair(): LAYER_PAIR {
    return this.m_currentPair;
  }

  /** Set the "active" layer pair. This doesn't have to be a preset pair. */
  SetCurrentLayerPair(aPair: LAYER_PAIR): void {
    this.m_currentPair = aPair;

    if (!isAnEnabledPreset(aPair, this)) {
      this.m_lastManualPair = aPair;
    }

    this.ProcessEvent(new wxEvent(PCB_CURRENT_LAYER_PAIR_CHANGED));
  }
}
