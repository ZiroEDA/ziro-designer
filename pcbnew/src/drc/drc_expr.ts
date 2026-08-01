// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The custom-rule condition language.
 * Counterparts: `common/libeval_compiler/libeval_compiler.cpp` (the tokeniser
 * and Pratt parser) and `pcbnew/pcbexpr_evaluator.cpp` (what `A` and `B`
 * resolve to on a board).
 *
 *   A.NetClass == 'HV'
 *   A.Type == 'Track' && B.Layer == 'F.Cu'
 *   A.intersectsArea('keepout') || !A.enclosedByArea('safe')
 *
 * The grammar ported here is the subset real `.kicad_dru` files use: property
 * access on `A`/`B`, function calls taking quoted arguments (one, as
 * `intersectsArea`, or two, as `fromTo`), comparisons, `&&`/`||`/`!`,
 * parentheses, and string/number literals. Arithmetic is left out and reported
 * rather than silently mis-evaluated — a condition that quietly returns false
 * would apply a rule to nothing and look like the board passed.
 */

/** A parsed condition. */
export type DrcExpr =
  | { kind: 'literal'; value: string | number }
  | { kind: 'property'; item: 'A' | 'B'; name: string }
  | { kind: 'call'; item: 'A' | 'B'; name: string; args: string[] }
  | { kind: 'not'; operand: DrcExpr }
  | { kind: 'binary'; op: BinaryOp; left: DrcExpr; right: DrcExpr };

export type BinaryOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export class DrcExprError extends Error {}

// ---------------------------------------------------------------------------
// Tokeniser

type Token =
  | { t: 'ident'; v: string }
  | { t: 'string'; v: string }
  | { t: 'number'; v: number }
  | { t: 'op'; v: string }
  | { t: 'punct'; v: '(' | ')' | '.' | ',' };

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!'];

function tokenise(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Both quote styles: upstream's rules use single quotes, but the token is
    // a plain string either way.
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new DrcExprError(`unterminated string in "${src}"`);
      out.push({ t: 'string', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === '.' || ch === ',') {
      out.push({ t: 'punct', v: ch });
      i++;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }

    const num = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'number', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }

    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (ident) {
      out.push({ t: 'ident', v: ident[0] });
      i += ident[0].length;
      continue;
    }

    throw new DrcExprError(`unexpected character "${ch}" in "${src}"`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Parser

/** Binding power, loosest first: || < && < comparison. */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
};

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expect(v: string): void {
    const t = this.next();
    if (!t || (t.t !== 'punct' && t.t !== 'op') || t.v !== v)
      throw new DrcExprError(`expected "${v}" in "${this.src}"`);
  }

  parse(): DrcExpr {
    const e = this.expr(0);
    if (this.pos !== this.tokens.length) throw new DrcExprError(`trailing input in "${this.src}"`);
    return e;
  }

  /** Precedence climbing, as LIBEVAL::COMPILER does. */
  private expr(minBp: number): DrcExpr {
    let left = this.unary();

    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') break;
      const bp = PRECEDENCE[t.v];
      if (bp === undefined || bp < minBp) break;
      this.next();
      const right = this.expr(bp + 1);
      left = { kind: 'binary', op: t.v as BinaryOp, left, right };
    }

    return left;
  }

  private unary(): DrcExpr {
    const t = this.peek();

    if (t?.t === 'op' && t.v === '!') {
      this.next();
      return { kind: 'not', operand: this.unary() };
    }

    return this.primary();
  }

  private primary(): DrcExpr {
    const t = this.next();
    if (!t) throw new DrcExprError(`unexpected end of "${this.src}"`);

    if (t.t === 'punct' && t.v === '(') {
      const e = this.expr(0);
      this.expect(')');
      return e;
    }

    if (t.t === 'string') return { kind: 'literal', value: t.v };
    if (t.t === 'number') return { kind: 'literal', value: t.v };

    if (t.t === 'ident') {
      // Bare `A` or `B` must be followed by a property or a call.
      if (t.v !== 'A' && t.v !== 'B')
        throw new DrcExprError(`unknown identifier "${t.v}" in "${this.src}" (expected A or B)`);

      this.expect('.');
      const name = this.next();
      if (!name || name.t !== 'ident')
        throw new DrcExprError(`expected a property name after ${t.v}. in "${this.src}"`);

      const after = this.peek();
      if (after?.t === 'punct' && after.v === '(') {
        this.next();
        const args: string[] = [];

        // Zero or more quoted arguments: `intersectsArea('x')` takes one,
        // `fromTo('IC14-*', 'IC13-*')` takes two.
        for (;;) {
          const nxt = this.peek();
          if (nxt?.t === 'punct' && nxt.v === ')') break;

          const arg = this.next();
          if (!arg || arg.t !== 'string')
            throw new DrcExprError(`${t.v}.${name.v}() takes quoted arguments in "${this.src}"`);
          args.push(arg.v);

          const sep = this.peek();
          if (sep?.t === 'punct' && sep.v === ',') {
            this.next();
            continue;
          }
          break;
        }

        this.expect(')');
        return { kind: 'call', item: t.v, name: name.v, args };
      }

      return { kind: 'property', item: t.v, name: name.v };
    }

    throw new DrcExprError(`unexpected token in "${this.src}"`);
  }
}

/** Compile a condition string. Throws DrcExprError with the offending text. */
export function parseDrcExpr(src: string): DrcExpr {
  return new Parser(tokenise(src), src).parse();
}

// ---------------------------------------------------------------------------
// Evaluation

/**
 * What `A` and `B` resolve to. The host supplies the board knowledge; this
 * module only walks the tree.
 */
export interface DrcExprContext {
  /** `A.NetClass`, `A.Type`, `A.Layer`, … — undefined for an unknown property. */
  property: (item: 'A' | 'B', name: string) => string | number | undefined;
  /** `A.intersectsArea('x')`, `A.fromTo('a','b')`, … */
  call?: (item: 'A' | 'B', name: string, args: string[]) => boolean | undefined;
}

/** Loose equality, as the expression language compares strings to strings. */
const eq = (a: string | number | undefined, b: string | number | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
};

const asNumber = (v: string | number | boolean | undefined): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

const truthy = (v: string | number | boolean | undefined): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== '0';
  return false;
};

/**
 * Evaluate a compiled condition.
 *
 * An unresolvable property makes its comparison false rather than throwing:
 * that is upstream's behaviour, and it keeps a rule that mentions a property we
 * do not model yet from taking the whole DRC run down with it.
 */
export function evalDrcExpr(
  expr: DrcExpr,
  ctx: DrcExprContext,
): string | number | boolean | undefined {
  switch (expr.kind) {
    case 'literal':
      return expr.value;

    case 'property':
      return ctx.property(expr.item, expr.name);

    case 'call':
      return ctx.call?.(expr.item, expr.name, expr.args) ?? false;

    case 'not':
      return !truthy(evalDrcExpr(expr.operand, ctx));

    case 'binary': {
      if (expr.op === '&&')
        return truthy(evalDrcExpr(expr.left, ctx)) && truthy(evalDrcExpr(expr.right, ctx));
      if (expr.op === '||')
        return truthy(evalDrcExpr(expr.left, ctx)) || truthy(evalDrcExpr(expr.right, ctx));

      const l = evalDrcExpr(expr.left, ctx);
      const r = evalDrcExpr(expr.right, ctx);

      if (expr.op === '==') return eq(l as string | number, r as string | number);
      if (expr.op === '!=') return !eq(l as string | number, r as string | number);

      const ln = asNumber(l);
      const rn = asNumber(r);
      if (ln === undefined || rn === undefined) return false;

      switch (expr.op) {
        case '<':
          return ln < rn;
        case '<=':
          return ln <= rn;
        case '>':
          return ln > rn;
        case '>=':
          return ln >= rn;
      }
      return false;
    }
  }
}

/**
 * Compile and evaluate in one step; a condition that will not compile is
 * treated as not matching, and the reason handed back to the caller.
 */
export function testDrcCondition(
  src: string,
  ctx: DrcExprContext,
): { matched: boolean; error?: string } {
  try {
    return { matched: truthy(evalDrcExpr(parseDrcExpr(src), ctx)) };
  } catch (e) {
    return { matched: false, error: e instanceof Error ? e.message : String(e) };
  }
}
