// `OUTLINE_FONT::LoadFont`'s face source for node: fontconfig's catalogue
// answered from the bundled files on disk, the same faces the browser
// fetches — so a qa run resolves the outline fonts KiCad's oracle used.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findFont } from '@ziroeda/common/font/fontconfig.js';
import { OUTLINE_FONT } from '@ziroeda/common/font/outline_font.js';
import { type OutlineFace, parseOutlineFace } from '@ziroeda/common/font/outline_face.js';

const fontsDir = fileURLToPath(new URL('../../designer/public/fonts/', import.meta.url));
const faces = new Map<string, OutlineFace | null>();

export function installNodeOutlineFaces(): void {
  OUTLINE_FONT.faceSource = (fontName, bold, italic) => {
    const found = findFont(fontName, bold, italic);
    if (!found) return null;
    let face = faces.get(found.file.file);
    if (face === undefined) {
      try {
        const bytes = readFileSync(fontsDir + found.file.file);
        face = parseOutlineFace(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
      } catch {
        face = null;
      }
      faces.set(found.file.file, face);
    }
    if (!face) return null;
    return {
      face,
      fileName: found.file.file,
      fakeBold: found.fakeBold,
      fakeItalic: found.fakeItalic,
    };
  };
}
