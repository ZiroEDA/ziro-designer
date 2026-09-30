// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/altium_rule_transformer.cpp`: the tokenizer for
 * Altium's rule query language.
 *
 * See: https://www.altium.com/documentation/altium-designer/query-operators-ad
 */

import { ToLong } from '@ziroeda/common/libc/stdlib.js';

export enum ALTIUM_RULE_TOKEN_KIND {
  UNKNOWN,
  IDENT,
  CONST_INT,
  CONST_FLOAT,
  CONST_STRING,
  CONST_TRUE,
  CONST_FALSE,
  LPAR,
  RPAR,
  ADD,
  SUB,
  MUL,
  DIV,
  INTEGRAL_DIV,
  MOD,
  AND,
  LOW_AND,
  OR,
  LOW_OR,
  XOR,
  NOT,
  LESS,
  LESS_EQUAL,
  GREATER_EQUAL,
  GREATER,
  NOT_EQUAL,
  EQUAL,
  BETWEEN,
  LIKE,
  END_OF_EXPR,
}

export interface ALTIUM_RULE_TOKEN {
  kind: ALTIUM_RULE_TOKEN_KIND;
  pos: number;
  iValue: number;
  fValue: number;
  sValue: string;
}

function token(
  kind: ALTIUM_RULE_TOKEN_KIND = ALTIUM_RULE_TOKEN_KIND.UNKNOWN,
  pos = 0,
  value: { i?: number; s?: string } = {},
): ALTIUM_RULE_TOKEN {
  return { kind, pos, iValue: value.i ?? 0, fValue: 0, sValue: value.s ?? '' };
}

/** `wxIsspace` / `wxIsdigit` / `wxIsalnum` in the C locale on one character. */
const isspace = (c: string): boolean => c !== '' && ' \t\n\v\f\r'.includes(c);
const isdigit = (c: string): boolean => c >= '0' && c <= '9' && c.length === 1;
const isalnum = (c: string): boolean => /^[0-9A-Za-z]$/.test(c);

export class ALTIUM_RULE_TOKENIZER {
  private m_pos = 0;
  /** `m_expr`'s characters; `m_it` is an index into them. */
  private readonly m_expr: string[];
  private m_it = 0;

  private m_currentToken: ALTIUM_RULE_TOKEN = token();
  private m_nextToken: ALTIUM_RULE_TOKEN = token();

  constructor(aExpr: string) {
    this.m_expr = [...aExpr];
    this.m_it = 0;
    this.Next();
  }

  private atEnd(): boolean {
    return this.m_it >= this.m_expr.length;
  }

  private curChar(): string {
    return this.m_expr[this.m_it] ?? '';
  }

  private nextChar(): string {
    if (!this.atEnd()) {
      this.m_it++;
      this.m_pos++;
      if (!this.atEnd()) return this.m_expr[this.m_it]!;
    }

    return ''; // wxUniChar()
  }

  Next(): ALTIUM_RULE_TOKEN {
    this.m_currentToken = this.m_nextToken;

    // skip whitespaces
    for (; !this.atEnd() && isspace(this.curChar()); this.nextChar());

    // check for end of string
    if (this.atEnd()) {
      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.END_OF_EXPR, this.m_pos);
      return this.m_currentToken;
    }

    const startPos = this.m_pos;
    const curCh = this.curChar();
    let nextCh = this.nextChar();

    const simple: Record<string, ALTIUM_RULE_TOKEN_KIND> = {
      '(': ALTIUM_RULE_TOKEN_KIND.LPAR,
      ')': ALTIUM_RULE_TOKEN_KIND.RPAR,
      '*': ALTIUM_RULE_TOKEN_KIND.MUL,
      '/': ALTIUM_RULE_TOKEN_KIND.DIV,
      '=': ALTIUM_RULE_TOKEN_KIND.EQUAL,
    };

    if (curCh in simple) {
      this.m_nextToken = token(simple[curCh], startPos);
      return this.m_currentToken;
    } else if (curCh === '<') {
      if (nextCh === '=') {
        this.nextChar();
        this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.LESS_EQUAL, startPos);
      } else if (nextCh === '>') {
        this.nextChar();
        this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.NOT_EQUAL, startPos);
      } else {
        this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.LESS, startPos);
      }
      return this.m_currentToken;
    } else if (curCh === '>') {
      if (nextCh === '=') {
        this.nextChar();
        this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.GREATER_EQUAL, startPos);
      } else {
        this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.GREATER, startPos);
      }
      return this.m_currentToken;
    } else if (curCh === '&' && nextCh === '&') {
      this.nextChar();
      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.LOW_AND, startPos);
      return this.m_currentToken;
    } else if (curCh === '|' && nextCh === '|') {
      this.nextChar();
      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.LOW_OR, startPos);
      return this.m_currentToken;
    } else if (curCh === "'") {
      let constString = '';
      while (!this.atEnd() && nextCh !== "'") {
        constString += nextCh; // TODO: escaping?
        nextCh = this.nextChar();
      }

      if (!this.atEnd()) {
        this.nextChar(); // TODO: exception if EOF reached?
      }

      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.CONST_STRING, startPos, { s: constString });
      return this.m_currentToken;
    } else if (curCh === '+' && !isdigit(nextCh)) {
      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.ADD, startPos);
      return this.m_currentToken;
    } else if (curCh === '-' && !isdigit(nextCh)) {
      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.SUB, startPos);
      return this.m_currentToken;
    } else if (curCh === '+' || curCh === '-' || isdigit(curCh)) {
      let digitString = curCh;
      while (isdigit(nextCh)) {
        digitString += nextCh;
        nextCh = this.nextChar();
      }

      const value = ToLong(digitString).value; // TODO: check return value

      this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.CONST_INT, startPos, { i: value });
      return this.m_currentToken;
    } else {
      let identString = curCh;
      while (isalnum(nextCh)) {
        identString += nextCh;
        nextCh = this.nextChar();
      }

      const keywords: [string, ALTIUM_RULE_TOKEN_KIND][] = [
        ['true', ALTIUM_RULE_TOKEN_KIND.CONST_TRUE],
        ['false', ALTIUM_RULE_TOKEN_KIND.CONST_FALSE],
        ['div', ALTIUM_RULE_TOKEN_KIND.INTEGRAL_DIV],
        ['mod', ALTIUM_RULE_TOKEN_KIND.MOD],
        ['and', ALTIUM_RULE_TOKEN_KIND.AND],
        ['or', ALTIUM_RULE_TOKEN_KIND.OR],
        ['xor', ALTIUM_RULE_TOKEN_KIND.XOR],
        ['not', ALTIUM_RULE_TOKEN_KIND.NOT],
        ['between', ALTIUM_RULE_TOKEN_KIND.BETWEEN],
        ['like', ALTIUM_RULE_TOKEN_KIND.LIKE],
      ];

      // IsSameAs( …, false ): ignoring case
      const keyword = keywords.find(([k]) => k === identString.toLowerCase());

      if (keyword) this.m_nextToken = token(keyword[1], startPos);
      else this.m_nextToken = token(ALTIUM_RULE_TOKEN_KIND.IDENT, startPos, { s: identString });

      return this.m_currentToken;
    }
  }

  Peek(): ALTIUM_RULE_TOKEN {
    return this.m_nextToken;
  }
}
