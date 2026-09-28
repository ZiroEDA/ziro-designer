// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/text_eval/text_eval.lemon`: the grammar of an `@{...}` document,
 * which KiCad feeds to the lemon parser generator and `#include`s as
 * `KI_EVAL::Parse` into `text_eval_wrapper.cpp`.
 *
 * There is no lemon here, so the grammar is a hand-written recursive descent
 * behind lemon's push interface (`ParseAlloc` / `Parse` / `ParseFree`): tokens
 * are fed one at a time and the tree is built when the end token arrives. The
 * precedence table is lemon's, restated as one function per level:
 *
 * ```
 * %left LT GT LE GE EQ NE.        comparison()  - lowest, left
 * %left PLUS MINUS.               additive()
 * %left MULTIPLY DIVIDE MODULO.   term()
 * %right UMINUS.                  factor(): MINUS factor / PLUS factor
 * %right POWER.                   factor(): primary POWER factor - binds
 *                                  tighter than a unary minus, so -2^2 is -4
 * ```
 *
 * A syntax error reports through `g_errorCollector` as `%syntax_error` does;
 * the wrapper stops at the first error and keeps the input, so lemon's error
 * recovery never shapes a result and is not reproduced.
 */

import {
  DOC,
  g_errorCollector,
  GetTokenDouble,
  GetTokenString,
  NODE,
  type TOKEN_TYPE,
} from './text_eval_parser.js';

/**
 * The token codes lemon assigns: `%left`/`%right`/`%token` declarations first,
 * then terminals in order of first use in the rules. 0 is end of input.
 */
export enum KI_EVAL_TOKEN {
  ENDS = 0,
  LT = 1,
  GT = 2,
  LE = 3,
  GE = 4,
  EQ = 5,
  NE = 6,
  PLUS = 7,
  MINUS = 8,
  MULTIPLY = 9,
  DIVIDE = 10,
  MODULO = 11,
  UMINUS = 12,
  POWER = 13,
  COMMA = 14,
  TEXT = 15,
  AT_OPEN = 16,
  CLOSE_BRACE = 17,
  LPAREN = 18,
  RPAREN = 19,
  NUMBER = 20,
  STRING = 21,
  IDENTIFIER = 22,
  DOLLAR_OPEN = 23,
}

/** The parser state lemon's `ParseAlloc` returns: the tokens fed so far. */
export interface KI_EVAL_PARSER {
  tokens: { type: KI_EVAL_TOKEN; value: TOKEN_TYPE }[];
}

/** `ParseAlloc`. */
export function ParseAlloc(): KI_EVAL_PARSER {
  return { tokens: [] };
}

/** `ParseFree`. */
export function ParseFree(aParser: KI_EVAL_PARSER): void {
  aParser.tokens = [];
}

class EvalSyntaxError extends Error {}

class Grammar {
  private m_pos = 0;

  constructor(private readonly m_tokens: { type: KI_EVAL_TOKEN; value: TOKEN_TYPE }[]) {}

  private peek(): KI_EVAL_TOKEN {
    return this.m_tokens[this.m_pos]?.type ?? KI_EVAL_TOKEN.ENDS;
  }

  private take(aType: KI_EVAL_TOKEN): TOKEN_TYPE {
    const token = this.m_tokens[this.m_pos];

    if (!token || token.type !== aType) throw new EvalSyntaxError();

    this.m_pos++;
    return token.value;
  }

  /** `document ::= content_list.` */
  document(): DOC {
    const doc = new DOC();

    // content_list ::= . | content_list content_item.
    while (this.peek() !== KI_EVAL_TOKEN.ENDS) doc.AddNode(this.contentItem());

    return doc;
  }

  private contentItem(): NODE {
    switch (this.peek()) {
      // content_item ::= TEXT.
      case KI_EVAL_TOKEN.TEXT:
        return NODE.CreateText(GetTokenString(this.take(KI_EVAL_TOKEN.TEXT)));

      // content_item ::= calculation.   calculation ::= AT_OPEN expression CLOSE_BRACE.
      case KI_EVAL_TOKEN.AT_OPEN: {
        this.take(KI_EVAL_TOKEN.AT_OPEN);
        const expr = this.expression();
        this.take(KI_EVAL_TOKEN.CLOSE_BRACE);
        return NODE.CreateCalc(expr);
      }

      // content_item ::= variable.
      case KI_EVAL_TOKEN.DOLLAR_OPEN:
        return NODE.CreateCalc(this.variable());

      default:
        throw new EvalSyntaxError();
    }
  }

  /** `expression ::= expression (LT|GT|LE|GE|EQ|NE) expression.` - the lowest level. */
  private expression(): NODE {
    let left = this.additive();

    for (;;) {
      const t = this.peek();
      let op: '<' | '>' | 1 | 2 | 3 | 4;

      if (t === KI_EVAL_TOKEN.LT) op = '<';
      else if (t === KI_EVAL_TOKEN.GT) op = '>';
      else if (t === KI_EVAL_TOKEN.LE)
        op = 1; // Using 1 for <=
      else if (t === KI_EVAL_TOKEN.GE)
        op = 2; // Using 2 for >=
      else if (t === KI_EVAL_TOKEN.EQ)
        op = 3; // Using 3 for ==
      else if (t === KI_EVAL_TOKEN.NE)
        op = 4; // Using 4 for !=
      else return left;

      this.m_pos++;
      left = NODE.CreateBinOp(left, op, this.additive());
    }
  }

  /** `expression ::= expression (PLUS|MINUS) expression. | term.` */
  private additive(): NODE {
    let left = this.term();

    for (;;) {
      const t = this.peek();

      if (t !== KI_EVAL_TOKEN.PLUS && t !== KI_EVAL_TOKEN.MINUS) return left;

      this.m_pos++;
      left = NODE.CreateBinOp(left, t === KI_EVAL_TOKEN.PLUS ? '+' : '-', this.term());
    }
  }

  /** `term ::= term (MULTIPLY|DIVIDE|MODULO) term. | factor.` */
  private term(): NODE {
    let left = this.factor();

    for (;;) {
      const t = this.peek();
      let op: '*' | '/' | '%';

      if (t === KI_EVAL_TOKEN.MULTIPLY) op = '*';
      else if (t === KI_EVAL_TOKEN.DIVIDE) op = '/';
      else if (t === KI_EVAL_TOKEN.MODULO) op = '%';
      else return left;

      this.m_pos++;
      left = NODE.CreateBinOp(left, op, this.factor());
    }
  }

  /**
   * `factor ::= MINUS factor. [UMINUS]` (as `0 - factor`), `PLUS factor.`,
   * and `factor ::= factor POWER factor.` - right associative, and above
   * UMINUS, so the operand of a unary sign takes the power with it.
   */
  private factor(): NODE {
    const t = this.peek();

    if (t === KI_EVAL_TOKEN.MINUS) {
      this.m_pos++;
      return NODE.CreateBinOp(NODE.CreateNumber(0.0), '-', this.factor());
    }

    if (t === KI_EVAL_TOKEN.PLUS) {
      this.m_pos++;
      return this.factor();
    }

    const base = this.primary();

    if (this.peek() === KI_EVAL_TOKEN.POWER) {
      this.m_pos++;
      return NODE.CreateBinOp(base, '^', this.factor());
    }

    return base;
  }

  private primary(): NODE {
    switch (this.peek()) {
      // factor ::= LPAREN expression RPAREN.
      case KI_EVAL_TOKEN.LPAREN: {
        this.take(KI_EVAL_TOKEN.LPAREN);
        const expr = this.expression();
        this.take(KI_EVAL_TOKEN.RPAREN);
        return expr;
      }

      // factor ::= NUMBER.
      case KI_EVAL_TOKEN.NUMBER: {
        const n = this.take(KI_EVAL_TOKEN.NUMBER);

        if (!n.isString) return NODE.CreateNumber(GetTokenDouble(n));

        // std::stod on a string token; the tokenizer never makes one.
        const value = Number.parseFloat(GetTokenString(n));

        if (Number.isNaN(value)) {
          g_errorCollector?.AddError(`Invalid number format: ${GetTokenString(n)}`);
          return NODE.CreateNumber(0.0);
        }

        return NODE.CreateNumber(value);
      }

      // factor ::= STRING.
      case KI_EVAL_TOKEN.STRING:
        return NODE.CreateString(GetTokenString(this.take(KI_EVAL_TOKEN.STRING)));

      // factor ::= variable.
      case KI_EVAL_TOKEN.DOLLAR_OPEN:
        return this.variable();

      // factor ::= function_call.
      case KI_EVAL_TOKEN.IDENTIFIER:
        return this.functionCall();

      default:
        throw new EvalSyntaxError();
    }
  }

  /** `function_call ::= IDENTIFIER LPAREN RPAREN. | IDENTIFIER LPAREN arg_list RPAREN.` */
  private functionCall(): NODE {
    const name = GetTokenString(this.take(KI_EVAL_TOKEN.IDENTIFIER));
    this.take(KI_EVAL_TOKEN.LPAREN);

    const args: NODE[] = [];

    if (this.peek() !== KI_EVAL_TOKEN.RPAREN) {
      // arg_list ::= expression. | arg_list COMMA expression.
      args.push(this.expression());

      while (this.peek() === KI_EVAL_TOKEN.COMMA) {
        this.m_pos++;
        args.push(this.expression());
      }
    }

    this.take(KI_EVAL_TOKEN.RPAREN);
    return NODE.CreateFunction(name, args);
  }

  /** `variable ::= DOLLAR_OPEN IDENTIFIER CLOSE_BRACE.` */
  private variable(): NODE {
    this.take(KI_EVAL_TOKEN.DOLLAR_OPEN);
    const name = GetTokenString(this.take(KI_EVAL_TOKEN.IDENTIFIER));
    this.take(KI_EVAL_TOKEN.CLOSE_BRACE);
    return NODE.CreateVar(name);
  }
}

/**
 * `Parse( parser, tokenType, tokenValue, &document )`. Tokens accumulate until
 * `ENDS`; then the document is parsed and stored through `aDocument`, or a
 * syntax error is reported (`%syntax_error`) and `aDocument` is left alone.
 */
export function Parse(
  aParser: KI_EVAL_PARSER,
  aTokenType: KI_EVAL_TOKEN,
  aTokenValue: TOKEN_TYPE,
  aDocument: { value: DOC | null },
): void {
  if (aTokenType !== KI_EVAL_TOKEN.ENDS) {
    aParser.tokens.push({ type: aTokenType, value: aTokenValue });
    return;
  }

  const tokens = aParser.tokens;
  aParser.tokens = [];

  try {
    aDocument.value = new Grammar(tokens).document();
  } catch (e) {
    if (!(e instanceof EvalSyntaxError)) throw e;

    g_errorCollector?.AddSyntaxError();
  }
}
