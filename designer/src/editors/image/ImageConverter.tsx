// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Image Converter frame, the browser counterpart of KiCad's `bitmap2cmp`
 * (`bitmap2cmp_frame.cpp` + `bitmap2cmp_panel.cpp`). The layout mirrors
 * `bitmap2cmp_panel_base`: a left preview notebook (Original / Greyscale /
 * Black & White) and a right column of groups, Image Information, Load Source
 * Image, Output Size, Options (threshold + negative), Output Format (with the
 * footprint Layer choice), then Export to File / Export to Clipboard.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { Combo } from '../../ui/Combo.js';
import { MenuBar, type Menu, type MenuItem } from '../../ui/MenuBar.js';
import { MessageDialogYesNo } from '../../ui/dialog_message.js';
import type { YesNoResult } from '../../ui/message_dialog.js';
import {
  acceptDrop,
  askBeforeReplace,
  REPLACE_LOADED_FILE_CAPTION,
  REPLACE_LOADED_FILE_DEFAULT,
  REPLACE_LOADED_FILE_ICON,
  REPLACE_LOADED_FILE_MESSAGE,
} from './dropFile.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { Reporter } from '@ziroeda/common/src/reporter.js';
import { bitmapDepth, imageMeta } from './imageMeta.js';
import {
  loadBitmap2CmpSettings,
  recentImages,
  RECENT_MAX_DATA,
  saveBitmap2CmpSettings,
} from './bitmap2cmpSettings.js';
import {
  MISSING_FILE_EXTENDED,
  missingFileMessage,
  openRecentMenuItem,
} from '../../ui/file_history.js';
import { useFileHistory } from '../../ui/useFileHistory.js';
import { setLanguageMenuItem } from '../../ui/language_menu.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';
import {
  convert,
  grayToMono,
  grayToRGBA,
  imageToGray,
  monoToRGBA,
  OUTLINE_LAYERS,
  type GrayImage,
  type OutputFormat,
} from './bitmap2component.js';
import {
  convertOutputSize,
  formatOutputSize,
  initialOutputSize,
  outputDpi,
  parseOutputSize,
  SIZE_UNITS,
  type SizeUnit,
} from './imageSize.js';
import './imageConverter.css';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES, aboutWindowTitle } from '../../ui/about_titles.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { useMenuHotkeys } from '../../ui/useMenuHotkeys.js';
import { addQuit } from '../../ui/action_menu.js';

type Tab = 'original' | 'greyscale' | 'bw';

const TABS: { id: Tab; label: string }[] = [
  { id: 'original', label: 'Original Picture' },
  { id: 'greyscale', label: 'Greyscale Picture' },
  { id: 'bw', label: 'Black & White Picture' },
];

// A page's wxEVT_PAINT handler: PrepareDC then DrawBitmap( bmp, 0, 0 ). The
// canvas is sized to the bitmap itself, never to the pane, so the preview is
// 1:1 and the pane scrolls (bitmap2cmp_panel.cpp:120-171, :231-233).
const paintPage = (cv: HTMLCanvasElement | null, data: ImageData | null): void => {
  if (!cv || !data) return;
  cv.width = data.width;
  cv.height = data.height;
  cv.getContext('2d')?.putImageData(data, 0, 0);
};

// KiCad's Output Format radio group (bitmap2cmp_panel_base), with the file
// extensions it shows and the engine format id each maps to.
const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'symbol', label: 'Symbol (.kicad_sym file)' },
  { id: 'footprint', label: 'Footprint (.kicad_mod file)' },
  { id: 'postscript', label: 'Postscript (.ps file)' },
  { id: 'drawingsheet', label: 'Drawing Sheet (.kicad_wks file)' },
];

const DEFAULT_DPI = 300; // KiCad's DEFAULT_DPI when the image carries no resolution

// OUTPUT_FMT_ID ↔ our format ids, following LoadSettings' switch: symbol and
// symbol-paste both select the Symbol radio; anything unknown means footprint.
const FORMAT_BY_ID: Record<number, OutputFormat> = {
  0: 'symbol',
  1: 'symbol',
  2: 'footprint',
  3: 'postscript',
  4: 'drawingsheet',
};
const ID_BY_FORMAT: Record<OutputFormat, number> = {
  symbol: 0,
  footprint: 2,
  postscript: 3,
  drawingsheet: 4,
};

const bytesToDataUrl = (bytes: Uint8Array, type: string): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || 'image/png'};base64,${btoa(bin)}`;
};

interface Loaded {
  /** File name without extension, used as the download file stem. */
  name: string;
  /** Full file name, shown in the title bar (KiCad's UpdateTitle). */
  fullName: string;
  w: number;
  h: number;
  bpp: number;
  originalDPIX: number;
  originalDPIY: number;
  original: ImageData;
  gray: GrayImage;
}

export function ImageConverter({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One canvas per notebook page, mirroring the three wxScrolledWindows and the
  // three bitmaps (m_Pict_Bitmap / m_Greyscale_Bitmap / m_BN_Bitmap) that
  // BITMAP2CMP_PANEL keeps alive at once. Each page then scrolls on its own.
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const greyscaleCanvasRef = useRef<HTMLCanvasElement>(null);
  const bwCanvasRef = useRef<HTMLCanvasElement>(null);

  // BITMAP2CMP_SETTINGS: units, threshold, negative, format and layer survive
  // restarts (LoadSettings); the aspect-ratio lock always starts locked.
  const [cfg] = useState(loadBitmap2CmpSettings);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('bw');
  const [unit, setUnit] = useState<SizeUnit>(() => SIZE_UNITS[cfg.units]?.id ?? 'mm');
  // The two IMAGE_SIZEs and the two text fields are separate state, exactly as
  // in KiCad: m_outputSizeX holds the full-precision size the export uses, and
  // m_UnitSizeX is only its display (ChangeValue, so writing it fires nothing).
  // A field the user has half-typed, or cleared, therefore cannot move the
  // export until it parses (BITMAP2CMP_PANEL::OnSizeChangeX).
  const [outX, setOutX] = useState(() => formatOutputSize(0, SIZE_UNITS[cfg.units]?.id ?? 'mm'));
  const [outY, setOutY] = useState(() => formatOutputSize(0, SIZE_UNITS[cfg.units]?.id ?? 'mm'));
  const [sizeX, setSizeX] = useState(0);
  const [sizeY, setSizeY] = useState(0);
  const [lock, setLock] = useState(true);
  const [threshold, setThreshold] = useState(() =>
    Math.min(100, Math.max(0, Math.round(cfg.threshold))),
  );
  const [negative, setNegative] = useState(cfg.negative);
  const [format, setFormat] = useState<OutputFormat>(FORMAT_BY_ID[cfg.last_format] ?? 'footprint');
  const [layerIdx, setLayerIdx] = useState(() =>
    cfg.last_mod_layer >= 0 && cfg.last_mod_layer < OUTLINE_LAYERS.length ? cfg.last_mod_layer : 0,
  );
  // BITMAP2CMP_FRAME's file history, the shared FILE_HISTORY port.
  const recent = useFileHistory(recentImages);
  const common = useCommonSettings();
  const [convertedName, setConvertedName] = useState(cfg.converted_file_name);
  // KiCad's status bar starts empty and shows the loaded file (OnLoadFile).
  const [status, setStatus] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  // The file a drop is holding while "Replace Loaded File?" is up.
  const [dropPending, setDropPending] = useState<File | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the box is up, so it does not
  // sit on the stack swallowing the key for the frame behind it.
  useModalEscape(() => setAboutOpen(false), aboutOpen);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // SaveSettings: persist the panel state whenever it changes.
  useEffect(() => {
    saveBitmap2CmpSettings({
      bitmap_file_name: loaded?.fullName ?? cfg.bitmap_file_name,
      converted_file_name: convertedName,
      units: SIZE_UNITS.findIndex((u) => u.id === unit),
      threshold,
      negative,
      last_format: ID_BY_FORMAT[format],
      last_mod_layer: layerIdx,
    });
  }, [cfg, loaded, convertedName, unit, threshold, negative, format, layerIdx]);

  // The 1-bit bitmap shared by the Black & White preview and every export.
  // BITMAP2CMP_PANEL::binarize takes the slider as a fraction of its maximum
  // (`value / max`) and turns it into a whole grey level itself.
  // With no image loaded OnThresholdChange (bitmap2cmp_panel.cpp:461-465) still
  // runs binarize(), which walks a zero-height m_Greyscale_Image and does
  // nothing before Refresh() — the same no-op this `null` is.
  const mono = useMemo(
    () => (loaded ? grayToMono(loaded.gray, (threshold / 100) * 255, negative) : null),
    [loaded, threshold, negative],
  );

  // OnPaintInit / OnPaintGreyscale / OnPaintBW each draw their own bitmap at
  // (0, 0) into their own page; none of them depends on which page is showing,
  // and a threshold change rebuilds only the black & white one. The Greyscale
  // page shows the negated image when Negative is on, exactly as KiCad negates
  // the greyscale before binarizing.
  useEffect(() => {
    paintPage(originalCanvasRef.current, loaded?.original ?? null);
  }, [loaded]);
  useEffect(() => {
    paintPage(greyscaleCanvasRef.current, loaded ? grayToRGBA(loaded.gray, negative) : null);
  }, [loaded, negative]);
  useEffect(() => {
    paintPage(bwCanvasRef.current, mono ? monoToRGBA(mono) : null);
  }, [mono]);

  const loadFile = useCallback(
    async (file: File) => {
      setStatus(`Loading ${file.name}...`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const bmp = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/png' }));
        const w = bmp.width;
        const h = bmp.height;
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const cx = cv.getContext('2d');
        if (!cx) throw new Error('Cannot get a 2D drawing context.');
        cx.drawImage(bmp, 0, 0);
        bmp.close();
        const original = cx.getImageData(0, 0, w, h);
        const gray = imageToGray(original.data, w, h);
        const meta = imageMeta(bytes);
        setLoaded({
          name: file.name.replace(/\.[^.]+$/, '') || 'LOGO',
          fullName: file.name,
          w,
          h,
          bpp: bitmapDepth(original.data),
          originalDPIX: meta.dpiX,
          originalDPIY: meta.dpiY,
          original,
          gray,
        });
        // SetOutputSizeFromInitialImageSize: the image at its native PPI. The
        // size kept is the full-precision one; only the field is rounded, so a
        // 24 px image at 300 PPI still exports at 300 DPI and not at the 304
        // that reading "2.0" back out of the field would give.
        const sx = initialOutputSize(w, meta.dpiX, unit);
        const sy = initialOutputSize(h, meta.dpiY, unit);
        setSizeX(sx);
        setOutX(formatOutputSize(sx, unit));
        setSizeY(sy);
        setOutY(formatOutputSize(sy, unit));
        setTab('bw');
        // KiCad shows the opened file in the status bar (OnLoadFile) and
        // records it in the file history (UpdateFileHistory).
        setStatus(file.name);
        const data = bytesToDataUrl(bytes, file.type);
        if (data.length <= RECENT_MAX_DATA)
          recentImages.addFileToHistory({ name: file.name, data });
      } catch (e) {
        setStatus(`Could not load image: ${(e as Error).message}`);
      }
    },
    [unit],
  );

  /**
   * EDA_BASE_FRAME::GetFileFromHistory (eda_base_frame.cpp:1486-1523): a row
   * whose file is gone gets the "File '%s' was not found." dialog with the
   * Remove / Keep buttons, and opens nothing whichever the user picks.
   *
   * Our rows carry their own bytes, so "gone" means the data URL failed to
   * survive storage. Still a window.confirm, and deliberately: it is a
   * KICAD_MESSAGE_DIALOG like the drop prompt (eda_base_frame.cpp:1502-1508),
   * but one with `SetYesNoLabels( "Remove", "Keep" )`, which
   * ui/dialog_message.tsx does not carry yet — and it belongs to the shared
   * FILE_HISTORY port, whose four other callers want the same dialog.
   */
  const openRecent = useCallback(
    async (index: number) => {
      const r = recentImages.getFileFromHistory(index, {
        exists: (e) => e.data.length > 0,
        confirmRemove: (e) =>
          window.confirm(`${missingFileMessage(e.name)}\n${MISSING_FILE_EXTENDED}`),
      });
      if (!r) return;
      const blob = await (await fetch(r.data)).blob();
      await loadFile(new File([blob], r.name, { type: blob.type }));
    },
    [loadFile],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) void loadFile(f);
    e.target.value = '';
  };
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f || !/^image\//.test(f.type || '')) return;
    // DROP_FILE::OnDropFiles (bitmap2cmp_panel.cpp:582-596) asks before
    // replacing an already-loaded image, in a KICAD_MESSAGE_DIALOG. The dropped
    // file is parked until the answer comes back, because the dialog is modal
    // and the drag event is long gone by then.
    if (askBeforeReplace(loaded ? loaded.w : 0)) {
      setDropPending(f);
      return;
    }
    void loadFile(f);
  };
  const answerReplace = (answer: YesNoResult): void => {
    const f = dropPending;
    setDropPending(null);
    if (f && acceptDrop(answer)) void loadFile(f);
  };

  // ---- Output Size box (KiCad's IMAGE_SIZE behaviour) ----
  // KiCad m_aspectRatio = w / h, and 1.0 before any load — LoadSettings sets it
  // (bitmap2cmp_panel.cpp:89) so the live size fields do have a ratio to work
  // with while the panel is still empty.
  const aspect = loaded ? loaded.w / loaded.h : 1;

  const setSize = (axis: 'x' | 'y', size: number, u: SizeUnit): void => {
    // IMAGE_SIZE::SetOutputSize + m_UnitSizeX->ChangeValue.
    if (axis === 'x') {
      setSizeX(size);
      setOutX(formatOutputSize(size, u));
    } else {
      setSizeY(size);
      setOutY(formatOutputSize(size, u));
    }
  };

  const changeUnit = (next: SizeUnit): void => {
    // OnSizeUnitChange (bitmap2cmp_panel.cpp:373-381) is unconditional: it
    // SetUnit()s both IMAGE_SIZEs and rewrites both fields whether or not a
    // bitmap is loaded. With no image m_originalSizePixels is 0, IMAGE_SIZE::
    // SetUnit's `if( m_outputSize )` guards fall to the else branch and both
    // sizes stay 0 — but the FIELDS still re-format, so mm's "0.0" becomes
    // Inch's "0.00" and DPI's "0".
    setSize('x', convertOutputSize(sizeX, loaded?.w ?? 0, unit, next), next);
    setSize('y', convertOutputSize(sizeY, loaded?.h ?? 0, unit, next), next);
    setUnit(next);
  };
  const changeX = (text: string): void => {
    setOutX(text); // the field always shows what was typed
    const v = parseOutputSize(text);
    if (v === null) return; // ToDouble failed: m_outputSizeX keeps its value
    if (lock) {
      const y = unit === 'dpi' ? (sizeX ? (sizeY * v) / sizeX : v) : v / aspect;
      setSize('y', y, unit);
    }
    setSizeX(v);
  };
  const changeY = (text: string): void => {
    setOutY(text);
    const v = parseOutputSize(text);
    if (v === null) return;
    if (lock) {
      // DPI mode reproduces OnSizeChangeY verbatim: the ratio is computed
      // against the X size, so the locked X ends up set to the typed value.
      const x = unit === 'dpi' ? v : v * aspect;
      setSize('x', x, unit);
    }
    setSizeY(v);
  };
  const toggleLock = (on: boolean): void => {
    setLock(on);
    // ToggleAspectRatioLock: re-locking snaps Y back into ratio with X (in DPI
    // mode OnSizeChangeX's ratio against X is 1, so Y stays as it is).
    if (on && unit !== 'dpi') setSize('y', sizeX / aspect, unit);
  };

  const dpiX = loaded ? outputDpi(sizeX, loaded.w, unit) : DEFAULT_DPI;
  const dpiY = loaded ? outputDpi(sizeY, loaded.h, unit) : DEFAULT_DPI;

  const buildOutput = useCallback(
    (paste = false) => {
      if (!loaded || !mono) return null;
      // ExportToBuffer's WX_STRING_REPORTER: whatever the conversion reports
      // is shown afterwards in a message box captioned "Errors".
      const reporter = new Reporter();
      // KiCad names the emitted symbol/footprint "LOGO" (BITMAPCONV_INFO's
      // m_CmpName is fixed); only the download file takes the image's name.
      const out = convert(
        mono,
        {
          format,
          layer: OUTLINE_LAYERS[layerIdx]!.id,
          // ExportToBuffer passes GetOutputDPI() straight through; it can no
          // longer be zero, so there is no "sensible default" substitution here.
          dpiX,
          dpiY,
          name: 'LOGO',
          fileStem: loaded.name || 'LOGO',
          paste,
        },
        reporter,
      );
      return { out, reporter };
    },
    [loaded, mono, format, layerIdx, dpiX, dpiY],
  );

  /** ExportToBuffer's tail: `if( reporter.HasMessage() ) wxMessageBox( …, "Errors" )`. */
  const showReport = (reporter: Reporter): void => {
    if (reporter.hasMessage()) window.alert(reporter.lines.map((l) => l.message).join('\n'));
  };

  const exportToFile = (): void => {
    const built = buildOutput();
    if (!built) {
      setStatus('Load a source image before exporting.');
      return;
    }
    const { out, reporter } = built;
    showReport(reporter);
    const url = URL.createObjectURL(new Blob([out.text], { type: out.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    a.click();
    URL.revokeObjectURL(url);
    setConvertedName(out.filename); // BITMAP2CMP_SETTINGS m_ConvertedFileName
    setStatus(`Exported ${out.filename}`);
  };
  const exportToClipboard = async (): Promise<void> => {
    // OnExportToClipboard: a symbol copies as SYMBOL_PASTE_FMT, the bare
    // symbol fragment, ready to paste into an open schematic.
    const built = buildOutput(format === 'symbol');
    if (!built) {
      setStatus('Load a source image before exporting.');
      return;
    }
    const { out, reporter } = built;
    showReport(reporter);
    try {
      await navigator.clipboard.writeText(out.text);
      setStatus('Copied output to the clipboard.');
    } catch {
      setStatus('Clipboard unavailable in this browser; use Export to File instead.');
    }
  };

  // doReCreateMenuBar: File (Open… / Open Recent / Quit), Preferences
  // (Preferences… / language list), then the standard Help menu.
  const openRecentItem: MenuItem = openRecentMenuItem({
    files: recent,
    onOpen: (i) => void openRecent(i),
    onClear: () => recentImages.clearFileHistory(),
  });

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open...', shortcut: 'Ctrl+O', action: () => fileInputRef.current?.click() },
        openRecentItem,
        { sep: true },
        // `bitmap2cmp_frame.cpp:299` is `fileMenu->AddQuit( _( "Image
        // Converter" ) )`. Not AddQuitOrClose: bitmap2component has no kiface,
        // so it is always the Quit form, never "Close". `ui/action_menu.ts` is
        // that function, shared by the eleven frames that end their File menu
        // this way, and it is where the browser substitution for Ctrl+Q lives.
        addQuit('Image Converter', onExitToHome),
      ],
    },
    {
      label: 'Preferences',
      items: [
        { label: 'Preferences...', shortcut: 'Ctrl+,', action: () => setPrefsOpen(true) },
        { sep: true },
        setLanguageMenuItem({
          current: common.system.language,
          onSelect: (label) =>
            settings.updateCommon((c) => {
              c.system.language = label;
            }),
        }),
      ],
    },
    standardHelpMenu({ showHotkeys: showHotkeyList, showAbout: () => setAboutOpen(true) }),
  ];

  // The menus above are the whole of this frame's keyboard: Ctrl+O, Ctrl+`,`,
  // Ctrl+Alt+Q and Ctrl+F1 are dispatched from the rows that declare them. What
  // used to be here was a hand-written listener covering the first two, which
  // is how Quit came to be printed nowhere and do nothing.
  useMenuHotkeys(menus, 'image');

  const footprint = format === 'footprint';

  return (
    <div className="imgc-frame ze-app">
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={loaded ? `${loaded.fullName} \u2014 Image Converter` : 'Image Converter'}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/bmp,image/gif,image/webp,image/*"
        style={{ display: 'none' }}
        onChange={onPick}
      />

      <div className="imgc-body">
        {/* left: preview notebook (KiCad's wxNotebook) */}
        <div className="imgc-notebook">
          {/* The notebook has no page-change handler at all
              (bitmap2cmp_panel_base.cpp:215-231 connects paint, buttons, fields
              and radios — never the notebook), so a tab click only selects a
              page. With no image the three pages are blank and switching
              between them is exactly as legal as it is afterwards. */}
          <div className="imgc-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`imgc-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="imgc-pages" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {/* All three pages stay mounted, as AddPage() keeps all three
                wxScrolledWindows alive; only the selected one is visible, and
                each holds its own scroll offset across a tab switch. */}
            <div className={`imgc-view${tab === 'original' ? ' active' : ''}`}>
              {loaded && <canvas ref={originalCanvasRef} className="imgc-canvas" />}
            </div>
            <div className={`imgc-view${tab === 'greyscale' ? ' active' : ''}`}>
              {loaded && <canvas ref={greyscaleCanvasRef} className="imgc-canvas" />}
            </div>
            <div className={`imgc-view${tab === 'bw' ? ' active' : ''}`}>
              {loaded && <canvas ref={bwCanvasRef} className="imgc-canvas" />}
            </div>
            {/* Before a file is loaded the three wxScrolledWindows are simply
                blank (bitmap2cmp_panel_base.cpp:21,24,27). KiCad paints no
                placeholder over them, so neither do we. */}
          </div>
        </div>

        {/* right: controls (KiCad's brightSizer, group by group) */}
        <div className="imgc-side">
          <fieldset className="imgc-group">
            <legend>Image Information</legend>
            {/* KiCad's labels read "0000" until the first image is loaded. */}
            <div className="imgc-info">
              <span className="k">Image size:</span>
              <span className="v">{loaded ? loaded.w : '0000'}</span>
              <span className="v">{loaded ? loaded.h : '0000'}</span>
              <span className="u">pixels</span>

              <span className="k">Image PPI:</span>
              <span className="v">{loaded ? loaded.originalDPIX : '0000'}</span>
              <span className="v">{loaded ? loaded.originalDPIY : '0000'}</span>
              <span className="u">PPI</span>

              {/* Three cells then fgSizerInfo->Add( 0, 0, ... ), so "bits" is
                  in column 3 and the empty cell trails it
                  (bitmap2cmp_panel_base.cpp:76-92). */}
              <span className="k">BPP:</span>
              <span className="v">{loaded ? loaded.bpp : '0000'}</span>
              <span className="u">bits</span>
              <span />
            </div>
          </fieldset>

          <button
            type="button"
            className="imgc-btn block"
            onClick={() => fileInputRef.current?.click()}
          >
            Load Source Image
          </button>

          {/* brightSizer->Add( 0, 0, 1, wxEXPAND ) */}
          <div className="imgc-spacer" />

          <fieldset className="imgc-group">
            <legend>Output Size</legend>
            {/* BITMAP2CMP_PANEL's constructor disables exactly two controls,
                m_buttonExportFile and m_buttonExportClipboard
                (bitmap2cmp_panel.cpp:65-66). Both size fields, the unit choice
                and the threshold slider are live from the first frame: the two
                IMAGE_SIZEs simply hold 0 (`SetOutputSize( 0, … )`, :59-60) and
                the fields read "0.0". Loading an image then overwrites both
                sizes from the bitmap (:264-267), so anything typed here before
                a load is discarded by the load, not refused by the widget. */}
            <div className="imgc-sizerow">
              <span className="lbl">Size:</span>
              <input
                className="imgc-input ze-bare"
                value={outX}
                onChange={(e) => changeX(e.target.value)}
                spellCheck={false}
              />
              <input
                className="imgc-input ze-bare"
                value={outY}
                onChange={(e) => changeY(e.target.value)}
                spellCheck={false}
              />
              <Combo
                className="imgc-select"
                value={unit}
                onChange={(v) => changeUnit(v as SizeUnit)}
                options={SIZE_UNITS.map((u) => ({ value: u.id, label: u.label }))}
              />
            </div>
            <label className="imgc-check">
              <input
                type="checkbox"
                checked={lock}
                onChange={(e) => toggleLock(e.target.checked)}
              />
              Lock height / width ratio
            </label>
          </fieldset>

          <fieldset className="imgc-group">
            <legend>Options</legend>
            <span className="imgc-thresh-label">Black / white threshold:</span>
            {/* wxSL_LABELS: the value rides above the thumb and the two range
                ends sit under the ends of the track. */}
            <div
              className="imgc-slider"
              style={{ '--imgc-thumb-frac': threshold / 100 } as CSSProperties}
            >
              <span className="imgc-slider-val">{threshold}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={threshold}
                title="Adjust the level to convert the greyscale picture to a black and white picture."
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span className="imgc-slider-ends">
                <span>0</span>
                <span>100</span>
              </span>
            </div>
            <label className="imgc-check">
              <input
                type="checkbox"
                checked={negative}
                onChange={(e) => setNegative(e.target.checked)}
              />
              Negative
            </label>
          </fieldset>

          <fieldset className="imgc-group imgc-format">
            <legend>Output Format</legend>
            {/* fgSizer2 is a wxFlexGridSizer( 5, 1, 2, 0 ): five sibling rows,
                the Layer row third. They must stay siblings, because each row's
                wxFormBuilder border differs and the stylesheet addresses them by
                position (bitmap2cmp_panel_base.cpp:161-193). */}
            <div className="imgc-formats">
              {FORMATS.map((f) => (
                <Fragment key={f.id}>
                  <label className="imgc-radio">
                    <input
                      type="radio"
                      name="imgc-format"
                      checked={format === f.id}
                      onChange={() => setFormat(f.id)}
                    />
                    {f.label}
                  </label>
                  {f.id === 'footprint' && (
                    <div className={`imgc-layerrow${footprint ? '' : ' disabled'}`}>
                      <span className="lbl">Layer:</span>
                      <Combo
                        className="imgc-select grow"
                        value={String(layerIdx)}
                        disabled={!footprint}
                        onChange={(v) => setLayerIdx(Number(v))}
                        options={OUTLINE_LAYERS.map((l, i) => ({
                          value: String(i),
                          label: l.label,
                        }))}
                      />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="imgc-btn block"
            onClick={exportToFile}
            disabled={!loaded}
          >
            Export to File...
          </button>
          <button
            type="button"
            className="imgc-btn block"
            onClick={() => void exportToClipboard()}
            disabled={!loaded}
          >
            Export to Clipboard
          </button>
        </div>
      </div>

      {/* BM2CMP_FRAME::CreateStatusBar( 1, wxSTB_SIZEGRIP ) — one pane, the
          loaded file name (bitmap2component/bitmap2cmp_frame.cpp:181/:417).
          Not an EDA_DRAW_FRAME, so it takes KiStatusBar's children form and
          the shared bar chrome instead of a private .imgc-statusbar. */}
      <KiStatusBar>
        <span className="cell grow">{status}</span>
      </KiStatusBar>

      {dropPending && (
        <MessageDialogYesNo
          caption={REPLACE_LOADED_FILE_CAPTION}
          message={REPLACE_LOADED_FILE_MESSAGE}
          icon={REPLACE_LOADED_FILE_ICON}
          defaultButton={REPLACE_LOADED_FILE_DEFAULT}
          onResult={answerReplace}
        />
      )}

      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {aboutOpen && (
        // The dialog CHROME is the shared one - ui/shell.css's .ze-modal family,
        // the same widget home/dialogs/dialog_about.tsx and every other launcher
        // uses. Only the copy below is this frame's. There was a private
        // .imgc-modal skin here that restated the shared padding, radius, border
        // and shadow; a second copy of a widget is a second thing to keep in
        // step, which is the whole reason KiCad has one wxDialog.
        <div className="ze-modal-backdrop" onMouseDown={() => setAboutOpen(false)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              {aboutWindowTitle(ABOUT_TITLES.imageConverter)}
              <span className="x" title="Close" onClick={() => setAboutOpen(false)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <p style={{ marginTop: 0 }}>
                Convert a bitmap image into KiCad artwork, like KiCad's Image Converter
                (bitmap2component): the picture is reduced to greyscale, thresholded to black &
                white, then traced with potrace into filled polygons.
              </p>
              <ul style={{ margin: 0, paddingLeft: 'var(--ui-line-height)', lineHeight: 1.6 }}>
                <li>Symbol, a schematic library symbol (.kicad_sym)</li>
                <li>Footprint, a PCB footprint (.kicad_mod) on the chosen layer</li>
                <li>Postscript, an encapsulated PostScript drawing (.ps)</li>
                <li>Drawing Sheet, a worksheet graphic (.kicad_wks)</li>
              </ul>
            </div>
            <div className="ze-modal-footer">
              <button type="button" className="ze-btn primary" onClick={() => setAboutOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
