// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2cmp_frame.cpp` + `.h`: `BITMAP2CMP_FRAME`, the
 * Image Converter's window, less the window: the file names it remembers,
 * the title, the open and the four exports, its settings and its tools.
 *
 * The window is `designer/src/editors/image/ImageConverter.tsx`, which
 * builds the menu bar (`doReCreateMenuBar`), the status bar and the dialogs,
 * and supplies them here as `BITMAP2CMP_FRAME_UI`. `IMAGE_SIZE`'s members,
 * which this `.cpp` defines, are with the class in `bitmap2cmp_panel.ts`.
 *
 * Two things a browser cannot do the C's way:
 * - no directories: `m_mruPath` and the dialogs' start path are gone, and a
 *   file is its name;
 * - a save is a download, so there is no file dialog to type a name into.
 *   The name offered is the source image's, with the format's extension
 *   (`EnsureFileExtension` / `SetExt`), where KiCad's dialog starts empty.
 */
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import { unityScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import {
  drawingSheetWildcard,
  imageFileWildcard,
  kicadFootprintFileWildcard,
  kicadSymbolLibWildcard,
  psFileWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import { BITMAP2CMP_CONTROL } from './bitmap2cmp_control.js';
import {
  BITMAP2CMP_PANEL,
  DROP_FILE,
  type BITMAP2CMP_PANEL_UI,
  type IMAGE_FILE,
} from './bitmap2cmp_panel.js';
import type { BITMAP2CMP_SETTINGS } from './bitmap2cmp_settings.js';
import {
  DRAWING_SHEET_FMT,
  FOOTPRINT_FMT,
  POSTSCRIPT_FMT,
  SYMBOL_FMT,
  type OUTPUT_FMT_ID,
  type STRING_BUFFER,
} from './bitmap2component.js';

/** The window's services: the panel's, plus the frame's own dialogs and bars. */
export interface BITMAP2CMP_FRAME_UI extends BITMAP2CMP_PANEL_UI {
  /**
   * `wxFileDialog( ..., wxFD_OPEN | wxFD_FILE_MUST_EXIST )`: the chosen image,
   * read and decoded, or null for Cancel.
   */
  ChooseImageFile(aTitle: string, aFilters: readonly ChooserFilter[]): Promise<IMAGE_FILE | null>;
  /** Write `aText` as the file `aName` (a download); false when it could not be created. */
  SaveFile(
    aTitle: string,
    aFilters: readonly ChooserFilter[],
    aName: string,
    aText: string,
  ): boolean;
  /** `SetTitle`. */
  SetTitle(aTitle: string): void;
  /** `SetStatusText`, the one field of `CreateStatusBar( 1, ... )`. */
  SetStatusText(aText: string): void;
  /** `EDA_BASE_FRAME::UpdateFileHistory`: record the file under Open Recent. */
  UpdateFileHistory(aFile: IMAGE_FILE): void;
  /** `Close( false )`. */
  Close(): void;
}

/** `wxFileName( aPath ).GetName()`: the name without its extension. */
function stem(aName: string): string {
  const base = aName.slice(aName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** `wxFileName( aPath ).GetFullName()`. */
function fullName(aName: string): string {
  return aName.slice(aName.lastIndexOf('/') + 1);
}

/** One export: the file dialog's title and wildcard, and the extension it forces. [data] */
interface EXPORT_SPEC {
  title: string;
  filters: () => readonly ChooserFilter[];
  ext: string;
  format: OUTPUT_FMT_ID;
}

const EXPORTS: Record<'wks' | 'ps' | 'sym' | 'mod', EXPORT_SPEC> = {
  wks: {
    title: 'Create Drawing Sheet File',
    filters: () => [drawingSheetWildcard()],
    ext: 'kicad_wks',
    format: DRAWING_SHEET_FMT,
  },
  ps: {
    title: 'Create PostScript File',
    filters: () => [psFileWildcard()],
    ext: 'ps',
    format: POSTSCRIPT_FMT,
  },
  sym: {
    title: 'Create Symbol Library',
    filters: () => [kicadSymbolLibWildcard()],
    ext: 'kicad_sym',
    format: SYMBOL_FMT,
  },
  mod: {
    title: 'Create Footprint Library',
    filters: () => [kicadFootprintFileWildcard()],
    ext: 'kicad_mod',
    format: FOOTPRINT_FMT,
  },
};

export class BITMAP2CMP_FRAME extends EDA_BASE_FRAME {
  m_aboutTitle: string;
  private m_panel: BITMAP2CMP_PANEL;
  private m_dropTarget: DROP_FILE;
  private m_ui: BITMAP2CMP_FRAME_UI;
  private m_config: BITMAP2CMP_SETTINGS;

  private m_srcFileName = '';
  private m_outFileName = '';

  constructor(aUi: BITMAP2CMP_FRAME_UI, aConfig: BITMAP2CMP_SETTINGS) {
    super(FRAME_T.FRAME_BM2CMP, unityScale, 'mm');

    this.m_ui = aUi;
    this.m_config = aConfig;
    this.m_aboutTitle = ABOUT_TITLES.imageConverter;

    this.m_panel = new BITMAP2CMP_PANEL(this, aUi);
    this.m_dropTarget = new DROP_FILE(this.m_panel, aUi);

    this.LoadSettings(this.config());

    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(null, null, null, this.config(), this);

    // Register tools. COMMON_CONTROL (the Help and Preferences actions) is the
    // window's: its menus call the app directly.
    this.m_toolManager.RegisterTool(new BITMAP2CMP_CONTROL());
    this.m_toolManager.InitTools();
  }

  config(): BITMAP2CMP_SETTINGS {
    return this.m_config;
  }

  GetPanel(): BITMAP2CMP_PANEL {
    return this.m_panel;
  }

  /** The DROP_FILE the three notebook pages share. */
  GetDropTarget(): DROP_FILE {
    return this.m_dropTarget;
  }

  /** Event handler for the wxID_EXIT and wxID_CLOSE events. */
  OnExit(): void {
    // Just generate a wxCloseEvent
    this.m_ui.Close();
  }

  override GetToolCanvas(): unknown {
    return this.m_panel.GetCurrentPage();
  }

  /** `OnFileHistory`: an Open Recent row; `aFile` is its image. */
  OnFileHistory(aFile: IMAGE_FILE | null): void {
    if (aFile) {
      this.OpenProjectFiles([aFile]);
      this.m_ui.Refresh();
    }
  }

  /** The window title: "<file> — Image Converter", or the bare frame name. */
  GetTitle(): string {
    let title = '';

    if (this.m_srcFileName) title = `${fullName(this.m_srcFileName)} — `;

    title += 'Image Converter';
    return title;
  }

  UpdateTitle(): void {
    this.m_ui.SetTitle(this.GetTitle());
  }

  LoadSettings(aCfg: BITMAP2CMP_SETTINGS): void {
    this.m_srcFileName = aCfg.m_BitmapFileName;
    this.m_outFileName = aCfg.m_ConvertedFileName;
    this.m_panel.LoadSettings(aCfg);
  }

  SaveSettings(aCfg: BITMAP2CMP_SETTINGS): void {
    aCfg.m_BitmapFileName = this.m_srcFileName;
    aCfg.m_ConvertedFileName = this.m_outFileName;
    this.m_panel.SaveSettings(aCfg);
  }

  /** Load Source Image, File > Open (`ACTIONS::open` through BITMAP2CMP_CONTROL). */
  async OnLoadFile(): Promise<void> {
    const file = await this.m_ui.ChooseImageFile('Choose Image', [imageFileWildcard()]);

    if (!file) return;

    if (!this.OpenProjectFiles([file])) return;

    this.m_ui.SetStatusText(file.name);
    this.UpdateTitle();
    this.m_ui.Refresh();
  }

  OpenProjectFiles(aFileSet: IMAGE_FILE[]): boolean {
    this.m_srcFileName = aFileSet[0]!.name;

    if (this.m_panel.OpenProjectFiles(aFileSet)) {
      this.m_ui.UpdateFileHistory(aFileSet[0]!);
      return true;
    }

    return false;
  }

  private export(aSpec: EXPORT_SPEC): void {
    const name = `${stem(this.m_srcFileName) || 'LOGO'}.${aSpec.ext}`;
    this.m_outFileName = name;

    const buffer: STRING_BUFFER = { value: '' };
    this.m_panel.ExportToBuffer(buffer, aSpec.format);

    if (!this.m_ui.SaveFile(aSpec.title, aSpec.filters(), name, buffer.value))
      this.m_ui.MessageBox(`File '${name}' could not be created.`);
  }

  /** Generate a file suitable to be copied into a drawing sheet (.kicad_wks) file */
  ExportDrawingSheetFormat(): void {
    this.export(EXPORTS.wks);
  }

  /** Generate a postscript file */
  ExportPostScriptFormat(): void {
    this.export(EXPORTS.ps);
  }

  /** Generate a schematic library which contains one component: the logo */
  ExportEeschemaFormat(): void {
    this.export(EXPORTS.sym);
  }

  /** Generate a footprint in S expr format */
  ExportPcbnewFormat(): void {
    this.export(EXPORTS.mod);
  }
}
