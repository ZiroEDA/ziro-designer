// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/ptree.cpp` + `include/ptree.h`: an s-expression read into a property tree (`Scan`) and
 * written back out (`Format`).
 *
 * `PTREE` is `boost::property_tree::ptree` upstream. This is the part of its interface KiCad's
 * callers use: an ordered list of (key, subtree) children, a data string, `push_back`, `front`,
 * `size`, iteration and `get_child( "a.b.c" )`, which throws PTREE_ERROR for a missing path.
 */
import { T, type DSNLEXER } from './dsnlexer.js';
import type { OUTPUTFORMATTER } from './richio.js';

/** `boost::property_tree::ptree_error`. */
export class PTREE_ERROR extends Error {}

/** A child: `PTREE::value_type`, `std::pair<const std::string, ptree>`. */
export type PTREE_VALUE = readonly [string, PTREE];

export class PTREE {
  private readonly m_children: PTREE_VALUE[] = [];
  private m_data = '';

  /** `data()`. */
  data(): string {
    return this.m_data;
  }

  put_value(aData: string): void {
    this.m_data = aData;
  }

  size(): number {
    return this.m_children.length;
  }

  /** `push_back( value )`: the child it added. */
  push_back(aValue: PTREE_VALUE): PTREE_VALUE {
    this.m_children.push(aValue);
    return aValue;
  }

  front(): PTREE_VALUE {
    const first = this.m_children[0];

    if (!first) throw new PTREE_ERROR('front() of an empty ptree');

    return first;
  }

  [Symbol.iterator](): IterableIterator<PTREE_VALUE> {
    return this.m_children[Symbol.iterator]();
  }

  /** `get_child( path )`: the first child of each '.'-separated key in turn. */
  get_child(aPath: string): PTREE {
    let node: PTREE = this;

    for (const key of aPath.split('.')) {
      const hit = node.m_children.find(([k]) => k === key);

      if (!hit) throw new PTREE_ERROR(`No such node (${aPath})`);

      node = hit[1];
    }

    return node;
  }
}

/** Read a sexpr list from the input stream into a new node with key aLexer->CurText(). */
function scanList(aTree: PTREE, aLexer: DSNLEXER): void {
  console.assert(aLexer.CurTok() === T.LEFT);

  let tok = aLexer.NextTok();

  const key = aLexer.CurText();

  const list = aTree.push_back([key, new PTREE()])[1];

  if (tok !== T.RIGHT) {
    for (tok = aLexer.NextTok(); tok !== T.RIGHT; tok = aLexer.NextTok()) {
      if (tok === T.EOF) aLexer.Unexpected(T.EOF);

      Scan(list, aLexer);
    }
  }
}

function scanAtom(aTree: PTREE, aLexer: DSNLEXER): void {
  const key = aLexer.CurText();

  aTree.push_back([key, new PTREE()]);
}

/**
 * `Scan( aTree, aLexer )`: fill an empty PTREE with information from a KiCad s-expression stream.
 * A list becomes a node keyed by its first token, an atom a node keyed by itself.
 */
export function Scan(aTree: PTREE, aLexer: DSNLEXER): void {
  let tok = aLexer.CurTok();

  if (tok === T.NONE) tok = aLexer.NextTok();

  if (tok === T.EOF) aLexer.Unexpected(T.EOF);

  if (tok === T.LEFT) scanList(aTree, aLexer);
  else scanAtom(aTree, aLexer);
}

const CTL_OMIT_NL = 1 << 0;
const CTL_IN_ATTRS = 1 << 1;

function isAtom(aTree: PTREE): boolean {
  return aTree.size() === 0 && aTree.data().length === 0;
}

function formatList(out: OUTPUTFORMATTER, aNestLevel: number, aCtl: number, aTree: PTREE): void {
  const children = [...aTree];

  for (let i = 0; i < children.length; i++) {
    const [key, child] = children[i]!;

    if (key === '<xmlattr>') {
      formatList(out, aNestLevel, aCtl | CTL_IN_ATTRS, child);
      continue;
    }

    let ctl = 0;

    // is "it" the last one?
    if (i === children.length - 1) {
      ctl = CTL_OMIT_NL;
    } else if (isAtom(children[i + 1]![1])) {
      // is "it" not the last one and is it followed by an atom?
      ctl = CTL_OMIT_NL;
    }

    formatNode(out, aNestLevel + 1, ctl, key, child);
  }
}

function formatNode(
  out: OUTPUTFORMATTER,
  aNestLevel: number,
  aCtl: number,
  aKey: string,
  aTree: PTREE,
): void {
  if (!isAtom(aTree)) {
    // is a list, not an atom
    let ctl = CTL_OMIT_NL;

    // aTree is list and its first child is a list
    if (aTree.size() && !isAtom(aTree.front()[1]) && !aTree.data().length) ctl = 0;

    out.Print(aNestLevel, `(${out.Quotes(aKey)}${ctl & CTL_OMIT_NL ? '' : '\n'}`);

    // sexpr format does not use data()
    if (aTree.data().length)
      out.Print(0, ` ${out.Quotes(aTree.data())}${aTree.size() ? '\n' : ''}`);

    formatList(out, aNestLevel, aCtl, aTree);

    out.Print(0, `)${aCtl & CTL_OMIT_NL ? '' : '\n'}`);
  } else {
    // is an atom, not a list
    out.Print(0, ` ${out.Quotes(aKey)}`);
  }
}

/** `Format( out, aNestLevel, aCtl, aTree )`: output a PTREE into s-expression format. */
export function Format(out: OUTPUTFORMATTER, aNestLevel: number, aCtl: number, aTree: PTREE): void {
  if (aTree.size() === 1 && !aTree.data().length) {
    // The topmost node is basically only a container for the document root.
    // It anchors the paths which traverse the tree deeper.
    const [key, child] = aTree.front();
    formatNode(out, aNestLevel, aCtl, key, child);
  } else {
    // This is not expected, neither for sexpr nor xml.
    formatNode(out, aNestLevel, aCtl, '', aTree);
  }
}
