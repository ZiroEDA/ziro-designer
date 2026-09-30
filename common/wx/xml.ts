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

// ---------------------------------------------------------------------------
// Reading: `wxXmlDocument::Load` (src/xml/xml.cpp) over expat.

/** `wxXmlNodeType`, the kinds `wxXmlDocument::Load` makes. */
export enum wxXmlNodeKind {
  wxXML_ELEMENT_NODE = 1,
  wxXML_TEXT_NODE = 3,
  wxXML_CDATA_SECTION_NODE = 4,
  wxXML_PI_NODE = 7,
  wxXML_COMMENT_NODE = 8,
}

/**
 * `wxXmlNode` as a loaded document holds it: a type, a name, content (for a
 * text, CDATA, comment or PI node), attributes in document order, and the
 * first-child / next-sibling links.
 */
export class wxXmlNode {
  private m_children: wxXmlNode | null = null;
  private m_lastChild: wxXmlNode | null = null;
  private m_next: wxXmlNode | null = null;
  private m_parent: wxXmlNode | null = null;
  private readonly m_attrs: [string, string][] = [];

  constructor(
    private readonly m_type: wxXmlNodeKind,
    private readonly m_name: string,
    private m_content = '',
    private readonly m_lineNo = -1,
  ) {}

  GetType(): wxXmlNodeKind {
    return this.m_type;
  }

  GetName(): string {
    return this.m_name;
  }

  GetContent(): string {
    return this.m_content;
  }

  /** Appends to a text node, as consecutive expat character data does. */
  AppendContent(aText: string): void {
    this.m_content += aText;
  }

  GetLineNumber(): number {
    return this.m_lineNo;
  }

  GetParent(): wxXmlNode | null {
    return this.m_parent;
  }

  GetChildren(): wxXmlNode | null {
    return this.m_children;
  }

  GetNext(): wxXmlNode | null {
    return this.m_next;
  }

  /** `GetAttributes()`, in document order. */
  GetAttributes(): readonly [string, string][] {
    return this.m_attrs;
  }

  AddAttribute(aName: string, aValue: string): void {
    this.m_attrs.push([aName, aValue]);
  }

  HasAttribute(aName: string): boolean {
    return this.m_attrs.some(([n]) => n === aName);
  }

  /** `GetAttribute( name, defaultVal )`: the value, or `aDefault` when absent. */
  GetAttribute(aName: string, aDefault = ''): string {
    const a = this.m_attrs.find(([n]) => n === aName);
    return a ? a[1] : aDefault;
  }

  /** `GetAttribute( name, &value )`: the value, or null when absent. */
  GetAttributeOpt(aName: string): string | null {
    const a = this.m_attrs.find(([n]) => n === aName);
    return a ? a[1] : null;
  }

  AddChild(aChild: wxXmlNode): void {
    aChild.m_parent = this;

    if (this.m_lastChild) this.m_lastChild.m_next = aChild;
    else this.m_children = aChild;

    this.m_lastChild = aChild;
  }

  /**
   * `GetNodeContent()`: the content of the first text or CDATA child, or the
   * empty string.
   */
  GetNodeContent(): string {
    for (let n = this.m_children; n; n = n.m_next) {
      if (
        n.m_type === wxXmlNodeKind.wxXML_TEXT_NODE ||
        n.m_type === wxXmlNodeKind.wxXML_CDATA_SECTION_NODE
      )
        return n.m_content;
    }

    return '';
  }
}

/** A malformed document: `wxXmlDocument::Load` returns false (after a wxLogError). */
export class wxXmlParseError extends Error {}

const XML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Character and predefined entity references, as expat expands them. */
function expandReferences(aText: string, aLine: number): string {
  return aText.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (_m, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));

    const e = XML_ENTITIES[ref];

    if (e === undefined) throw new wxXmlParseError(`undefined entity at line ${aLine}`);

    return e;
  });
}

/**
 * Attribute-value normalisation (XML 1.0 §3.3.3, which expat applies): each
 * literal tab, newline or carriage return becomes a space before references
 * are expanded, so `&#10;` survives as a newline.
 */
function normalizeAttribute(aRaw: string, aLine: number): string {
  return expandReferences(aRaw.replace(/\r\n|[\t\n\r]/g, ' '), aLine);
}

/**
 * Character data as expat hands it to wx's `TextHnd`, one call per piece: a
 * run of ordinary characters, each newline on its own, each reference's
 * expansion on its own. The pieces matter because wx drops a whitespace-only
 * piece that does not continue a text node already begun — so
 * `"\n  foo\nbar"` loads as `"  foo\nbar"`.
 */
function expatChunks(aRaw: string, aLine: number): string[] {
  const out: string[] = [];
  const re = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);|\n|[^&\n]+/g;

  for (const m of aRaw.matchAll(re))
    out.push(m[0].startsWith('&') ? expandReferences(m[0], aLine) : m[0]);

  return out;
}

/** Whitespace-only text is dropped unless `wxXMLDOC_KEEP_WHITESPACE_NODES`. */
const isWhitespaceOnly = (s: string): boolean => /^[ \t\r\n]*$/.test(s);

/**
 * `wxXmlDocument::Load( stream )` with the default flags: the root element, or
 * a thrown `wxXmlParseError` where wx's Load returns false. Line endings are
 * normalised to `\n` first, as expat does; comments and processing
 * instructions inside the root become nodes (wx keeps them); the XML
 * declaration and a DOCTYPE do not.
 */
export function wxXmlDocumentLoad(aText: string): wxXmlNode {
  const s = aText.replace(/\r\n?/g, '\n');
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let root: wxXmlNode | null = null;
  const stack: wxXmlNode[] = [];
  let lastText: wxXmlNode | null = null;

  const advance = (to: number): void => {
    for (let k = i; k < to; k++) if (s.charCodeAt(k) === 10) line++;
    i = to;
  };

  const top = (): wxXmlNode | null => stack[stack.length - 1] ?? null;

  const addText = (aContent: string): void => {
    const parent = top();

    if (!parent) {
      if (!isWhitespaceOnly(aContent))
        throw new wxXmlParseError(`text outside the root element at line ${line}`);
      return;
    }

    // expat may split character data; wx appends to the last text node
    if (lastText) {
      lastText.AppendContent(aContent);
      return;
    }

    if (isWhitespaceOnly(aContent)) return;

    lastText = new wxXmlNode(wxXmlNodeKind.wxXML_TEXT_NODE, 'text', aContent, line);
    parent.AddChild(lastText);
  };

  while (i < s.length) {
    const lt = s.indexOf('<', i);

    if (lt === -1) {
      for (const chunk of expatChunks(s.slice(i), line)) addText(chunk);
      advance(s.length);
      break;
    }

    if (lt > i) {
      const raw = s.slice(i, lt);
      const startLine = line;
      advance(lt);
      for (const chunk of expatChunks(raw, startLine)) addText(chunk);
    }

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) throw new wxXmlParseError(`unclosed comment at line ${line}`);
      const parent = top();
      if (parent)
        parent.AddChild(
          new wxXmlNode(wxXmlNodeKind.wxXML_COMMENT_NODE, 'comment', s.slice(i + 4, end), line),
        );
      lastText = null;
      advance(end + 3);
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) throw new wxXmlParseError(`unclosed CDATA section at line ${line}`);
      const parent = top();
      if (!parent) throw new wxXmlParseError(`CDATA outside the root element at line ${line}`);
      parent.AddChild(
        new wxXmlNode(wxXmlNodeKind.wxXML_CDATA_SECTION_NODE, 'cdata', s.slice(i + 9, end), line),
      );
      lastText = null;
      advance(end + 3);
    } else if (s.startsWith('<!DOCTYPE', i)) {
      // skip the declaration, including an internal subset in brackets
      let k = i + 9;
      let depth = 0;
      for (; k < s.length; k++) {
        const c = s[k];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      advance(k + 1);
    } else if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end === -1) throw new wxXmlParseError(`unclosed processing instruction at line ${line}`);
      const body = s.slice(i + 2, end);
      const target = /^[^\s]*/.exec(body)![0];
      const parent = top();
      if (parent && target.toLowerCase() !== 'xml')
        parent.AddChild(
          new wxXmlNode(
            wxXmlNodeKind.wxXML_PI_NODE,
            target,
            body.slice(target.length).trimStart(),
            line,
          ),
        );
      lastText = null;
      advance(end + 2);
    } else if (s.startsWith('</', i)) {
      const end = s.indexOf('>', i + 2);
      if (end === -1) throw new wxXmlParseError(`unclosed end tag at line ${line}`);
      const name = s.slice(i + 2, end).trim();
      const node = stack.pop();
      if (!node || node.GetName() !== name)
        throw new wxXmlParseError(`mismatched tag at line ${line}`);
      lastText = null;
      advance(end + 1);
    } else {
      // a start tag: name, then attributes, then '>' or '/>'
      const tagLine = line;
      let k = i + 1;
      const nameMatch = /^[^\s/>]+/.exec(s.slice(k, k + 256));
      if (!nameMatch) throw new wxXmlParseError(`not well-formed (invalid token) at line ${line}`);
      const node = new wxXmlNode(wxXmlNodeKind.wxXML_ELEMENT_NODE, nameMatch[0], '', tagLine);
      k += nameMatch[0].length;

      let selfClosing = false;

      for (;;) {
        while (k < s.length && /\s/.test(s[k]!)) k++;

        if (k >= s.length) throw new wxXmlParseError(`unclosed token at line ${tagLine}`);

        if (s[k] === '>') {
          k++;
          break;
        }

        if (s[k] === '/' && s[k + 1] === '>') {
          selfClosing = true;
          k += 2;
          break;
        }

        const eq = s.indexOf('=', k);
        if (eq === -1) throw new wxXmlParseError(`not well-formed at line ${tagLine}`);
        const attrName = s.slice(k, eq).trim();
        k = eq + 1;
        while (/\s/.test(s[k] ?? '')) k++;
        const quote = s[k];
        if (quote !== '"' && quote !== "'")
          throw new wxXmlParseError(`not well-formed at line ${tagLine}`);
        const close = s.indexOf(quote, k + 1);
        if (close === -1) throw new wxXmlParseError(`unclosed attribute at line ${tagLine}`);
        node.AddAttribute(attrName, normalizeAttribute(s.slice(k + 1, close), tagLine));
        k = close + 1;
      }

      const parent = top();

      if (parent) parent.AddChild(node);
      else if (root) throw new wxXmlParseError(`junk after document element at line ${tagLine}`);
      else root = node;

      if (!selfClosing) stack.push(node);

      lastText = null;
      advance(k);
    }
  }

  if (!root) throw new wxXmlParseError('no element found');
  if (stack.length) throw new wxXmlParseError('unclosed token');

  return root;
}
