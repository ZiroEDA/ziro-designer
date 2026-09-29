// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (src/xml/xml.cpp), wxWindows Library Licence.
/**
 * `wxXmlDocument::Save( stream, indentstep )` over an XNODE tree: the writer
 * `NETLIST_EXPORTER_XML::WriteNetlist` hands its `makeRoot()` tree to.
 *
 * The layout is wx's `OutputNode`: an element with no children closes itself
 * (`<title/>`); otherwise every non-text child starts on its own line, indented
 * `indentstep` spaces deeper, and text children are written in place, so an
 * element holding only text prints on one line and several text children run
 * together (`<tstamps>a b c</tstamps>`). The closing tag gets its own line only
 * when the last child was not text.
 */
import { type XNODE, wxXmlNodeType } from '../xnode.js';

/** wx's `OutputEscapedString`: text escapes `< > & \r`; an attribute also `" \t \n`. */
function outputEscaped(aText: string, aAttribute: boolean): string {
  let out = '';

  for (const c of aText) {
    switch (c) {
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '&':
        out += '&amp;';
        break;
      case '\r':
        out += '&#xD;';
        break;
      default:
        if (aAttribute && c === '"') out += '&quot;';
        else if (aAttribute && c === '\t') out += '&#x9;';
        else if (aAttribute && c === '\n') out += '&#xA;';
        else out += c;
    }
  }

  return out;
}

/** `OutputIndentation`: a newline, then `aIndent` spaces. */
const indentation = (aIndent: number): string => `\n${' '.repeat(aIndent)}`;

/** `OutputNode`. */
function outputNode(aNode: XNODE, aIndent: number, aIndentStep: number): string {
  if (aNode.GetType() === wxXmlNodeType.wxXML_TEXT_NODE)
    return outputEscaped(aNode.GetContent(), false);

  let out = `<${aNode.GetName()}`;

  for (const attr of aNode.GetAttributes())
    out += ` ${attr.GetName()}="${outputEscaped(attr.GetValueText(), true)}"`;

  const first = aNode.GetChildren();

  if (!first) return `${out}/>`;

  out += '>';

  let prev: XNODE | null = null;

  for (let n: XNODE | null = first; n; n = n.GetNext()) {
    if (aIndentStep >= 0 && n.GetType() !== wxXmlNodeType.wxXML_TEXT_NODE)
      out += indentation(aIndent + aIndentStep);

    out += outputNode(n, aIndent + aIndentStep, aIndentStep);
    prev = n;
  }

  if (aIndentStep >= 0 && prev && prev.GetType() !== wxXmlNodeType.wxXML_TEXT_NODE)
    out += indentation(aIndent);

  return `${out}</${aNode.GetName()}>`;
}

/** `wxXmlDocument::Save( stream, aIndentStep )` of a document whose root is `aRoot`. */
export function wxXmlDocumentSave(aRoot: XNODE, aIndentStep = 2): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${outputNode(aRoot, 0, aIndentStep)}\n`;
}
