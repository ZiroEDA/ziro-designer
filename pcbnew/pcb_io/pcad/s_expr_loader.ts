// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/s_expr_loader.cpp` / `.h`: read a P-CAD ASCII file (an
 * S-expression) into the XNODE tree the parsers walk, rooted at a node named
 * `www.lura.sk`.
 *
 * A quoted string becomes (or extends, after a space) the `Name` attribute of
 * the node it sits in; any other word is appended, after a space, to the text
 * content of the most recently OPENED node — which, after a child closes, is
 * that child, not the node the word sits in. The C++ does exactly that.
 */

import { DSNLEXER, T } from '@ziroeda/common/dsnlexer.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { XNODE, wxXmlNodeType } from '@ziroeda/common/xnode.js';

const ACCEL_ASCII_KEYWORD = 'ACCEL_ASCII';

/** `LoadInputFile`: the root of the parsed file (`aXmlDoc->GetRoot()`). */
export function LoadInputFile(aData: Uint8Array | null, aFileName: string): XNODE {
  if (!aData) throw new IO_ERROR(`Unable to open file: ${aFileName}`);

  // check file format: `fgets` of sizeof( ACCEL_ASCII_KEYWORD ) bytes, then a
  // memcmp of the keyword's length
  const n = ACCEL_ASCII_KEYWORD.length;
  let matches = aData.length >= n;

  for (let i = 0; matches && i < n; i++)
    if (aData[i] !== ACCEL_ASCII_KEYWORD.charCodeAt(i)) matches = false;

  if (!matches) throw new IO_ERROR('Unknown file type');

  // wxCSConv( "windows-1251" ): every CurText() is converted from it; the
  // lexer's delimiters are ASCII, which the code page keeps, so decoding the
  // whole file first reads the same tokens.
  const lexer = new DSNLEXER(new TextDecoder('windows-1251').decode(aData), aFileName);

  let iNode: XNODE | null = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, 'www.lura.sk');
  let cNode: XNODE | null = null;

  for (let tok = lexer.NextTok(); tok !== T.EOF; tok = lexer.NextTok()) {
    if (tok === T.RIGHT) {
      iNode = iNode!.GetParent();

      if (!iNode) throw new IO_ERROR('Unexpected right paren');
    } else if (tok === T.LEFT) {
      lexer.NextTok();
      cNode = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, lexer.CurText());
      iNode!.AddChild(cNode);
      iNode = cNode;
    } else if (cNode) {
      const str = lexer.CurText();

      if (tok === T.STRING) {
        // update attribute
        const propValue = iNode!.GetAttribute('Name');

        if (propValue !== null) {
          iNode!.DeleteAttribute('Name');
          iNode!.AddAttribute('Name', `${propValue} ${str}`);
        } else {
          iNode!.AddAttribute('Name', str);
        }
      } else if (str !== '') {
        // update node content
        const content = `${cNode.GetNodeContent()} ${str}`;
        const first = cNode.GetChildren();

        if (first) first.SetContent(content);
        else cNode.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', content));
      }
    }
  }

  // `aXmlDoc->SetRoot( iNode )`: the node the lexer ended in, which is the
  // root only when the parentheses balance.
  return iNode!;
}
