// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/grid_text_button_helpers.h` +
 * `common/widgets/grid_text_button_helpers.cpp`: the grid cell editors that
 * are a text entry with a button at its right (a `wxComboCtrl` with no popup).
 * The editor keeps the text and what the button does; the view
 * (`wx/grid_ui.tsx`) draws the entry and the button from
 * {@link GRID_CELL_TEXT_BUTTON_VIEW}.
 *
 * The footprint, URL and path editors open other windows through a GRID_TEXT_BUTTON_HOST.
 */
import { KiBitmapBundle } from '../bitmap.js';
import { BITMAPS } from '../bitmaps/bitmaps_list.js';
import type { wxGrid } from '../wx/grid.js';
import { allFilesWildcard } from '../wildcards_and_files_ext.js';
import type { ChooserFilter } from '../wx/filedlg.js';
import { GRID_CELL_TEXT_EDITOR } from './grid_text_helpers.js';

/** What the view needs from a text-and-button editor. */
export interface GRID_CELL_TEXT_BUTTON_VIEW {
  /** The button's bitmap, as the bitmap store's URL. */
  GetButtonBitmap(): string;
  /** `OnButtonClick`: a button that opens another window answers when it closes. */
  OnButtonClick(): void | Promise<void>;
}

/** `GRID_CELL_TEXT_BUTTON`: the text half; a subclass says what the button does. */
export abstract class GRID_CELL_TEXT_BUTTON
  extends GRID_CELL_TEXT_EDITOR
  implements GRID_CELL_TEXT_BUTTON_VIEW
{
  protected m_row = -1;
  protected m_col = -1;

  override BeginEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    this.m_row = aRow;
    this.m_col = aCol;
    super.BeginEdit(aRow, aCol, aGrid);
  }

  abstract GetButtonBitmap(): string;
  abstract OnButtonClick(): void | Promise<void>;
}

/**
 * `GRID_CELL_RUN_FUNCTION_EDITOR`: the button (`BITMAPS::small_refresh`,
 * `TEXT_BUTTON_RUN_FUNCTION`) runs a function of the edited cell.
 */
export class GRID_CELL_RUN_FUNCTION_EDITOR extends GRID_CELL_TEXT_BUTTON {
  constructor(private readonly m_function: (aRow: number, aCol: number) => void) {
    super();
  }

  GetButtonBitmap(): string {
    return KiBitmapBundle(BITMAPS.small_refresh);
  }

  OnButtonClick(): void {
    this.m_function(this.m_row, this.m_col);
  }
}

/**
 * What the text-button editors open, which upstream reaches through the dialog's KIWAY and
 * wxFileDialog: the window supplies it, as it supplies the frame's other modal presenters.
 */
export interface GRID_TEXT_BUTTON_HOST {
  /** `Kiway().Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal( &fpid )` with the symbol netlist. */
  ChooseFootprint(aPreselect: string, aSymbolNetlist: string): Promise<string | null>;
  /** `wxFileDialog( …, wxFD_OPEN | wxFD_FILE_MUST_EXIST ).ShowModal()` then `GetPath()`. */
  OpenFile(
    aTitle: string,
    aDefaultDir: string,
    aWildcard: readonly ChooserFilter[],
  ): Promise<string | null>;
  /** `GetAssociatedDocument( m_dlg, aUrl, … )`: open the URL or file. */
  OpenDocument(aUrl: string): void;
}

/**
 * `GRID_CELL_FPID_EDITOR` (`TEXT_BUTTON_FP_CHOOSER`): `BITMAPS::small_library`; the footprint
 * chooser, preselecting the cell's FPID (or the editor's preselect when empty), fed the symbol
 * netlist. One chooser at a time (`m_buttonFpChooserLock`).
 */
export class GRID_CELL_FPID_EDITOR extends GRID_CELL_TEXT_BUTTON {
  private m_buttonFpChooserLock = false;

  constructor(
    private readonly m_host: GRID_TEXT_BUTTON_HOST,
    private readonly m_symbolNetlist: string,
    private readonly m_preselect = '',
  ) {
    super();
  }

  GetButtonBitmap(): string {
    return KiBitmapBundle(BITMAPS.small_library);
  }

  async OnButtonClick(): Promise<void> {
    if (this.m_buttonFpChooserLock) return;

    this.m_buttonFpChooserLock = true;

    try {
      const fpid = this.m_value === '' ? this.m_preselect : this.m_value;
      const picked = await this.m_host.ChooseFootprint(fpid, this.m_symbolNetlist);

      if (picked !== null) this.m_value = picked;
    } finally {
      this.m_buttonFpChooserLock = false;
    }
  }
}

/**
 * `GRID_CELL_URL_EDITOR` (`TEXT_BUTTON_URL`): `small_folder` while empty (pick a file, stored as
 * `file://<path>`), `www` once there is a link (open it).
 */
export class GRID_CELL_URL_EDITOR extends GRID_CELL_TEXT_BUTTON {
  constructor(private readonly m_host: GRID_TEXT_BUTTON_HOST) {
    super();
  }

  GetButtonBitmap(): string {
    return KiBitmapBundle(this.m_value === '' ? BITMAPS.small_folder : BITMAPS.www);
  }

  async OnButtonClick(): Promise<void> {
    const filename = this.m_value;

    if (filename === '' || filename === '~') {
      const path = await this.m_host.OpenFile('Open file', '', [allFilesWildcard()]);

      if (path !== null) this.m_value = `file://${path}`;
    } else {
      this.m_host.OpenDocument(filename);
    }
  }
}

/**
 * `GRID_CELL_PATH_EDITOR` (`TEXT_BUTTON_FILE_BROWSER` with a file filter): `small_folder`; a file
 * picked from the current directory, which then follows the pick.
 */
export class GRID_CELL_PATH_EDITOR extends GRID_CELL_TEXT_BUTTON {
  constructor(
    private readonly m_host: GRID_TEXT_BUTTON_HOST,
    private readonly m_currentDir: { value: string },
    private readonly m_fileFilter: readonly ChooserFilter[],
  ) {
    super();
  }

  GetButtonBitmap(): string {
    return KiBitmapBundle(BITMAPS.small_folder);
  }

  async OnButtonClick(): Promise<void> {
    const slash = this.m_value.lastIndexOf('/');
    const dir = slash < 0 ? this.m_currentDir.value : this.m_value.slice(0, slash);
    const path = await this.m_host.OpenFile('Select a File', dir, this.m_fileFilter);

    if (path === null) return;

    this.m_value = path;
    this.m_currentDir.value = path.slice(0, Math.max(0, path.lastIndexOf('/')));
  }
}
