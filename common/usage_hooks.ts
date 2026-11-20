// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A browser-only seam with no KiCad counterpart (KiCad collects no usage counts).
 *
 * ZiroEDA's anonymous usage counts (designer/src/telemetry/usage.ts) listen here for the
 * few things only common/ sees first, such as an edit landing on a frame's undo list.
 * Nothing is sent from this module: with no listener every call does nothing, and what
 * a listener receives is a name and plain numbers or labels, never project content.
 */

/** The values an event may carry: labels and numbers only. */
export type UsageProps = Record<string, string | number | boolean>;

export type UsageListener = (aEvent: string, aProps: UsageProps) => void;

let listener: UsageListener | null = null;

/** Install (or, with null, remove) the one listener. */
export function SetUsageListener(aListener: UsageListener | null): void {
  listener = aListener;
}

/** Report that `aEvent` happened. A listener that throws never disturbs the caller. */
export function NoteUsage(aEvent: string, aProps: UsageProps = {}): void {
  if (!listener) return;
  try {
    listener(aEvent, aProps);
  } catch {
    /* counting must never break editing */
  }
}
