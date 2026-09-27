// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/clipboard.h` + `common/clipboard.cpp`: saving to and reading from
 * the clipboard - text, KiCad's own `application/kicad` payload, images, and
 * tabular data as CSV.
 *
 * Upstream reads `wxTheClipboard` synchronously, whenever it likes. A browser
 * hands the system clipboard over only asynchronously, or inside a `paste`
 * event. So `wxTheClipboard` here is what the last save or the last paste
 * event left in this tab. Every save also goes to the system clipboard, and
 * the program passes each paste event's data to {@link SetClipboardFromPaste}
 * before it runs the paste. The readers below are then upstream's, line for
 * line, on GTK.
 *
 * A browser writes only `text/plain`, `text/html` and `image/png` to the
 * system clipboard. A custom format such as `application/kicad` therefore
 * stays in this tab: a KiCad-to-KiCad transfer, which is also all that
 * upstream's comment says GTK gives a custom MIME type.
 */
import { AutoDecodeCSV, CSV_WRITER } from './io/csv.js';
import { wxMemoryBuffer } from './wx/buffer.js';
import { WX_IMAGE } from './wx/wx_image.js';

/** `wxDF_BITMAP` on GTK: a PNG. */
const wxDF_BITMAP = 'image/png';

export interface CLIPBOARD_MIME_DATA {
  m_mimeType: string;
  m_data: wxMemoryBuffer;
  /**
   * Optional bitmap image to add to clipboard via wxBitmapDataObject.
   * When set, SaveClipboard() adds this using the platform-native format
   * (PNG on GTK).
   */
  m_image?: WX_IMAGE;
  /**
   * When true and m_mimeType is "image/png", m_data contains pre-encoded PNG
   * bytes. SaveClipboard() will add this as the preferred format.
   */
  m_useRawPngData?: boolean;
}

/**
 * `wxDataObjectComposite`: the formats one `SetData` offers. `text` is the
 * `wxTextDataObject`, null when there is none.
 */
export class wxDataObjectComposite {
  text: string | null = null;
  readonly formats = new Map<string, Uint8Array>();

  /** `Add( new wxCustomDataObject( aFormat ) )` with its data set. */
  Add(aFormat: string, aData: Uint8Array): void {
    this.formats.set(aFormat, aData.slice());
  }
}

/** `wxTheClipboard`: what this tab last saved or was last pasted. */
let s_clipboard = new wxDataObjectComposite();

/** `wxTheClipboard->SetData( aData ); Flush()`: this tab's, and the system's. */
function setData(aData: wxDataObjectComposite): void {
  s_clipboard = aData;

  const sys = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  const text = aData.text ?? '';
  const png = aData.formats.get(wxDF_BITMAP);

  // wxLogNull: a failed clipboard action is not reported.
  if (png && sys?.write && typeof ClipboardItem !== 'undefined') {
    void sys
      .write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          [wxDF_BITMAP]: new Blob([png as BlobPart], { type: wxDF_BITMAP }),
        }),
      ])
      .catch(() => {});
  } else {
    void sys?.writeText?.(text).catch(() => {});
  }
}

/**
 * What a system `paste` event carries becomes the clipboard: its text, and
 * the first image file in it as `wxDF_BITMAP`. The program calls this before
 * it runs the paste; the image's bytes have to be read first, hence async.
 */
export async function SetClipboardFromPaste(aData: DataTransfer): Promise<void> {
  const data = new wxDataObjectComposite();

  if (aData.types.includes('text/plain')) data.text = aData.getData('text/plain');

  const file = Array.from(aData.items)
    .find((it) => it.kind === 'file' && it.type.startsWith('image/'))
    ?.getAsFile();

  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Any image type the reader takes; it is offered as the bitmap format.
    if (file.type === wxDF_BITMAP) data.Add(wxDF_BITMAP, bytes);
    else {
      const image = new WX_IMAGE();
      const png = new wxMemoryBuffer();

      if (image.LoadFile(bytes) && EncodeImageToPng(image, png))
        data.Add(wxDF_BITMAP, png.GetData());
    }
  }

  s_clipboard = data;
}

/**
 * Store information to the clipboard.
 *
 * @param aTextUTF8 is the information to be stored, expected UTF8 encoding.
 *                  The text will be stored as Unicode string (not stored as
 *                  UTF8 string).
 * @param aMimeData is further formats to offer alongside the text.
 * @returns False if error occurred.
 */
export function SaveClipboard(
  aTextUTF8: string,
  aMimeData: readonly CLIPBOARD_MIME_DATA[] = [],
): boolean {
  const data = new wxDataObjectComposite();
  data.text = aTextUTF8;

  for (const entry of aMimeData) {
    // Skip entries with no data (check both buffer and image)
    if (entry.m_data.GetDataLen() === 0 && !entry.m_image) continue;

    // Handle pre-encoded PNG data (GTK optimization path).
    if (entry.m_useRawPngData && entry.m_data.GetDataLen() > 0) {
      data.Add(wxDF_BITMAP, entry.m_data.GetData());
      continue;
    }

    // Handle bitmap image data using platform-native clipboard format.
    if (entry.m_image?.IsOk()) {
      const png = new wxMemoryBuffer();

      if (EncodeImageToPng(entry.m_image, png)) data.Add(wxDF_BITMAP, png.GetData());

      continue;
    }

    data.Add(entry.m_mimeType, entry.m_data.GetData());
  }

  setData(data);
  return true;
}

/**
 * Return the information currently stored in the system clipboard.
 *
 * If data stored in the clipboard is in unicode format, the returned text is
 * the unicode string. KiCad's own `application/kicad` payload comes first.
 */
export function GetClipboardUTF8(): string {
  const kicad = s_clipboard.formats.get('application/kicad');

  if (kicad) return new TextDecoder().decode(kicad);

  return s_clipboard.text ?? '';
}

/**
 * Get image data from the clipboard, if there is any.
 *
 * @returns an image, or null if there is no usable image on the clipboard.
 */
export function GetImageFromClipboard(): WX_IMAGE | null {
  const png = s_clipboard.formats.get(wxDF_BITMAP);

  if (!png) return null;

  const bitmap = new WX_IMAGE();

  return bitmap.LoadFile(png) ? bitmap : null;
}

/**
 * `wxTheClipboard->IsSupported( wxDF_TEXT )` and `GetData( wxTextDataObject )`:
 * the clipboard's text, or null when it holds none (GRID_TRICKS asks this).
 */
export function GetClipboardText(): string | null {
  return s_clipboard.text;
}

/**
 * Store tabular data to the system clipboard.
 */
export function SaveTabularDataToClipboard(aData: readonly (readonly string[])[]): boolean {
  const data = new wxDataObjectComposite();

  // Set plain text CSV
  const os: string[] = [];
  const writer = new CSV_WRITER(os);
  writer.WriteLines(aData);
  data.text = os.join('');

  setData(data);
  return true;
}

/**
 * Attempt to get tabular data from the clipboard.
 */
export function GetTabularDataFromClipboard(aData: string[][]): boolean {
  let ok = false;

  if (s_clipboard.text !== null) ok = AutoDecodeCSV(s_clipboard.text, aData);

  return ok;
}

/**
 * Encode an image to PNG format with fast compression settings optimized for
 * clipboard use. Our encoder writes stored blocks, which is as fast as it gets.
 *
 * @param aOutput receives the PNG bytes; what it held is replaced.
 * @returns True if encoding succeeded.
 */
export function EncodeImageToPng(aImage: WX_IMAGE, aOutput: wxMemoryBuffer): boolean {
  if (!aImage.IsOk()) return false;

  const png = aImage.SaveFilePng();

  if (!png) return false;

  aOutput.SetDataLen(0);
  aOutput.AppendData(png);
  return true;
}

/**
 * Add pre-encoded PNG data to a clipboard data object: on GTK, as
 * `wxDF_BITMAP`.
 *
 * @returns True if data was added successfully.
 */
export function AddPngToClipboardData(
  aData: wxDataObjectComposite,
  aPngData: wxMemoryBuffer,
  _aFallbackImage?: WX_IMAGE,
): boolean {
  if (aPngData.GetDataLen() <= 0) return false;

  aData.Add(wxDF_BITMAP, aPngData.GetData());
  return true;
}

/**
 * Add a transparent image to a clipboard data object: encoded to PNG, as GTK
 * takes it.
 *
 * @returns True if data was added successfully.
 */
export function AddTransparentImageToClipboardData(
  aData: wxDataObjectComposite,
  aImage: WX_IMAGE,
): boolean {
  if (!aImage.IsOk()) return false;

  const pngData = new wxMemoryBuffer();

  if (!EncodeImageToPng(aImage, pngData)) return false;

  return AddPngToClipboardData(aData, pngData);
}

/**
 * `wxTheClipboard->SetData( aData )` for a composite built with the two adders
 * above: the callers that build their own (`SCH_EDITOR_CONTROL::doCopy`'s
 * image) end with it.
 */
export function SetClipboardData(aData: wxDataObjectComposite): boolean {
  setData(aData);
  return true;
}
