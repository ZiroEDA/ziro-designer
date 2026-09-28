// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2cmp_panel.cpp` + `.h`: `IMAGE_SIZE`,
 * `BITMAP2CMP_PANEL` and `DROP_FILE` — the panel's behaviour, with no DOM.
 * `bitmap2cmp_panel_ui.tsx` draws it (the `_base.cpp` layout and the three
 * paint handlers).
 *
 * The wx controls the C++ reads and writes are fields here holding what the
 * control holds: `m_UnitSizeX` is the text in the field, `m_PixelUnit` the
 * selected index, and so on. A handler reads the field text, exactly as
 * `OnSizeChangeX` reads `m_UnitSizeX->GetValue()`, which is why a value that
 * only exists at the field's precision is what the export uses after, say,
 * toggling the ratio lock.
 *
 * `IMAGE_SIZE`'s members are defined in `bitmap2cmp_frame.cpp`; the class is
 * declared in this unit's header, so it lives here.
 */
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import type { MessageDialogIcon, YesNoResult } from '@ziroeda/common/confirm_types.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { BM_PUT, bm_new } from '@ziroeda/potrace';
import type { BITMAP2CMP_FRAME } from './bitmap2cmp_frame.js';
import type { BITMAP2CMP_SETTINGS } from './bitmap2cmp_settings.js';
import {
  BITMAPCONV_INFO,
  DRAWING_SHEET_FMT,
  FOOTPRINT_FMT,
  POSTSCRIPT_FMT,
  SYMBOL_FMT,
  SYMBOL_PASTE_FMT,
  type OUTPUT_FMT_ID,
  type STRING_BUFFER,
} from './bitmap2component.js';
import {
  wxALPHA_OPAQUE,
  wxBitmapDepth,
  wxIMAGE_OPTION_RESOLUTIONUNIT,
  wxIMAGE_OPTION_RESOLUTIONX,
  wxIMAGE_OPTION_RESOLUTIONY,
  wxIMAGE_RESOLUTION_CM,
  wxImage,
  wxStringToDouble,
} from './wx.js';

/** the image DPI used in formats that do not define a DPI [data] */
export const DEFAULT_DPI = 300;

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/**
 * `static_cast<int>( double )` on x86-64 (`cvttsd2si`): truncation, and the
 * "integer indefinite" INT_MIN for NaN or anything out of range.
 */
function cvtInt(v: number): number {
  return Number.isFinite(v) && v > INT_MIN - 1 && v < INT_MAX + 1 ? Math.trunc(v) + 0 : INT_MIN;
}

/**
 * `KiROUND( v )` to an `int` (`math/util.h`): `std::llround` (LLONG_MIN for a
 * NaN or an infinity on x86-64), clamped to the int range.
 */
function KiROUNDInt(v: number): number {
  if (!Number.isFinite(v)) return INT_MIN;

  return Math.min(INT_MAX, Math.max(INT_MIN, KiROUND(v)));
}

export class IMAGE_SIZE {
  /** The units for m_outputSize (mm, inch, dpi) */
  private m_unit: EdaUnits;
  /**
   * The size in m_unit of the output image, depending on the user settings.
   * Set to the initial image size.
   */
  private m_outputSize: number;
  /** The image DPI if specified in file, or 0 if unknown */
  private m_originalDPI: number;
  /** The original image size read from file, in pixels */
  private m_originalSizePixels: number;

  constructor() {
    this.m_outputSize = 0.0;
    this.m_originalDPI = DEFAULT_DPI;
    this.m_originalSizePixels = 0;
    this.m_unit = 'mm';
  }

  /** The copy KiCad's value semantics make on every assignment. */
  Clone(): IMAGE_SIZE {
    const c = new IMAGE_SIZE();
    c.m_unit = this.m_unit;
    c.m_outputSize = this.m_outputSize;
    c.m_originalDPI = this.m_originalDPI;
    c.m_originalSizePixels = this.m_originalSizePixels;
    return c;
  }

  /**
   * Set the unit used for m_outputSize, and convert the old m_outputSize value
   * to the value in new unit.
   */
  SetUnit(aUnit: EdaUnits): void {
    if (aUnit === this.m_unit) return;

    // Convert m_outputSize to mm:
    let size_mm: number;

    if (this.m_unit === 'mm') {
      size_mm = this.m_outputSize;
    } else if (this.m_unit === 'in') {
      size_mm = this.m_outputSize * 25.4;
    } else {
      // m_outputSize is the DPI, not an image size
      // the image size is m_originalSizePixels / m_outputSize (in inches)
      if (this.m_outputSize) size_mm = (this.m_originalSizePixels / this.m_outputSize) * 25.4;
      else size_mm = 0;
    }

    // Convert m_outputSize to new value:
    if (aUnit === 'mm') {
      this.m_outputSize = size_mm;
    } else if (aUnit === 'in') {
      this.m_outputSize = size_mm / 25.4;
    } else {
      if (size_mm) this.m_outputSize = (this.m_originalSizePixels / size_mm) * 25.4;
      else this.m_outputSize = 0;
    }

    this.m_unit = aUnit;
  }

  SetOriginalDPI(aDPI: number): void {
    this.m_originalDPI = aDPI;
  }

  SetOriginalSizePixels(aPixels: number): void {
    this.m_originalSizePixels = aPixels;
  }

  GetOriginalSizePixels(): number {
    return this.m_originalSizePixels;
  }

  GetOutputSize(): number {
    return this.m_outputSize;
  }

  SetOutputSize(aSize: number, aUnit: EdaUnits): void {
    this.m_outputSize = aSize;
    this.m_unit = aUnit;
  }

  /** Set the m_outputSize value from the m_originalSizePixels and the selected unit */
  SetOutputSizeFromInitialImageSize(): void {
    // Safety-check to guarantee no divide-by-zero
    this.m_originalDPI = Math.max(1, this.m_originalDPI);

    // Set the m_outputSize value from the m_originalSizePixels and the selected unit
    if (this.m_unit === 'mm')
      this.m_outputSize = (this.GetOriginalSizePixels() / this.m_originalDPI) * 25.4;
    else if (this.m_unit === 'in')
      this.m_outputSize = this.GetOriginalSizePixels() / this.m_originalDPI;
    else this.m_outputSize = this.m_originalDPI;
  }

  /**
   * @return the pixels per inch value to build the output image. It is used by
   * potrace to build the polygonal image. An `int`: the division truncates.
   */
  GetOutputDPI(): number {
    let outputDPI: number;

    if (this.m_unit === 'mm')
      outputDPI = cvtInt(this.GetOriginalSizePixels() / (this.m_outputSize / 25.4));
    else if (this.m_unit === 'in')
      outputDPI = cvtInt(this.GetOriginalSizePixels() / this.m_outputSize);
    else outputDPI = KiROUNDInt(this.m_outputSize);

    // Zero is not a DPI, and may cause divide-by-zero errors...
    outputDPI = Math.max(1, outputDPI);

    return outputDPI;
  }
}

/** `m_PixelUnit`'s choices, appended in the constructor. [data] */
export const PIXEL_UNIT_CHOICES = ['mm', 'Inch', 'DPI'] as const;

/** `m_layerCtrl`'s choices (`bitmap2cmp_panel_base.cpp`). [data] */
export const LAYER_CHOICES = [
  'F.Cu',
  'F.Silkscreen',
  'F.Mask',
  'User.Drawings',
  'User.Comments',
  'User.Eco1',
  'User.Eco2',
  'F.Fab',
] as const;

/** The notebook pages, in `AddPage` order. [data] */
export const NOTEBOOK_PAGES = [
  'Original Picture',
  'Greyscale Picture',
  'Black && White Picture',
] as const;

/**
 * The wx services the panel calls as globals: `wxMessageBox`,
 * `KICAD_MESSAGE_DIALOG::ShowModal`, `wxTheClipboard`. The frame's window
 * supplies them.
 */
export interface BITMAP2CMP_PANEL_UI {
  /** `wxMessageBox( aMessage, aCaption )`; the caption defaults to "Message". */
  MessageBox(aMessage: string, aCaption?: string): void;
  /** A modal yes/no question; resolves with the button pressed. */
  AskYesNo(
    aMessage: string,
    aCaption: string,
    aIcon: MessageDialogIcon,
    aDefault: YesNoResult,
  ): Promise<YesNoResult>;
  /** `wxTheClipboard->Open()` .. `SetData( wxTextDataObject )` .. `Close()`: false when it cannot open. */
  SetClipboardText(aText: string): Promise<boolean>;
  /** `Refresh()`: the panel's controls changed. */
  Refresh(): void;
}

/** A file handed to `OpenProjectFiles`: its name and its bytes, decoded or not. */
export interface IMAGE_FILE {
  /** The full name, as the file chooser or the drop gives it. */
  name: string;
  /** The file's bytes. */
  bytes: Uint8Array;
  /**
   * The browser's decode (a canvas's RGBA), or null when it could not
   * decode the file at all.
   */
  rgba: { data: Uint8ClampedArray; width: number; height: number } | null;
}

export class BITMAP2CMP_PANEL {
  private m_parentFrame: BITMAP2CMP_FRAME;
  private m_ui: BITMAP2CMP_PANEL_UI;

  /* ---- the controls (BITMAP2CMP_PANEL_BASE), as the values they hold ---- */
  /** `m_Notebook`: the selected page; "Black && White Picture" is added selected. */
  m_NotebookSelection = 2;
  /** `m_SizeXValue`, `m_SizeYValue`, `m_InputXValueDPI`, `m_InputYValueDPI`, `m_BPPValue`: "0000" until an image loads. */
  m_SizeXValue = '0000';
  m_SizeYValue = '0000';
  m_InputXValueDPI = '0000';
  m_InputYValueDPI = '0000';
  m_BPPValue = '0000';
  /** `m_UnitSizeX`, `m_UnitSizeY`: the field text. The base class starts both at "300". */
  m_UnitSizeX = '300';
  m_UnitSizeY = '300';
  /** `m_PixelUnit`: the selected index (mm, Inch, DPI). */
  m_PixelUnit = 0;
  /** `m_aspectRatioCheckbox`. */
  m_aspectRatioCheckbox = false;
  /** `m_sliderThreshold`: 0 .. 100, 50 in the base class. */
  m_sliderThreshold = 50;
  readonly m_sliderThresholdMax = 100;
  /** `m_checkNegative`. */
  m_checkNegative = false;
  /** `m_rbSymbol`, `m_rbFootprint`, `m_rbPostscript`, `m_rbWorksheet`: the first is checked in a fresh group. */
  m_rbSymbol = true;
  m_rbFootprint = false;
  m_rbPostscript = false;
  m_rbWorksheet = false;
  /** `m_layerLabel->Enable()` / `m_layerCtrl->Enable()`. */
  m_layerEnabled = true;
  /** `m_layerCtrl`: the selected index. */
  m_layerCtrl = 0;
  /** `m_buttonExportFile->Enable()` / `m_buttonExportClipboard->Enable()`. */
  m_buttonExportFileEnabled = true;
  m_buttonExportClipboardEnabled = true;

  /* ---- BITMAP2CMP_PANEL's own members ---- */
  m_Pict_Image: wxImage | null = null;
  /** `m_Pict_Bitmap`: the image, and its depth as `wxBitmap` reports it. */
  m_Pict_Bitmap: { image: wxImage; depth: number } | null = null;
  m_Greyscale_Image: wxImage | null = null;
  m_Greyscale_Bitmap: wxImage | null = null;
  m_NB_Image: wxImage | null = null;
  m_BN_Bitmap: wxImage | null = null;
  private m_outputSizeX = new IMAGE_SIZE();
  private m_outputSizeY = new IMAGE_SIZE();
  private m_negative: boolean;
  private m_aspectRatio: number;

  constructor(aParent: BITMAP2CMP_FRAME, aUi: BITMAP2CMP_PANEL_UI) {
    this.m_parentFrame = aParent;
    this.m_ui = aUi;
    this.m_negative = false;
    this.m_aspectRatio = 1.0;

    // for( const wxString& unit : { _( "mm" ), _( "Inch" ), _( "DPI" ) } ) m_PixelUnit->Append( unit );

    this.m_outputSizeX.SetUnit(this.getUnitFromSelection());
    this.m_outputSizeY.SetUnit(this.getUnitFromSelection());
    this.m_outputSizeX.SetOutputSize(0, this.getUnitFromSelection());
    this.m_outputSizeY.SetOutputSize(0, this.getUnitFromSelection());

    this.m_UnitSizeX = this.formatOutputSize(this.m_outputSizeX.GetOutputSize());
    this.m_UnitSizeY = this.formatOutputSize(this.m_outputSizeY.GetOutputSize());

    this.m_buttonExportFileEnabled = false;
    this.m_buttonExportClipboardEnabled = false;
  }

  GetCurrentPage(): number {
    return this.m_NotebookSelection;
  }

  LoadSettings(cfg: BITMAP2CMP_SETTINGS): void {
    if (cfg.m_Units >= 0 && cfg.m_Units < PIXEL_UNIT_CHOICES.length) this.m_PixelUnit = cfg.m_Units;

    this.m_sliderThreshold = Math.min(this.m_sliderThresholdMax, Math.max(0, cfg.m_Threshold));

    this.m_negative = cfg.m_Negative;
    this.m_checkNegative = cfg.m_Negative;

    this.m_aspectRatio = 1.0;
    this.m_aspectRatioCheckbox = true;

    this.m_rbSymbol = this.m_rbFootprint = this.m_rbPostscript = this.m_rbWorksheet = false;

    switch (cfg.m_LastFormat) {
      case SYMBOL_FMT:
      case SYMBOL_PASTE_FMT:
        this.m_rbSymbol = true;
        break;
      case POSTSCRIPT_FMT:
        this.m_rbPostscript = true;
        break;
      case DRAWING_SHEET_FMT:
        this.m_rbWorksheet = true;
        break;
      default: // FOOTPRINT_FMT
        this.m_rbFootprint = true;
        break;
    }

    this.m_layerEnabled = cfg.m_LastFormat === FOOTPRINT_FMT;

    if (cfg.m_LastLayer >= 0 && cfg.m_LastLayer < LAYER_CHOICES.length)
      this.m_layerCtrl = cfg.m_LastLayer;
  }

  SaveSettings(cfg: BITMAP2CMP_SETTINGS): void {
    cfg.m_Threshold = this.m_sliderThreshold;
    cfg.m_Negative = this.m_checkNegative;
    cfg.m_LastFormat = this.getOutputFormat();
    cfg.m_LastLayer = this.m_layerCtrl;
    cfg.m_Units = this.m_PixelUnit;
  }

  /** `OnLoadFile`: the Load Source Image button. */
  OnLoadFile(): void {
    void this.m_parentFrame.OnLoadFile();
  }

  /**
   * `OpenProjectFiles( aFileSet )`: load the first file, fill in the image
   * information, build the greyscale and black & white images.
   */
  OpenProjectFiles(aFileSet: IMAGE_FILE[]): boolean {
    this.m_Pict_Image = null;

    const file = aFileSet[0]!;
    const image = file.rgba
      ? wxImage.Load(file.bytes, file.rgba.data, file.rgba.width, file.rgba.height)
      : null;

    if (!image) {
      // LoadFile has its own UI, no need for further failure notification here
      this.m_ui.MessageBox(
        `Unknown image data format.\nFailed to load image from file "${file.name}".`,
        'Error',
      );
      return false;
    }

    this.m_Pict_Image = image;
    this.m_Pict_Bitmap = { image, depth: wxBitmapDepth(image) };

    // Determine image resolution in DPI (does not existing in all formats).
    // the resolution can be given in bit per inches or bit per cm in file

    let imageDPIx = image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONX);
    let imageDPIy = image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONY);

    if (imageDPIx > 1 && imageDPIy > 1) {
      if (image.GetOptionInt(wxIMAGE_OPTION_RESOLUTIONUNIT) === wxIMAGE_RESOLUTION_CM) {
        imageDPIx = KiROUNDInt(imageDPIx * 2.54);
        imageDPIy = KiROUNDInt(imageDPIy * 2.54);
      }
    } else {
      // fallback to a default value (DEFAULT_DPI)
      imageDPIx = imageDPIy = DEFAULT_DPI;
    }

    this.m_InputXValueDPI = String(imageDPIx);
    this.m_InputYValueDPI = String(imageDPIy);

    const h = image.GetHeight();
    const w = image.GetWidth();
    this.m_aspectRatio = w / h;

    this.m_outputSizeX.SetOriginalDPI(imageDPIx);
    this.m_outputSizeX.SetOriginalSizePixels(w);
    this.m_outputSizeY.SetOriginalDPI(imageDPIy);
    this.m_outputSizeY.SetOriginalSizePixels(h);

    // Update display to keep aspect ratio
    this.OnSizeChangeX();

    this.updateImageInfo();

    this.m_Greyscale_Image = image.ConvertToGreyscale();

    if (image.HasMask()) {
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          if (
            image.GetRed(x, y) === image.GetMaskRed() &&
            image.GetGreen(x, y) === image.GetMaskGreen() &&
            image.GetBlue(x, y) === image.GetMaskBlue()
          ) {
            this.m_Greyscale_Image.SetRGB(x, y, 255, 255, 255);
          }
        }
      }
    }

    if (this.m_negative) this.negateGreyscaleImage();

    this.m_Greyscale_Bitmap = this.m_Greyscale_Image.Copy();
    this.m_NB_Image = this.m_Greyscale_Image.Copy();
    this.binarize(this.m_sliderThreshold / this.m_sliderThresholdMax);

    this.m_buttonExportFileEnabled = true;
    this.m_buttonExportClipboardEnabled = true;

    this.m_outputSizeX.SetOutputSizeFromInitialImageSize();
    this.m_UnitSizeX = this.formatOutputSize(this.m_outputSizeX.GetOutputSize());
    this.m_outputSizeY.SetOutputSizeFromInitialImageSize();
    this.m_UnitSizeY = this.formatOutputSize(this.m_outputSizeY.GetOutputSize());

    return true;
  }

  GetOutputSizeX(): IMAGE_SIZE {
    return this.m_outputSizeX.Clone();
  }

  GetOutputSizeY(): IMAGE_SIZE {
    return this.m_outputSizeY.Clone();
  }

  SetOutputSize(aSizeX: IMAGE_SIZE, aSizeY: IMAGE_SIZE): void {
    this.m_outputSizeX = aSizeX.Clone();
    this.m_outputSizeY = aSizeY.Clone();
    this.updateImageInfo();

    this.m_UnitSizeX = this.formatOutputSize(this.m_outputSizeX.GetOutputSize());
    this.m_UnitSizeY = this.formatOutputSize(this.m_outputSizeY.GetOutputSize());
  }

  /** return a string giving the output size, according to the selected unit */
  formatOutputSize(aSize: number): string {
    if (this.getUnitFromSelection() === 'mm') return fixed(aSize, 1);
    else if (this.getUnitFromSelection() === 'in') return fixed(aSize, 2);
    else return String(KiROUNDInt(aSize));
  }

  private updateImageInfo(): void {
    // Note: the image resolution text controls are not modified here, to avoid a race between
    // text change when entered by user and a text change if it is modified here.

    if (this.m_Pict_Bitmap) {
      this.m_SizeXValue = String(this.m_Pict_Bitmap.image.GetWidth());
      this.m_SizeYValue = String(this.m_Pict_Bitmap.image.GetHeight());
      this.m_BPPValue = String(this.m_Pict_Bitmap.depth);
    }
  }

  /** @return the EDA_UNITS from the m_PixelUnit choice */
  getUnitFromSelection(): EdaUnits {
    switch (this.m_PixelUnit) {
      case 1:
        return 'in';
      case 2:
        return 'unscaled';
      default:
        return 'mm';
    }
  }

  /** `m_UnitSizeX`'s wxEVT_COMMAND_TEXT_UPDATED: the user typed `aText`. */
  SetUnitSizeXText(aText: string): void {
    this.m_UnitSizeX = aText;
    this.OnSizeChangeX();
    this.m_ui.Refresh();
  }

  /** `m_UnitSizeY`'s wxEVT_COMMAND_TEXT_UPDATED. */
  SetUnitSizeYText(aText: string): void {
    this.m_UnitSizeY = aText;
    this.OnSizeChangeY();
    this.m_ui.Refresh();
  }

  OnSizeChangeX(): void {
    const new_size = wxStringToDouble(this.m_UnitSizeX);

    if (new_size !== null) {
      if (this.m_aspectRatioCheckbox) {
        let calculatedY = new_size / this.m_aspectRatio;

        if (this.getUnitFromSelection() === 'unscaled') {
          // for units in DPI, keeping aspect ratio cannot use m_AspectRatioLocked.
          // just re-scale the other dpi
          const ratio = new_size / this.m_outputSizeX.GetOutputSize();
          calculatedY = this.m_outputSizeY.GetOutputSize() * ratio;
        }

        this.m_outputSizeY.SetOutputSize(calculatedY, this.getUnitFromSelection());
        this.m_UnitSizeY = this.formatOutputSize(this.m_outputSizeY.GetOutputSize());
      }

      this.m_outputSizeX.SetOutputSize(new_size, this.getUnitFromSelection());
    }

    this.updateImageInfo();
  }

  OnSizeChangeY(): void {
    const new_size = wxStringToDouble(this.m_UnitSizeY);

    if (new_size !== null) {
      if (this.m_aspectRatioCheckbox) {
        let calculatedX = new_size * this.m_aspectRatio;

        if (this.getUnitFromSelection() === 'unscaled') {
          // for units in DPI, keeping aspect ratio cannot use m_AspectRatioLocked.
          // just re-scale the other dpi
          const ratio = new_size / this.m_outputSizeX.GetOutputSize();
          calculatedX = this.m_outputSizeX.GetOutputSize() * ratio;
        }

        this.m_outputSizeX.SetOutputSize(calculatedX, this.getUnitFromSelection());
        this.m_UnitSizeX = this.formatOutputSize(this.m_outputSizeX.GetOutputSize());
      }

      this.m_outputSizeY.SetOutputSize(new_size, this.getUnitFromSelection());
    }

    this.updateImageInfo();
  }

  /** `m_PixelUnit`'s wxEVT_COMMAND_CHOICE_SELECTED. */
  OnSizeUnitChange(aSelection: number): void {
    this.m_PixelUnit = aSelection;
    this.m_outputSizeX.SetUnit(this.getUnitFromSelection());
    this.m_outputSizeY.SetUnit(this.getUnitFromSelection());
    this.updateImageInfo();

    this.m_UnitSizeX = this.formatOutputSize(this.m_outputSizeX.GetOutputSize());
    this.m_UnitSizeY = this.formatOutputSize(this.m_outputSizeY.GetOutputSize());
    this.m_ui.Refresh();
  }

  /** `m_aspectRatioCheckbox`'s wxEVT_COMMAND_CHECKBOX_CLICKED. */
  ToggleAspectRatioLock(aChecked: boolean): void {
    this.m_aspectRatioCheckbox = aChecked;

    if (this.m_aspectRatioCheckbox) {
      // Force display update when aspect ratio is locked
      this.OnSizeChangeX();
    }

    this.m_ui.Refresh();
  }

  /** aThreshold = 0.0 (black level) to 1.0 (white level) */
  private binarize(aThreshold: number): void {
    const grey = this.m_Greyscale_Image;
    const nb = this.m_NB_Image;

    if (!grey || !nb) return;

    // unsigned char threshold = aThreshold * 255; unsigned char alpha_thresh = 0.7 * threshold;
    const threshold = Math.trunc(aThreshold * 255);
    const alpha_thresh = Math.trunc(0.7 * threshold);

    for (let y = 0; y < grey.GetHeight(); y++) {
      for (let x = 0; x < grey.GetWidth(); x++) {
        let pixel = grey.GetGreen(x, y);
        const alpha = grey.HasAlpha() ? grey.GetAlpha(x, y) : wxALPHA_OPAQUE;

        if (pixel < threshold && alpha > alpha_thresh) pixel = 0;
        else pixel = 255;

        nb.SetRGB(x, y, pixel, pixel, pixel);
      }
    }

    this.m_BN_Bitmap = nb.Copy();
  }

  private negateGreyscaleImage(): void {
    const grey = this.m_Greyscale_Image;

    if (!grey) return;

    for (let y = 0; y < grey.GetHeight(); y++) {
      for (let x = 0; x < grey.GetWidth(); x++) {
        const pixel = ~grey.GetGreen(x, y) & 0xff;
        grey.SetRGB(x, y, pixel, pixel, pixel);
      }
    }
  }

  /** `m_checkNegative`'s wxEVT_COMMAND_CHECKBOX_CLICKED. */
  OnNegativeClicked(aChecked: boolean): void {
    this.m_checkNegative = aChecked;

    if (this.m_checkNegative !== this.m_negative) {
      this.negateGreyscaleImage();

      this.m_Greyscale_Bitmap = this.m_Greyscale_Image ? this.m_Greyscale_Image.Copy() : null;
      this.binarize(this.m_sliderThreshold / this.m_sliderThresholdMax);
      this.m_negative = this.m_checkNegative;
    }

    this.m_ui.Refresh();
  }

  /** `m_sliderThreshold`'s wxEVT_SCROLL_CHANGED / wxEVT_SCROLL_THUMBTRACK. */
  OnThresholdChange(aValue: number): void {
    this.m_sliderThreshold = aValue;
    this.binarize(this.m_sliderThreshold / this.m_sliderThresholdMax);
    this.m_ui.Refresh();
  }

  /** The Export to File... button. */
  OnExportToFile(): void {
    switch (this.getOutputFormat()) {
      case SYMBOL_FMT:
      case SYMBOL_PASTE_FMT:
        void this.m_parentFrame.ExportEeschemaFormat();
        break;
      case FOOTPRINT_FMT:
        void this.m_parentFrame.ExportPcbnewFormat();
        break;
      case POSTSCRIPT_FMT:
        void this.m_parentFrame.ExportPostScriptFormat();
        break;
      case DRAWING_SHEET_FMT:
        void this.m_parentFrame.ExportDrawingSheetFormat();
        break;
    }
  }

  getOutputFormat(): OUTPUT_FMT_ID {
    if (this.m_rbSymbol) return SYMBOL_FMT;
    else if (this.m_rbPostscript) return POSTSCRIPT_FMT;
    else if (this.m_rbWorksheet) return DRAWING_SHEET_FMT;
    else return FOOTPRINT_FMT;
  }

  /** The Export to Clipboard button. */
  async OnExportToClipboard(): Promise<void> {
    const buffer: STRING_BUFFER = { value: '' };
    const format =
      this.getOutputFormat() === SYMBOL_FMT ? SYMBOL_PASTE_FMT : this.getOutputFormat();
    this.ExportToBuffer(buffer, format);

    // Write buffer to the clipboard
    if (!(await this.m_ui.SetClipboardText(buffer.value)))
      this.m_ui.MessageBox('Unable to export to the Clipboard');
  }

  /**
   * generate a export data of the current bitmap.
   * @param aOutput is a string buffer to fill with data
   * @param aFormat is the format to generate
   */
  ExportToBuffer(aOutput: STRING_BUFFER, aFormat: OUTPUT_FMT_ID): void {
    const nb = this.m_NB_Image;
    const w = nb ? nb.GetWidth() : 0;
    const h = nb ? nb.GetHeight() : 0;

    // Create a potrace bitmap
    const potrace_bitmap = bm_new(w, h);

    if (!potrace_bitmap) {
      this.m_ui.MessageBox('Error allocating memory for potrace bitmap');
      return;
    }

    /* fill the bitmap with data */
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pixel = nb!.GetGreen(x, y);
        BM_PUT(potrace_bitmap, x, y, pixel ? 0 : 1);
      }
    }

    let layer = 'F.SilkS';

    if (aFormat === FOOTPRINT_FMT) {
      switch (this.m_layerCtrl) {
        case 0:
          layer = 'F.Cu';
          break;
        case 1:
          layer = 'F.SilkS';
          break;
        case 2:
          layer = 'F.Mask';
          break;
        case 3:
          layer = 'Dwgs.User';
          break;
        case 4:
          layer = 'Cmts.User';
          break;
        case 5:
          layer = 'Eco1.User';
          break;
        case 6:
          layer = 'Eco2.User';
          break;
        case 7:
          layer = 'F.Fab';
          break;
      }
    }

    const reporter = new Reporter();
    const converter = new BITMAPCONV_INFO(aOutput, reporter);

    converter.ConvertBitmap(
      potrace_bitmap,
      aFormat,
      this.m_outputSizeX.GetOutputDPI(),
      this.m_outputSizeY.GetOutputDPI(),
      layer,
    );

    if (reporter.hasMessage())
      this.m_ui.MessageBox(reporter.lines.map((l) => l.message).join('\n'), 'Errors');
  }

  /** A radio button's wxEVT_COMMAND_RADIOBUTTON_SELECTED: `aFormat`'s button was chosen. */
  SelectFormat(aFormat: OUTPUT_FMT_ID): void {
    this.m_rbSymbol = aFormat === SYMBOL_FMT;
    this.m_rbFootprint = aFormat === FOOTPRINT_FMT;
    this.m_rbPostscript = aFormat === POSTSCRIPT_FMT;
    this.m_rbWorksheet = aFormat === DRAWING_SHEET_FMT;
    this.OnFormatChange();
    this.m_ui.Refresh();
  }

  private OnFormatChange(): void {
    this.m_layerEnabled = this.m_rbFootprint;
  }

  /** `m_layerCtrl`'s selection. */
  SetLayerSelection(aIndex: number): void {
    this.m_layerCtrl = aIndex;
    this.m_ui.Refresh();
  }

  /** `m_Notebook`'s page selection (the notebook has no handler of its own). */
  SetNotebookSelection(aPage: number): void {
    this.m_NotebookSelection = aPage;
    this.m_ui.Refresh();
  }
}

/** `DROP_FILE`'s question. [data] */
export const REPLACE_LOADED_FILE_CAPTION = 'Replace Loaded File?';
export const REPLACE_LOADED_FILE_MESSAGE =
  'There is already a file loaded. Do you want to replace it?';

/**
 * `DROP_FILE`: the drop target on each of the three notebook pages. Asks
 * before replacing a loaded image (`wxYES_NO | wxICON_QUESTION |
 * wxYES_DEFAULT`), then opens the dropped files.
 */
export class DROP_FILE {
  private m_panel: BITMAP2CMP_PANEL;
  private m_ui: BITMAP2CMP_PANEL_UI;

  constructor(panel: BITMAP2CMP_PANEL, aUi: BITMAP2CMP_PANEL_UI) {
    this.m_panel = panel;
    this.m_ui = aUi;
  }

  async OnDropFiles(filenames: IMAGE_FILE[]): Promise<boolean> {
    // If a file is already loaded
    if (this.m_panel.GetOutputSizeX().GetOriginalSizePixels() !== 0) {
      const replace = await this.m_ui.AskYesNo(
        REPLACE_LOADED_FILE_MESSAGE,
        REPLACE_LOADED_FILE_CAPTION,
        'question',
        'yes',
      );

      if (replace === 'no') return false;
    }

    /* m_panel->OpenProjectFiles( fNameVec ): the panel's, not the frame's, so
     * a dropped file is neither the frame's m_srcFileName nor in its history. */
    this.m_panel.OpenProjectFiles(filenames);
    this.m_ui.Refresh();

    return true;
  }
}
