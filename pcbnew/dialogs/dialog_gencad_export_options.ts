// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GENCAD_EXPORT_OPTIONS (`pcbnew/dialogs/dialog_gencad_export_options.cpp`):
 * File > Export > GenCAD... — the output file and the five exporter options.
 * The window is `dialog_gencad_export_options_ui.tsx`; this is the state its
 * controls hold and the Transfer methods.
 *
 * The job editor's variant (a JOB_EXPORT_PCB_GENCAD to read and write) is
 * the jobset runner's, which is not ported.
 */

import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';

export enum GENCAD_EXPORT_OPT {
  FLIP_BOTTOM_PADS, // flip bottom components padstacks geometry
  UNIQUE_PIN_NAMES, // generate unique pin names
  INDIVIDUAL_SHAPES, // generate a shape for each component
  USE_AUX_ORIGIN, // use auxiliary axis as origin
  STORE_ORIGIN_COORDS, // saves the origin point coordinates or (0, 0)
}

/**
 * `createOptCheckboxes`' map, in its key order — a std::map iterates by
 * GENCAD_EXPORT_OPT, which is the order the checkboxes are added. [data]
 */
export const GENCAD_EXPORT_OPT_LABELS: readonly [GENCAD_EXPORT_OPT, string][] = [
  [GENCAD_EXPORT_OPT.FLIP_BOTTOM_PADS, 'Flip bottom footprint padstacks'],
  [GENCAD_EXPORT_OPT.UNIQUE_PIN_NAMES, 'Generate unique pin names'],
  [
    GENCAD_EXPORT_OPT.INDIVIDUAL_SHAPES,
    'Generate a new shape for each footprint instance (do not reuse shapes)',
  ],
  [GENCAD_EXPORT_OPT.USE_AUX_ORIGIN, 'Use drill/place file origin as origin'],
  [GENCAD_EXPORT_OPT.STORE_ORIGIN_COORDS, 'Save the origin coordinates in the file'],
];

/**
 * `DoNotShowCheckbox( __FILE__, __LINE__ )`'s key for the overwrite question:
 * written once here, because a key edited in passing un-silences the dialog
 * for everyone who silenced it.
 */
export const GENCAD_DO_NOT_SHOW_KEYS = {
  overwrite: 'pcbnew/dialogs/dialog_gencad_export_options.cpp:TransferDataFromWindow',
} as const;

/** What the dialog asks of its frame. */
export interface DIALOG_GENCAD_EXPORT_OPTIONS_FRAME {
  /** `m_frame->GetBoard()->GetFileName()`. */
  GetBoardFileName(): string;
  /** `wxFile::Exists( fn )`, against the project's files. */
  FileExists(aPath: string): boolean;
  /** `KIDIALOG::ShowModal()`. */
  ShowKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult>;
}

export class DIALOG_GENCAD_EXPORT_OPTIONS {
  readonly m_title: string;
  /** `m_outputFileName`'s text. */
  m_outputFileName = '';
  /** `m_options`: each checkbox's value. */
  readonly m_options = new Map<GENCAD_EXPORT_OPT, boolean>(
    GENCAD_EXPORT_OPT_LABELS.map(([opt]) => [opt, false]),
  );

  constructor(
    private readonly m_frame: DIALOG_GENCAD_EXPORT_OPTIONS_FRAME,
    aTitle: string,
  ) {
    this.m_title = aTitle;
  }

  /** `GetOption( aOption )`. */
  GetOption(aOption: GENCAD_EXPORT_OPT): boolean {
    const it = this.m_options.get(aOption);

    // wxASSERT_MSG( false, wxT( "Missing checkbox for an option" ) )
    if (it === undefined) return false;

    return it;
  }

  SetOption(aOption: GENCAD_EXPORT_OPT, aValue: boolean): void {
    this.m_options.set(aOption, aValue);
  }

  /** `GetFileName()`. */
  GetFileName(): string {
    return this.m_outputFileName;
  }

  /** `TransferDataToWindow()`: the board's file name with a .cad extension. */
  TransferDataToWindow(): boolean {
    if (this.m_outputFileName === '') {
      const brdFile = this.m_frame.GetBoardFileName();
      const slash = Math.max(brdFile.lastIndexOf('/'), brdFile.lastIndexOf('\\'));
      const dot = brdFile.lastIndexOf('.');
      const stem = dot > slash ? brdFile.slice(0, dot) : brdFile;

      this.m_outputFileName = `${stem}.cad`;
    }

    return true;
  }

  /**
   * `TransferDataFromWindow()`: an existing file is overwritten only when the
   * KIDIALOG is answered with Overwrite (or was told not to ask again).
   */
  async TransferDataFromWindow(): Promise<boolean> {
    const fn = this.GetFileName();

    if (this.m_frame.FileExists(fn)) {
      const msg = `File ${fn} already exists.`;
      const answer = await this.m_frame.ShowKiDialog({
        caption: 'Confirmation',
        message: msg,
        icon: 'warning',
        labels: { ok: 'Overwrite' },
        doNotShowKey: GENCAD_DO_NOT_SHOW_KEYS.overwrite,
      });

      return answer === 'ok';
    }

    return true;
  }
}
