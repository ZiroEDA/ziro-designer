// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fetching a netlist from the schematic, board-side. Counterparts:
 * `pcbnew/pcb_edit_frame.cpp` (PCB_EDIT_FRAME::FetchNetlistFromSchematic) and
 * `eeschema/cross-probing.cpp` (the MAIL_SCH_GET_NETLIST handler) plus
 * `eeschema/netlist_exporters/netlist_generator.cpp`
 * (SCH_EDIT_FRAME::ReadyToNetlist).
 *
 * Upstream this is a round trip over kiway mail: pcbnew asks the schematic frame for
 * a netlist, eeschema checks the schematic is fully annotated, formats it with
 * NETLIST_EXPORTER_KICAD, and pcbnew parses the string back. Here both ends are in
 * one process, but the shape is kept: the board editor never reaches into the
 * schematic model, it asks for netlist text and parses it.
 *
 * The MAIL_SCH_GET_NETLIST handler itself — reading the schematic sheets,
 * checking annotation, formatting the text — lives in
 * `eeschema/cross-probing.ts`'s `formatSchematicNetlist`, not here: KiCad's
 * pcbnew never links eeschema (it only ever reaches it through KIWAY), so
 * this reaches the headless answer (no schematic frame running) through a
 * swappable provider instead of an import, registered once by the app
 * (`pgm_app.ts`'s `InitPgm`) — the same shape `common/gal/kicursors.ts`'s
 * `setCustomCursorsEnabledProvider` uses.
 *
 * The one thing that cannot be mirrored is the modal Annotate dialog upstream opens
 * when the schematic is not annotated, the board editor cannot host the schematic's
 * dialog. Instead the annotation errors come back as a message for the caller to
 * show, which is the same information in one step fewer.
 */

import type { RawFile } from '@ziroeda/common';
import type { NetlistTextResult } from '@ziroeda/common/mail_sch_get_netlist.js';
import { loadKicadNetlist } from './netlist_reader/kicad_netlist_reader.js';
import type { NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';

export type FetchNetlistResult =
  | { ok: true; netlist: NETLIST; netlistText: string }
  | { ok: false; error: string; details?: string };

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

/**
 * `PCB_EDIT_FRAME::FetchNetlistFromSchematic` (pcb_edit_frame.cpp:2352): ask the
 * schematic for its netlist with `MAIL_SCH_GET_NETLIST`, the annotate message
 * as the payload, and read back what it answers. A payload that comes back
 * unchanged is the schematic refusing (`ReadyToNetlist` failed), reported as
 * that message alone, as upstream does.
 *
 * Upstream's `TestStandalone` opens the schematic frame off screen when it is
 * not running, so the mail always has a recipient. A frame here mounts
 * asynchronously, so with no schematic player the same answer is computed
 * from the project's files: {@link fetchNetlistFromSchematic}, the handler
 * the off-screen frame would run.
 */
export function FetchNetlistFromSchematic(
  aKiway: KIWAY | null,
  aSource: unknown,
  files: readonly RawFile[],
  aAnnotateMessage: string,
  rootPro?: string,
): FetchNetlistResult {
  if (!aKiway?.GetPlayerFrame(FRAME_T.FRAME_SCH))
    return fetchNetlistFromSchematic(files, aAnnotateMessage, rootPro);

  const payload = { value: aAnnotateMessage };
  aKiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload, aSource);

  if (payload.value === aAnnotateMessage) return { ok: false, error: aAnnotateMessage };

  try {
    return { ok: true, netlist: loadKicadNetlist(payload.value), netlistText: payload.value };
  } catch (err) {
    return {
      ok: false,
      error:
        'Received an error while reading netlist. Please report this issue to the ZiroEDA team.',
      details: String(err),
    };
  }
}
