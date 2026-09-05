#!/usr/bin/env python3
"""Regenerate qa/data/zint_vectors.json from the Zint probe.

The probe links the copy of Zint vendored in KiCad's own tree, which is the
library `PCB_BARCODE::ComputeBarcode` calls. Its answer is the definition of
correct for our port, so these grids are never hand-edited: build the probe
(`qa/probes/zint_probe/build.sh`) and run this from the repository root.
"""
import json
import random
import subprocess

PROBE = 'qa/probes/zint_probe/zint_probe'
ECC_N = {'L': 1, 'M': 2, 'Q': 3, 'H': 4}

LINEAR = [
    'ZIRO', '0', 'ABC-123', 'A B.C$D/E+F%G', 'abc',
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
]
CODE128_ONLY = [
    '1234567890', 'a', 'Hello, World!', '12345678901234567890', 'AB12CD34',
    '\x01\x02control', 'MiXeD123case456', 'ZIROé', 'éèê', '99',
    'X999999999999Y',
]
TWO_D = [
    'ZIRO', '1', '12345', 'HELLO WORLD', 'https://example.com/a/b?c=1',
    'abcdefghijklmnop', '0123456789012345678901234567890123456789',
    'MiXeD 123 TEXT.', 'A' * 100, '9' * 200, 'x' * 300, 'Ω unicode ✓',
    'a', 'AB', '  ', '%$*+-./:',
]
DMATRIX = [
    'A', '1', '12', '123', '1234', 'ZIRO', 'ABC-123', 'Hello, World!',
    'abcdefghij', 'ABCDEFGHIJKLMNOP', '0123456789012345678901234567890',
    'https://example.com/x?y=1', 'A' * 50, '9' * 100, 'x' * 200, 'a' * 7,
    'A1B2C3', '  ', '>*\r', '@ABC', 'Ω unicode ✓', 'MiXeD 123 TEXT.',
    '$%*+-./:', 'AB', 'ABC', 'ABCD', 'ABCDE', '\x01\x02\x03', 'aA1 bB2 cC3',
    'Z' * 30, '0' * 3116,
]
MICRO = [
    '1', '12', '123456', 'ABC', 'HELLO', 'A1B2', 'hello', 'x',
    '12345678901234567890', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345', 'abcdefghij',
    'A B.C:D', '9' * 35, '$%*+-./:', 'Zz', '0',
]

# Random cases, to catch the mode-switching and mask choices that a hand-picked
# list will not. Seeded, so the fixture is reproducible.
ALPHABETS = [
    '0123456789',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    ''.join(chr(c) for c in range(32, 127)),
]

# Code 128 only: text that needs BOTH Code Set A and Code Set B, so the
# encoder's priority ORDER is observable.
#
# `c128_set_priority` puts B before A, and `c128_cost` takes the first entry on
# a tie, so swapping the two changes the symbol for data that could go either
# way — which needs a control character (forces A), a lower-case one (forces B)
# and characters from the 32..95 range both sets share.
#
# The hand-picked list and the four alphabets above between them produced not
# one such case, and a mutation sweep that swapped the order found 477 tests
# still green. 290 of 400 targeted cases differ under that swap.
AB_ALPHABET = (
    ''.join(chr(c) for c in range(1, 32))
    + ''.join(chr(c) for c in range(97, 123))
    + ''.join(chr(c) for c in range(32, 96))
)


def ab_fuzz(count, seed):
    """Strings that need both Code Set A and Code Set B."""
    random.seed(seed)
    out = []
    while len(out) < count:
        n = random.randint(2, 14)
        t = ''.join(random.choice(AB_ALPHABET) for _ in range(n))
        needs_a = any(not (ord(c) & 0x60) for c in t)
        needs_b = any((ord(c) & 0x60) == 0x60 for c in t)
        if needs_a and needs_b:
            out.append(t)
    return out


def fuzz(count, max_len, seed):
    random.seed(seed)
    out = []
    for _ in range(count):
        a = random.choice(ALPHABETS)
        n = random.randint(1, max_len)
        out.append(''.join(random.choice(a) for _ in range(n)))
    return out


def cases():
    for t in LINEAR:
        yield ('code39', 'L', t)
    for t in LINEAR + CODE128_ONLY:
        yield ('code128', 'L', t)
    for ecc in 'LMQH':
        for t in TWO_D:
            yield ('qr', ecc, t)
    for ecc in 'LMQ':
        for t in MICRO:
            yield ('microqr', ecc, t)
    for t in fuzz(60, 200, 7):
        yield ('qr', 'L', t)
        yield ('qr', 'H', t)
    for t in fuzz(40, 30, 11):
        yield ('microqr', 'L', t)
        yield ('microqr', 'M', t)
    for t in fuzz(30, 80, 13):
        yield ('code128', 'L', t)
    for t in ab_fuzz(60, 23):
        yield ('code128', 'L', t)
    for t in DMATRIX:
        yield ('datamatrix', 'L', t)
    for t in fuzz(60, 250, 17):
        yield ('datamatrix', 'L', t)


def main():
    out = []
    for kind, ecc, text in cases():
        r = subprocess.run([PROBE, kind, str(ECC_N[ecc]), text],
                           capture_output=True, text=True, check=True)
        lines = r.stdout.strip().split('\n')
        if lines[0].startswith('ERROR '):
            out.append({'kind': kind, 'ecc': ecc, 'text': text, 'error': lines[0][6:]})
            continue
        rows, width = map(int, lines[0].split())
        out.append({'kind': kind, 'ecc': ecc, 'text': text, 'rows': rows,
                    'width': width, 'grid': lines[1:1 + rows]})

    doc = {
        '_source': 'qa/probes/zint_probe, built from kicad-reference/thirdparty/zint',
        '_what': ("What KiCad's own vendored Zint produces for each case — the module grid, "
                  "or the error text `m_lastError` would show. Regenerate with "
                  "qa/probes/zint_probe/regenerate.py; never hand-edit."),
        'cases': out,
    }
    with open('qa/data/zint_vectors.json', 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'{len(out)} cases, {sum(1 for c in out if "error" in c)} of them errors')


if __name__ == '__main__':
    main()
