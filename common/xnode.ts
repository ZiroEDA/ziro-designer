// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `XNODE` and `XATTR` (include/xnode.h, common/xnode.cpp): a `wxXmlNode` tree
 * that can also print itself as an S-expression. The netlist exporters build
 * one tree; `NETLIST_EXPORTER_KICAD` prints it with `Format`, the XML one
 * saves it as a `wxXmlDocument`.
 *
 * The half of `wxXmlNode` / `wxXmlAttribute` it stands on is here too: a node
 * is an element or a text node, its children are a first-child / next-sibling
 * list (so `GetNext()` means what it does in wx), and attributes keep their
 * insertion order.
 */
import { Prettify } from './io/kicad/kicad_io_utils.js';
import { type OUTPUTFORMATTER, STRING_FORMATTER } from './richio.js';

/** `wxXmlNodeType`, the two kinds an XNODE is used as. */
export enum wxXmlNodeType {
  wxXML_ELEMENT_NODE = 1,
  wxXML_TEXT_NODE = 3,
  wxXML_CDATA_SECTION_NODE = 4,
  wxXML_DOCUMENT_NODE = 9,
}

/**
 * `XATTR::VALUE_TYPE`, `std::variant<wxString, int, double>`. A JS number
 * cannot say which of the two numeric types it was, so the variant is tagged.
 */
export type XATTR_VALUE =
  | { type: 'string'; value: string }
  | { type: 'int'; value: number }
  | { type: 'double'; value: number };

/** `fmt::format( "{:.10g}", arg )`: ten significant digits, `%g` style. */
function formatG10(arg: number): string {
  if (arg === 0) return Object.is(arg, -0) ? '-0' : '0';
  // The exponent AFTER rounding to 10 significant digits, as %g decides it.
  const exp = Number(arg.toExponential(9).split('e')[1]);
  // %g picks exponent form below 1e-4 or at/above 1e<precision>.
  if (exp < -4 || exp >= 10) {
    let [mant, e] = arg.toExponential(9).split('e') as [string, string];
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const n = Number(e);
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  let s = arg.toPrecision(10);
  if (s.includes('e')) s = Number(s).toString();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** An attribute that remembers the type it was given, so `Format` can leave a number unquoted. */
export class XATTR {
  private readonly m_name: string;
  private readonly m_value: string;
  private readonly m_originalValue: XATTR_VALUE;

  constructor(aName: string, aValue: XATTR_VALUE) {
    this.m_name = aName;
    this.m_originalValue = aValue;

    switch (aValue.type) {
      case 'int':
        this.m_value = String(Math.trunc(aValue.value)); // "%d"
        break;
      case 'double': {
        const arg = aValue.value;
        let buf: string;

        if (arg !== 0.0 && Math.abs(arg) <= 0.0001) {
          buf = arg.toFixed(16); // "{:.16f}"

          // remove trailing zeros (and the decimal marker if needed)
          while (buf.length > 0 && buf[buf.length - 1] === '0') buf = buf.slice(0, -1);

          // if the value was really small
          // we may have just stripped all the zeros after the decimal
          if (buf[buf.length - 1] === '.') buf = buf.slice(0, -1);
        } else {
          buf = formatG10(arg);
        }

        this.m_value = buf;
        break;
      }
      default:
        this.m_value = aValue.value;
    }
  }

  GetName(): string {
    return this.m_name;
  }

  /** `wxXmlAttribute::GetValue`: the text form. */
  GetValueText(): string {
    return this.m_value;
  }

  /** `XATTR::GetValue`: the value as it was given. */
  GetValue(): XATTR_VALUE {
    return this.m_originalValue;
  }
}

/** Holds an XML or S-expression element. */
export class XNODE {
  private m_type: wxXmlNodeType;
  private m_name: string;
  private m_content: string;
  private readonly m_attributes: XATTR[] = [];
  private m_children: XNODE | null = null;
  /** The last child, so appending does not walk the list (wx keeps the same). */
  private m_lastChild: XNODE | null = null;
  private m_next: XNODE | null = null;
  private m_parent: XNODE | null = null;

  /** `XNODE( wxXmlNodeType, name, content )`. */
  constructor(aType: wxXmlNodeType = wxXmlNodeType.wxXML_ELEMENT_NODE, aName = '', aContent = '') {
    this.m_type = aType;
    this.m_name = aName;
    this.m_content = aContent;
  }

  GetType(): wxXmlNodeType {
    return this.m_type;
  }

  GetName(): string {
    return this.m_name;
  }

  GetContent(): string {
    return this.m_content;
  }

  /** `wxXmlNode::SetContent`. */
  SetContent(aContent: string): void {
    this.m_content = aContent;
  }

  /**
   * `wxXmlNode::GetNodeContent`: the content of the first text or CDATA
   * child, or empty when there is none.
   */
  GetNodeContent(): string {
    for (let n = this.m_children; n; n = n.m_next) {
      if (
        n.m_type === wxXmlNodeType.wxXML_TEXT_NODE ||
        n.m_type === wxXmlNodeType.wxXML_CDATA_SECTION_NODE
      )
        return n.m_content;
    }

    return '';
  }

  GetParent(): XNODE | null {
    return this.m_parent;
  }

  GetChildren(): XNODE | null {
    return this.m_children;
  }

  GetNext(): XNODE | null {
    return this.m_next;
  }

  GetAttributes(): readonly XATTR[] {
    return this.m_attributes;
  }

  /** `wxXmlNode::AddChild`: append after the last child. */
  AddChild(aChild: XNODE): void {
    aChild.m_parent = this;
    aChild.m_next = null;

    if (!this.m_children) this.m_children = aChild;
    else this.m_lastChild!.m_next = aChild;

    this.m_lastChild = aChild;
  }

  /**
   * `wxXmlNode::InsertChild( child, followingNode )`: insert before `aFollowingNode`, one of
   * this node's children, or append when it is null. False when it is not a child.
   */
  InsertChild(aChild: XNODE, aFollowingNode: XNODE | null): boolean {
    if (!aFollowingNode) {
      this.AddChild(aChild);
      return true;
    }

    if (aFollowingNode.m_parent !== this) return false;

    aChild.m_parent = this;
    aChild.m_next = aFollowingNode;

    if (this.m_children === aFollowingNode) {
      this.m_children = aChild;
      return true;
    }

    let prev = this.m_children;

    while (prev && prev.m_next !== aFollowingNode) prev = prev.m_next;

    if (!prev) return false;

    prev.m_next = aChild;
    return true;
  }

  /**
   * `wxXmlNode::InsertChildAfter( child, precedingNode )`: insert after `aPrecedingNode`, one of
   * this node's children, or first when it is null.
   */
  InsertChildAfter(aChild: XNODE, aPrecedingNode: XNODE | null): boolean {
    aChild.m_parent = this;

    if (!aPrecedingNode) {
      aChild.m_next = this.m_children;
      this.m_children = aChild;

      if (!this.m_lastChild) this.m_lastChild = aChild;

      return true;
    }

    if (aPrecedingNode.m_parent !== this) return false;

    aChild.m_next = aPrecedingNode.m_next;
    aPrecedingNode.m_next = aChild;

    if (this.m_lastChild === aPrecedingNode) this.m_lastChild = aChild;

    return true;
  }

  /** `wxXmlNode::RemoveChild( child )`: unlink one child; false when it is not one. */
  RemoveChild(aChild: XNODE): boolean {
    let prev: XNODE | null = null;

    for (let n = this.m_children; n; prev = n, n = n.m_next) {
      if (n !== aChild) continue;

      if (prev) prev.m_next = n.m_next;
      else this.m_children = n.m_next;

      if (this.m_lastChild === n) this.m_lastChild = prev;

      n.m_next = null;
      n.m_parent = null;
      return true;
    }

    return false;
  }

  /** `wxXmlNode::GetAttribute( name, &value )`: the value, or null when there is none. */
  GetAttribute(aName: string): string | null {
    for (const a of this.m_attributes) if (a.GetName() === aName) return a.GetValueText();

    return null;
  }

  /** `wxXmlNode::DeleteAttribute( name )`: whether one was removed. */
  DeleteAttribute(aName: string): boolean {
    const i = this.m_attributes.findIndex((a) => a.GetName() === aName);

    if (i < 0) return false;

    this.m_attributes.splice(i, 1);
    return true;
  }

  AddBool(aKey: string, aValue: boolean): void {
    this.AddAttribute(aKey, aValue ? 'yes' : 'no');
  }

  /** `AddAttribute( const wxString&, const wxString& )`. */
  AddAttribute(aName: string, aValue: string): void {
    this.m_attributes.push(new XATTR(aName, { type: 'string', value: aValue }));
  }

  /** `AddAttribute( const wxString&, int )`. */
  AddAttributeInt(aName: string, aValue: number): void {
    this.m_attributes.push(new XATTR(aName, { type: 'int', value: aValue }));
  }

  /** `AddAttribute( const wxString&, double )`. */
  AddAttributeDouble(aName: string, aValue: number): void {
    this.m_attributes.push(new XATTR(aName, { type: 'double', value: aValue }));
  }

  /**
   * `Format( OUTPUTFORMATTER* )`: write this object as UTF8 out to an
   * OUTPUTFORMATTER as an S-expression.
   */
  Format(out: OUTPUTFORMATTER): void;
  /** `Format()`: the S-expression, prettified. */
  Format(): string;
  Format(out?: OUTPUTFORMATTER): string | undefined {
    if (!out) {
      const formatter = new STRING_FORMATTER();
      this.Format(formatter);
      return Prettify(formatter.GetString());
    }

    switch (this.GetType()) {
      case wxXmlNodeType.wxXML_ELEMENT_NODE:
        out.Print(0, `(${this.GetName()}`);
        this.FormatContents(out);

        if (this.GetNext()) out.Print(0, ')\n');
        else out.Print(0, ')');

        break;

      default:
        this.FormatContents(out);
    }

    return undefined;
  }

  /**
   * Write the contents of object as UTF8 out to an OUTPUTFORMATTER as an
   * S-expression. This is the same as Format() except that the outer wrapper
   * is not included.
   */
  FormatContents(out: OUTPUTFORMATTER): void {
    // output attributes first if they exist
    for (const attr of this.m_attributes) {
      const type = attr.GetValue().type;
      const quote = !(type === 'int' || type === 'double');

      out.Print(
        0,
        ` (${attr.GetName()} ${quote ? out.Quotew(attr.GetValueText()) : attr.GetValueText()})`,
      );
    }

    // we only expect to have used one of two types here:
    switch (this.GetType()) {
      case wxXmlNodeType.wxXML_ELEMENT_NODE:
        for (let child = this.GetChildren(); child; child = child.GetNext()) {
          if (child.GetType() !== wxXmlNodeType.wxXML_TEXT_NODE) {
            if (child === this.GetChildren()) out.Print(0, '\n');

            child.Format(out);
          } else {
            child.Format(out);
          }
        }

        break;

      case wxXmlNodeType.wxXML_TEXT_NODE:
        out.Print(0, ` ${out.Quotew(this.GetContent())}`);
        break;

      default:
      // not supported
    }
  }
}
