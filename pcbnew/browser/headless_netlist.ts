// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The schematic's netlist when no schematic frame is running - what KiCad gets
 * by opening the schematic frame off screen (`KIWAY_PLAYER::TestStandalone`)
 * so that MAIL_SCH_GET_NETLIST always has a recipient. A frame here mounts
 * asynchronously, so the off-screen frame's handler
 * (`eeschema/cross-probing.ts`'s `formatSchematicNetlist`) is registered once
 * by the app instead (`pgm_app.ts`'s `InitPgm`), the same shape
 * `common/gal/kicursors.ts`'s `setCustomCursorsEnabledProvider` uses. KiCad's
 * pcbnew never links eeschema, so this reaches it through a provider, not an
 * import.
 *
 * Browser-only: no KiCad file. The KIWAY-mail half is
 * `PCB_EDIT_FRAME::FetchNetlistFromSchematic` in `pcb_edit_frame.ts`.
 */
import type { RawFile } from '@ziroeda/common';
import type { NetlistTextResult } from '@ziroeda/common/mail_sch_get_netlist.js';
import { loadKicadNetlist } from '../netlist_reader/kicad_netlist_reader.js';
import type { FetchNetlistResult } from '../pcb_edit_frame.js';

/**
 * `eeschema/cross-probing.ts`'s `formatSchematicNetlist`, the MAIL_SCH_GET_NETLIST
 * handler an off-screen `SCH_EDIT_FRAME` would run: the app registers it once,
 * at startup (`pgm_app.ts`'s `InitPgm`).
 */
let headlessNetlistProvider: (
  files: readonly RawFile[],
  annotateMessage: string,
  rootPro?: string,
) => NetlistTextResult = (_files, annotateMessage) => ({ ok: false, error: annotateMessage });

/** The app's own registration, once, at startup. */
export function setHeadlessNetlistProvider(fn: typeof headlessNetlistProvider): void {
  headlessNetlistProvider = fn;
}

/**
 * PCB_EDIT_FRAME::FetchNetlistFromSchematic, the project's schematic sheets, read,
 * checked for annotation and exported as a KiCad netlist — the headless path
 * (no schematic player running): the text comes from {@link headlessNetlistProvider},
 * and this parses it into a `NETLIST`, the same as the KIWAY-mail path below does
 * for its payload.
 *
 * `annotateMessage` is the message upstream passes for the "requires a fully
 * annotated schematic" case; it prefixes the annotation errors when the check fails.
 */
export function fetchNetlistFromSchematic(
  files: readonly RawFile[],
  annotateMessage: string,
  rootPro?: string,
): FetchNetlistResult {
  const r = headlessNetlistProvider(files, annotateMessage, rootPro);
  if (!r.ok) return r;

  try {
    return { ok: true, netlist: loadKicadNetlist(r.netlistText), netlistText: r.netlistText };
  } catch (err) {
    // Upstream: "Received an error while reading netlist." with the developer detail.
    return {
      ok: false,
      error:
        'Received an error while reading netlist. Please report this issue to the ZiroEDA team.',
      details: String(err),
    };
  }
}
