// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets 3.2.4 src/common/imaggif.cpp, copyright Vaclav Slavik and
// Guillermo Rodriguez Garcia (wxWindows Library Licence).
/** `wxGIFHandler`'s reading half: `LoadFile` and `DoCanRead`, on wxGIFDecoder. */

import { type GIF_IMAGE_SINK, wxGIFDecoder, wxGIFErrorCode } from './gifdecod.js';
import type { wxMemoryInputStream } from './mstream.js';

/**
 * `wxGIFHandler::LoadFile( image, stream, verbose, index )`: frame \a aIndex (the first for -1).
 * A truncated stream still yields the frames it held.
 */
export function wxGIFHandlerLoadFile(
  aImage: GIF_IMAGE_SINK,
  aStream: wxMemoryInputStream,
  aIndex: number,
): boolean {
  const decod = new wxGIFDecoder();

  switch (decod.LoadGIF(aStream)) {
    case wxGIFErrorCode.wxGIF_OK:
      break;

    case wxGIFErrorCode.wxGIF_INVFORMAT: // "GIF: error in GIF image format."
    case wxGIFErrorCode.wxGIF_MEMERR: // "GIF: not enough memory."
      return false;

    case wxGIFErrorCode.wxGIF_TRUNCATED:
      // "GIF: data stream seems to be truncated." - go on; image data is OK
      break;
  }

  return decod.ConvertToImage(aIndex !== -1 ? aIndex : 0, aImage);
}

/** `wxGIFHandler::DoCanRead`, through wxImageHandler::CanRead, which puts the position back. */
export function wxGIFHandlerCanRead(aStream: wxMemoryInputStream): boolean {
  return new wxGIFDecoder().CanRead(aStream);
}
