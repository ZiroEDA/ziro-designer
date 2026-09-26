// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/readgerb.cpp`: reading a Gerber file (RS274D, RS274X, RS274X2) —
 * `GERBER_FILE_IMAGE::TestFileIsRS274`, the sniff the autodetect runs, and
 * `GERBER_FILE_IMAGE::LoadGerberFile`, the reader's main loop.
 *
 * `GERBVIEW_FRAME::Read_GERBER_File`, the frame's half (make the image, put
 * it in the list, show its messages, warn about missing D codes), is the
 * frame's and waits with it (STRUCTURE.md).
 *
 * The GERBER_FILE_IMAGE methods here take the image as their first argument;
 * see gerber_file_image.ts.
 */
import { EscapeHTML } from '@ziroeda/common/string_utils.js';
import { GERBER_BUFZ, GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { Gerb_Analyse_Cmd } from './gerbview.js';
import { CHAR_PTR, FILE, LINE_BUFFER, NUL, StrPurge, isdigit } from './libc.js';
import { ReadFileText } from './files.js';
import type { GERBVIEW_FRAME } from './gerbview_frame.js';

/**
 * `GERBER_FILE_IMAGE::TestFileIsRS274`: "Original function derived from
 * gerber_is_rs274x_p() of gerbv 2.7.0". A heuristics-based check that does not
 * invoke the full parser.
 */
export function TestFileIsRS274(aFileText: string): boolean {
  let foundADD = false;
  let foundD0 = false;
  let foundD2 = false;
  let foundM0 = false;
  let foundM2 = false;
  let foundStar = false;
  let foundX = false;
  let foundY = false;

  // FILE_LINE_READER::ReadLine: one line at a time, "\n" kept.
  const reader = new FILE(aFileText);
  const buf = new LINE_BUFFER();

  while (reader.fgets(buf, Number.MAX_SAFE_INTEGER) !== null) {
    // Remove all whitespace from the beginning and end
    const line = StrPurge(new CHAR_PTR(buf)).rest();

    // Skip empty lines
    if (line.length === 0) continue;

    // Check that file is not binary (non-printing chars)
    for (let i = 0; i < line.length; i++) {
      if (line.charCodeAt(i) > 127) return false; // !isascii( line[i] )
    }

    if (line.includes('%ADD')) foundADD = true;

    if (line.includes('D00') || line.includes('D0')) foundD0 = true;

    if (line.includes('D02') || line.includes('D2')) foundD2 = true;

    if (line.includes('M00') || line.includes('M0')) foundM0 = true;

    if (line.includes('M02') || line.includes('M2')) foundM2 = true;

    if (line.includes('*')) foundStar = true;

    /* look for X<number> or Y<number> */
    let letter = line.indexOf('X');

    if (letter !== -1) {
      if (isdigit(line[letter + 1] ?? NUL)) foundX = true;
    }

    letter = line.indexOf('Y');

    if (letter !== -1) {
      if (isdigit(line[letter + 1] ?? NUL)) foundY = true;
    }
  }

  // RS-274X
  if ((foundD0 || foundD2 || foundM0 || foundM2) && foundADD && foundStar && (foundX || foundY)) {
    return true;
  }
  // RS-274D. Could be folded into the expression above, but someday
  // we might want to test for them separately.
  if ((foundD0 || foundD2 || foundM0 || foundM2) && !foundADD && foundStar && (foundX || foundY)) {
    return true;
  }

  return false;
}

/**
 * `GERBER_FILE_IMAGE::LoadGerberFile`: read and load a gerber file.
 *
 * @param aFileText the file's contents; null stands for a file that cannot be
 *        opened (`wxFopen` returned null), which makes this return false.
 */
export function LoadGerberFile(
  self: GERBER_FILE_IMAGE,
  aFullFileName: string,
  aFileText: string | null,
): boolean {
  let G_command = 0; // command number for G commands like G04
  let D_commande = 0; // command number for D commands like D02

  self.ClearMessageList();
  self.ResetDefaultValues();

  // Read the gerber file */
  if (aFileText === null) return false;

  self.m_Current_File = new FILE(aFileText);

  self.m_FileName = aFullFileName;

  const lineBuffer = GERBER_FILE_IMAGE.m_LineBuffer;

  while (true) {
    if (self.m_Current_File.fgets(lineBuffer, GERBER_BUFZ) === null) break;

    self.m_LineNum++;
    const text = StrPurge(new CHAR_PTR(lineBuffer));

    while (text.c() !== NUL) {
      switch (text.c()) {
        case ' ':
        case '\r':
        case '\n':
          text.inc();
          break;

        case '*': // End command
          self.m_CommandState = Gerb_Analyse_Cmd.END_BLOCK;
          text.inc();
          break;

        case 'M': // End file
          self.m_CommandState = Gerb_Analyse_Cmd.CMD_IDLE;
          while (text.c() !== NUL) text.inc();
          break;

        case 'G' /* Line type Gxx : command */:
          G_command = self.CodeNumber(text);
          self.Execute_G_Command(text, G_command);
          break;

        case 'D' /* Line type Dxx : Tool selection (xx > 0) or command if xx = 0..9 */:
          D_commande = self.CodeNumber(text);
          self.Execute_DCODE_Command(text, D_commande);
          break;

        case 'X':
        case 'Y' /* Move or draw command */:
          self.m_CurrentPos = self.ReadXYCoord(text);
          if (text.c() === '*') {
            // command like X12550Y19250*
            self.Execute_DCODE_Command(text, self.m_Last_Pen_Command);
          }
          break;

        case 'I':
        case 'J' /* Auxiliary Move command */:
          self.m_IJPos = self.ReadIJCoord(text);

          if (text.c() === '*') {
            // command like X35142Y15945J504*
            self.Execute_DCODE_Command(text, self.m_Last_Pen_Command);
          }
          break;

        case '%':
          if (self.m_CommandState !== Gerb_Analyse_Cmd.ENTER_RS274X_CMD) {
            self.m_CommandState = Gerb_Analyse_Cmd.ENTER_RS274X_CMD;
            self.ReadRS274XCommand(lineBuffer, GERBER_BUFZ, text);
          } else {
            //Error
            self.AddMessageToList('Expected RS274X Command');
            self.m_CommandState = Gerb_Analyse_Cmd.CMD_IDLE;
            text.inc();
          }
          break;

        default: {
          const code = text.c().charCodeAt(0);
          // Don't render control characters
          const shown = code < 32 ? '?' : text.c();
          const hex = (code & 0xff).toString(16).toUpperCase().padStart(2, '0');
          const msg = `Unexpected char 0x${hex} (${shown})`;

          self.AddMessageToList(EscapeHTML(msg));
          text.inc();
          break;
        }
      }
    }
  }

  // Flush any unclosed SR block
  self.FinishStepAndRepeatBlock();

  self.m_Current_File = null; // fclose

  self.m_InUse = true;

  return true;
}

/**
 * `GERBVIEW_FRAME::Read_GERBER_File` (readgerb.cpp:41-110): read a gerber file
 * into the active layer, replacing what it held, and add its items to the
 * view. Bound on the frame (`gerbview_frame.ts`).
 */
export async function Read_GERBER_File(
  this: GERBVIEW_FRAME,
  GERBER_FullFileName: string,
): Promise<boolean> {
  let msg: string;

  const layer = this.GetActiveLayer();
  const images = this.GetImagesList();
  let gerber = this.GetGbrImage(layer);

  if (gerber !== null) await this.Erase_Current_DrawLayer(false);

  // use an unique ptr while we load to free on exception properly
  const gerber_uptr = new GERBER_FILE_IMAGE(layer);

  // Read the gerber file. The image will be added only if it can be read
  // to avoid broken data.
  const success = gerber_uptr.LoadGerberFile(
    GERBER_FullFileName,
    ReadFileText(GERBER_FullFileName),
  );

  if (!success) {
    msg = `File '${GERBER_FullFileName}' not found`;
    this.Host().InfoBarError(msg);
    return false;
  }

  gerber = gerber_uptr;
  images.AddGbrImage(gerber, layer);

  // Display errors list
  if (gerber.GetMessages().length > 0)
    await this.Host().HtmlMessageBox('Errors', gerber.GetMessages().join('\n'));

  /* if the gerber file has items using D codes but missing D codes definitions,
   * it can be a deprecated RS274D file (i.e. without any aperture information),
   * or has missing definitions,
   * warn the user:
   */
  if (gerber.GetItemsCount() && gerber.m_Has_MissingDCode) {
    if (!gerber.m_Has_DCode)
      msg =
        'Warning: this file has no D-Code definition\n' +
        'Therefore the size of some items is undefined';
    else
      msg =
        'Warning: this file has some missing D-Code definitions\n' +
        'Therefore the size of some items is undefined';

    await this.Host().MessageBox(msg);
  }

  const canvas = this.GetCanvas();

  if (canvas) {
    // m_ImageNegative: "TODO: find a way to handle negative images" upstream.
    for (const item of gerber.GetItems()) canvas.GetView().Add(item);
  }

  return true;
}
