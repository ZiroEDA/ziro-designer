// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_IO_GEDA::getBuiltinSymbols()` (sch_io_geda.cpp): the standard gEDA symbol definitions
 * KiCad embeds from the geda-gaf project (GPL v2+), so an import works without a gEDA
 * installation. Generated from the C++ string literals, unedited.
 */

/** Symbol name -> .sym content (`std::map`: walk it sorted). */
export const GEDA_BUILTIN_SYMBOLS: ReadonlyMap<string, string> = new Map<string, string>([
  [
    'resistor-1.sym',
    'v 20031231 1\nL 600 200 500 0 3 0 0 0 -1 -1\nL 500 0 400 200 3 0 0 0 -1 -1\nL 400 200 300 0 3 0 0 0 -1 -1\nL 300 0 200 200 3 0 0 0 -1 -1\nT 300 400 5 10 0 0 0 0 1\ndevice=RESISTOR\nL 600 200 700 0 3 0 0 0 -1 -1\nL 700 0 750 100 3 0 0 0 -1 -1\nP 900 100 750 100 1 0 0\n{\nT 800 150 5 8 0 1 0 0 1\npinnumber=2\nT 800 150 5 8 0 0 0 0 1\npinseq=2\nT 800 150 5 8 0 1 0 0 1\npinlabel=2\nT 800 150 5 8 0 1 0 0 1\npintype=pas\n}\nP 0 100 152 100 1 0 0\n{\nT 100 150 5 8 0 1 0 0 1\npinnumber=1\nT 100 150 5 8 0 0 0 0 1\npinseq=1\nT 100 150 5 8 0 1 0 0 1\npinlabel=1\nT 100 150 5 8 0 1 0 0 1\npintype=pas\n}\nL 201 200 150 100 3 0 0 0 -1 -1\nT 200 300 8 10 1 1 0 0 1\nrefdes=R?\n',
  ],
  [
    'resistor-2.sym',
    'v 20031231 1\nB 200 0 600 200 3 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nT 300 400 5 10 0 0 0 0 1\ndevice=RESISTOR\nP 900 100 800 100 1 0 0\n{\nT 800 150 5 8 0 1 0 0 1\npinnumber=2\nT 800 150 5 8 0 0 0 0 1\npinseq=2\nT 800 150 5 8 0 1 0 0 1\npinlabel=2\nT 800 150 5 8 0 1 0 0 1\npintype=pas\n}\nP 0 100 200 100 1 0 0\n{\nT 100 150 5 8 0 1 0 0 1\npinnumber=1\nT 100 150 5 8 0 0 0 0 1\npinseq=1\nT 100 150 5 8 0 1 0 0 1\npinlabel=1\nT 100 150 5 8 0 1 0 0 1\npintype=pas\n}\nT 200 300 8 10 1 1 0 0 1\nrefdes=R?\n',
  ],
  [
    'capacitor-1.sym',
    'v 20050820 1\nP 0 200 200 200 1 0 0\n{\nT 150 250 5 8 0 1 0 6 1\npinnumber=1\nT 150 150 5 8 0 1 0 8 1\npinseq=1\nT 200 200 9 8 0 1 0 0 1\npinlabel=1\nT 200 200 5 8 0 1 0 2 1\npintype=pas\n}\nP 900 200 700 200 1 0 0\n{\nT 750 250 5 8 0 1 0 0 1\npinnumber=2\nT 750 150 5 8 0 1 0 2 1\npinseq=2\nT 700 200 9 8 0 1 0 6 1\npinlabel=2\nT 700 200 5 8 0 1 0 8 1\npintype=pas\n}\nL 400 400 400 0 3 0 0 0 -1 -1\nL 500 400 500 0 3 0 0 0 -1 -1\nL 700 200 500 200 3 0 0 0 -1 -1\nL 400 200 200 200 3 0 0 0 -1 -1\nT 200 700 5 10 0 0 0 0 1\ndevice=CAPACITOR\nT 200 500 8 10 1 1 0 0 1\nrefdes=C?\n',
  ],
  [
    'capacitor-2.sym',
    'v 20050820 1\nP 0 200 200 200 1 0 0\n{\nT 150 250 5 8 1 1 0 6 1\npinnumber=1\nT 200 150 5 8 0 1 0 8 1\npinseq=1\nT 250 200 9 8 0 1 0 0 1\npinlabel=+\nT 250 200 5 8 0 1 0 2 1\npintype=pas\n}\nP 900 200 700 200 1 0 0\n{\nT 750 250 5 8 1 1 0 0 1\npinnumber=2\nT 700 150 5 8 0 1 0 2 1\npinseq=2\nT 650 200 9 8 0 1 0 6 1\npinlabel=-\nT 650 200 5 8 0 1 0 8 1\npintype=pas\n}\nL 400 400 400 0 3 0 0 0 -1 -1\nA 1200 200 700 165 30 3 0 0 0 -1 -1\nL 700 200 500 200 3 0 0 0 -1 -1\nL 400 200 200 200 3 0 0 0 -1 -1\nL 289 400 289 300 3 0 0 0 -1 -1\nL 340 349 240 349 3 0 0 0 -1 -1\nT 200 700 5 10 0 0 0 0 1\ndevice=POLARIZED_CAPACITOR\nT 200 500 8 10 1 1 0 0 1\nrefdes=C?\n',
  ],
  [
    'gnd-1.sym',
    'v 20031231 1\nP 100 100 100 300 1 0 1\n{\nT 158 161 5 4 0 1 0 0 1\npinnumber=1\nT 158 161 5 4 0 0 0 0 1\npinseq=1\nT 158 161 5 4 0 1 0 0 1\npinlabel=1\nT 158 161 5 4 0 1 0 0 1\npintype=pwr\n}\nL 0 100 200 100 3 0 0 0 -1 -1\nL 55 50 145 50 3 0 0 0 -1 -1\nL 80 10 120 10 3 0 0 0 -1 -1\nT 300 50 8 10 0 0 0 0 1\nnet=GND:1\n',
  ],
  [
    'generic-power.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 200 250 8 10 1 1 0 3 1\nnet=Vcc:1\n',
  ],
  [
    'input-1.sym',
    'v 20031231 1\nP 600 100 800 100 1 0 1\n{\nT 450 50 5 6 0 1 0 0 1\npinnumber=1\nT 450 50 5 6 0 0 0 0 1\npinseq=1\n}\nL 0 200 0 0 3 0 0 0 -1 -1\nL 0 200 500 200 3 0 0 0 -1 -1\nL 500 200 600 100 3 0 0 0 -1 -1\nL 600 100 500 0 3 0 0 0 -1 -1\nL 500 0 0 0 3 0 0 0 -1 -1\nT 0 300 5 10 0 0 0 0 1\ndevice=INPUT\n',
  ],
  [
    'output-1.sym',
    'v 20031231 1\nP 0 100 200 100 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\n}\nL 200 200 200 0 3 0 0 0 -1 -1\nL 200 200 700 200 3 0 0 0 -1 -1\nL 700 200 800 100 3 0 0 0 -1 -1\nL 800 100 700 0 3 0 0 0 -1 -1\nL 700 0 200 0 3 0 0 0 -1 -1\nT 100 300 5 10 0 0 0 0 1\ndevice=OUTPUT\n',
  ],
  [
    'nc-right-1.sym',
    'v 20060123 1\nP 0 100 200 100 1 0 0\n{\nT 600 100 5 10 0 0 180 8 1\npinseq=1\nT 600 300 5 10 0 0 180 8 1\npinnumber=1\n}\nL 200 0 200 200 3 0 0 0 -1 -1\nT 100 500 8 10 0 0 0 0 1\nvalue=NoConnection\nT 250 100 9 10 1 0 0 1 1\nNC\nT 0 600 8 10 0 0 0 0 1\ndevice=DRC_Directive\nT 100 900 8 10 0 0 0 0 1\ngraphical=1\n',
  ],
  [
    'nc-left-1.sym',
    'v 20060123 1\nP 400 100 200 100 1 0 1\n{\nT 0 100 5 10 0 0 0 0 1\npinseq=1\nT 0 300 5 10 0 0 0 0 1\npinnumber=1\n}\nL 200 0 200 200 3 0 0 0 -1 -1\nT 100 500 8 10 0 0 0 0 1\nvalue=NoConnection\nT 50 100 9 10 1 0 0 5 1\nNC\nT 0 600 8 10 0 0 0 0 1\ndevice=DRC_Directive\nT 100 900 8 10 0 0 0 0 1\ngraphical=1\n',
  ],
  [
    'terminal-1.sym',
    'v 20041228 1\nT 310 750 8 10 0 0 0 0 1\ndevice=terminal\nP 560 100 900 100 1 0 1\n{\nT 660 150 5 10 0 0 0 0 1\npinseq=1\nT 510 100 5 10 0 1 0 0 1\npinnumber=1\nT 510 300 5 10 0 1 0 0 1\npintype=pas\nT 800 100 5 10 0 1 0 0 1\npinlabel=terminal\n}\nV 460 100 100 3 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nT 250 50 8 10 1 1 0 6 1\nrefdes=T?\n',
  ],
  [
    'vcc-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\nVcc\nT 450 200 8 10 0 0 0 0 1\nnet=Vcc:1\n',
  ],
  [
    'vdd-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\nVdd\nT 450 200 8 10 0 0 0 0 1\nnet=Vdd:1\n',
  ],
  [
    '5V-plus-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\n+5V\nT 300 0 8 8 0 0 0 0 1\nnet=+5V:1\n',
  ],
  [
    '3.3V-plus-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\n+3.3V\nT 300 0 8 8 0 0 0 0 1\nnet=+3.3V:1\n',
  ],
  [
    '12V-plus-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\n+12V\nT 300 0 9 8 0 0 0 0 1\nnet=+12V:1\n',
  ],
  [
    'vcc-2.sym',
    'v 20031231 1\nV 200 350 50 3 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nP 200 300 200 0 1 0 1\n{\nT 300 50 5 10 0 1 0 0 1\npinnumber=1\nT 300 50 5 10 0 0 0 0 1\npinseq=1\nT 300 50 5 10 0 1 0 0 1\npinlabel=1\nT 300 50 5 10 0 1 0 0 1\npintype=pwr\n}\nT 0 450 9 10 1 0 0 0 1\nVcc\nT 400 300 8 8 0 0 0 0 1\nnet=Vcc:1\n',
  ],
  [
    'vss-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\nVss\nT 450 200 8 10 0 0 0 0 1\nnet=Vss:1\n',
  ],
  [
    'vee-1.sym',
    'v 20031231 1\nP 200 0 200 200 1 0 0\n{\nT 250 50 5 6 0 1 0 0 1\npinnumber=1\nT 250 50 5 6 0 0 0 0 1\npinseq=1\nT 250 50 5 6 0 1 0 0 1\npinlabel=1\nT 250 50 5 6 0 1 0 0 1\npintype=pwr\n}\nL 50 200 350 200 3 0 0 0 -1 -1\nT 75 250 9 8 1 0 0 0 1\nVee\nT 450 200 8 10 0 0 0 0 1\nnet=Vee:1\n',
  ],
  [
    'gnd-2.sym',
    'v 20031231 1\nP 100 100 100 300 1 0 1\n{\nT 158 161 5 4 0 1 0 0 1\npinnumber=1\nT 158 161 5 4 0 0 0 0 1\npinseq=1\nT 300 200 3 10 1 1 0 0 1\npinlabel=PGND\nT 158 161 5 4 0 1 0 0 1\npintype=pwr\n}\nL 0 100 200 100 3 0 0 0 -1 -1\nL 55 50 145 50 3 0 0 0 -1 -1\nL 80 10 120 10 3 0 0 0 -1 -1\nT 300 50 8 10 0 0 0 0 1\nnet=PGND:1\n',
  ],
  [
    'diode-1.sym',
    'v 20031231 1\nL 300 400 300 0 3 0 0 0 -1 -1\nL 300 400 600 200 3 0 0 0 -1 -1\nT 400 600 5 10 0 0 0 0 1\ndevice=DIODE\nL 600 200 300 0 3 0 0 0 -1 -1\nL 600 400 600 0 3 0 0 0 -1 -1\nP 0 200 200 200 1 0 0\n{\nT 100 250 5 8 0 1 0 0 1\npinnumber=1\nT 100 250 5 8 0 0 0 0 1\npinseq=1\nT 100 250 5 8 0 1 0 0 1\npinlabel=1\nT 100 250 5 8 0 1 0 0 1\npintype=pas\n}\nP 900 200 700 200 1 0 0\n{\nT 700 250 5 8 0 1 0 0 1\npinnumber=2\nT 700 250 5 8 0 0 0 0 1\npinseq=2\nT 700 250 5 8 0 1 0 0 1\npinlabel=2\nT 700 250 5 8 0 1 0 0 1\npintype=pas\n}\nL 700 200 600 200 3 0 0 0 -1 -1\nL 300 200 200 200 3 0 0 0 -1 -1\nT 300 500 8 10 1 1 0 0 1\nrefdes=D?\n',
  ],
  [
    'zener-1.sym',
    'v 20031231 1\nL 300 400 300 0 3 0 0 0 -1 -1\nL 600 200 300 0 3 0 0 0 -1 -1\nL 600 200 300 400 3 0 0 0 -1 -1\nT 400 600 5 10 0 0 0 0 1\ndevice=ZENER_DIODE\nL 600 400 600 0 3 0 0 0 -1 -1\nP 900 200 700 200 1 0 0\n{\nT 700 250 5 8 0 1 0 0 1\npinnumber=2\nT 700 250 5 8 0 0 0 0 1\npinseq=2\nT 700 250 5 8 0 1 0 0 1\npinlabel=2\nT 700 250 5 8 0 1 0 0 1\npintype=pas\n}\nP 200 200 0 200 1 0 1\n{\nT 100 250 5 8 0 1 0 0 1\npinnumber=1\nT 100 250 5 8 0 0 0 0 1\npinseq=1\nT 100 250 5 8 0 1 0 0 1\npinlabel=1\nT 100 250 5 8 0 1 0 0 1\npintype=pas\n}\nL 700 200 600 200 3 0 0 0 -1 -1\nL 300 200 200 200 3 0 0 0 -1 -1\nL 600 400 500 400 3 0 0 0 -1 -1\nL 600 0 700 0 3 0 0 0 -1 -1\nT 300 500 8 10 1 1 0 0 1\nrefdes=Z?\n',
  ],
  [
    'schottky-1.sym',
    'v 20041228 1\nL 300 400 300 0 3 0 0 0 -1 -1\nL 300 400 600 200 3 0 0 0 -1 -1\nT 322 672 8 10 0 0 0 0 1\ndevice=DIODE\nL 600 200 300 0 3 0 0 0 -1 -1\nL 600 400 600 0 3 0 0 0 -1 -1\nP 0 200 200 200 1 0 0\n{\nT 205 256 5 8 0 1 0 0 1\npinnumber=2\nT 170 286 5 8 0 0 90 0 1\npinseq=2\nT -10 81 5 10 0 1 0 0 1\npintype=pas\nT 75 288 5 10 0 1 90 0 1\npinlabel=anode\n}\nP 900 200 700 200 1 0 0\n{\nT 700 250 5 8 0 1 0 0 1\npinnumber=1\nT 730 50 5 8 0 0 0 0 1\npinseq=1\nT 798 265 5 10 0 1 0 0 1\npintype=pas\nT 931 138 5 10 0 1 0 0 1\npinlabel=cathode\n}\nL 700 200 600 200 3 0 0 0 -1 -1\nL 300 200 200 200 3 0 0 0 -1 -1\nA 650 400 50 0 180 3 0 0 0 -1 -1\nA 550 0 50 180 180 3 0 0 0 -1 -1\nT 300 500 8 10 1 1 0 0 1\nrefdes=D?\nT 567 515 8 10 0 0 0 0 1\nnumslots=0\n',
  ],
  [
    'led-1.sym',
    'v 20210407 2\nP 0 200 200 200 1 0 0\n{\nT 150 250 5 8 1 1 0 6 1\npinnumber=1\nT 150 150 5 8 0 1 0 8 1\npinseq=1\nT 250 200 9 8 0 1 0 0 1\npinlabel=A\nT 250 200 5 8 0 1 0 2 1\npintype=pas\n}\nP 900 200 700 200 1 0 0\n{\nT 750 250 5 8 1 1 0 0 1\npinnumber=2\nT 750 150 5 8 0 1 0 2 1\npinseq=2\nT 650 200 9 8 0 1 0 6 1\npinlabel=K\nT 650 200 5 8 0 1 0 8 1\npintype=pas\n}\nL 400 300 500 200 3 0 0 0 -1 -1\nL 500 200 400 100 3 0 0 0 -1 -1\nL 400 300 400 100 3 0 0 0 -1 -1\nL 500 300 500 100 3 0 0 0 -1 -1\nL 500 200 700 200 3 0 0 0 -1 -1\nL 400 200 200 200 3 0 0 0 -1 -1\nV 450 200 200 3 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nT 800 600 5 10 0 0 0 0 1\ndevice=LED\nT 800 400 8 10 1 1 0 0 1\nrefdes=LED?\nT 800 1000 5 10 0 0 0 0 1\nnumslots=0\nT 800 800 5 10 0 0 0 0 1\nsymversion=0.2\n',
  ],
  [
    'npn-1.sym',
    'v 20210407 2\nL 200 800 200 200 3 0 0 0 -1 -1\nT 600 500 5 10 0 0 0 0 1\ndevice=NPN_TRANSISTOR\nL 500 800 200 500 3 0 0 0 -1 -1\nL 200 500 500 200 3 0 0 0 -1 -1\nH 3 0 0 0 -1 -1 1 -1 -1 -1 -1 -1 5\nM 410,240\nL 501,200\nL 455,295\nL 435,265\nz\nP 0 500 200 500 1 0 0\n{\nT 100 550 5 6 1 1 0 0 1\npinnumber=B\nT 100 550 5 6 0 0 0 0 1\npinseq=2\nT 100 550 5 6 0 1 0 0 1\npinlabel=B\nT 100 550 5 6 0 1 0 0 1\npintype=pas\n}\nP 500 1000 500 800 1 0 0\n{\nT 400 850 5 6 1 1 0 0 1\npinnumber=C\nT 400 850 5 6 0 0 0 0 1\npinseq=1\nT 400 850 5 6 0 1 0 0 1\npinlabel=C\nT 400 850 5 6 0 1 0 0 1\npintype=pas\n}\nP 500 200 500 0 1 0 1\n{\nT 400 50 5 6 1 1 0 0 1\npinnumber=E\nT 400 50 5 6 0 0 0 0 1\npinseq=3\nT 400 50 5 6 0 1 0 0 1\npinlabel=E\nT 400 50 5 6 0 1 0 0 1\npintype=pas\n}\nT 600 500 8 10 1 1 0 0 1\nrefdes=Q?\n',
  ],
  [
    'pnp-1.sym',
    'v 20210407 2\nL 200 800 200 200 3 0 0 0 -1 -1\nT 600 500 5 10 0 0 0 0 1\ndevice=PNP_TRANSISTOR\nL 500 800 200 500 3 0 0 0 -1 -1\nL 200 500 500 200 3 0 0 0 -1 -1\nP 0 500 200 500 1 0 0\n{\nT 100 550 5 6 1 1 0 0 1\npinnumber=B\nT 100 550 5 6 0 0 0 0 1\npinseq=2\nT 100 550 5 6 0 1 0 0 1\npinlabel=B\nT 100 550 5 6 0 1 0 0 1\npintype=pas\n}\nP 500 1000 500 800 1 0 0\n{\nT 400 850 5 6 1 1 0 0 1\npinnumber=C\nT 400 850 5 6 0 0 0 0 1\npinseq=1\nT 400 850 5 6 0 1 0 0 1\npinlabel=C\nT 400 850 5 6 0 1 0 0 1\npintype=pas\n}\nP 500 200 500 0 1 0 1\n{\nT 400 50 5 6 1 1 0 0 1\npinnumber=E\nT 400 50 5 6 0 0 0 0 1\npinseq=3\nT 400 50 5 6 0 1 0 0 1\npinlabel=E\nT 400 50 5 6 0 1 0 0 1\npintype=pas\n}\nT 600 500 8 10 1 1 0 0 1\nrefdes=Q?\nH 3 0 0 0 -1 -1 1 -1 -1 -1 -1 -1 5\nM 340,290\nL 300,401\nL 395,355\nL 365,335\nz\n',
  ],
  [
    'nmos-1.sym',
    'v 20210407 2\nL 300 600 300 200 3 0 0 0 -1 -1\nT 700 800 5 10 0 0 0 0 1\ndevice=NMOS_TRANSISTOR\nL 200 600 200 200 3 0 0 0 -1 -1\nL 300 600 500 600 3 0 0 0 -1 -1\nL 300 200 500 200 3 0 0 0 -1 -1\nL 300 400 500 400 3 0 0 0 -1 -1\nL 300 400 400 500 3 0 0 0 -1 -1\nL 300 400 400 300 3 0 0 0 -1 -1\nP 0 400 200 400 1 0 0\n{\nT 150 450 5 8 0 1 0 6 1\npinnumber=G\nT 150 350 5 8 0 1 0 8 1\npinseq=2\nT 200 400 9 8 0 1 0 0 1\npinlabel=G\nT 200 400 5 8 0 1 0 2 1\npintype=in\n}\nP 500 600 500 800 1 0 1\n{\nT 550 650 5 8 0 1 0 0 1\npinnumber=D\nT 550 650 5 8 0 1 0 2 1\npinseq=1\nT 500 600 9 8 0 1 0 5 1\npinlabel=D\nT 500 400 5 8 0 1 0 5 1\npintype=pas\n}\nP 500 200 500 0 1 0 1\n{\nT 550 50 5 8 0 1 0 0 1\npinnumber=S\nT 550 50 5 8 0 1 0 2 1\npinseq=3\nT 500 200 9 8 0 1 0 3 1\npinlabel=S\nT 500 500 5 8 0 1 0 3 1\npintype=pas\n}\nT 700 600 8 10 1 1 0 0 1\nrefdes=Q?\nT 700 1000 5 10 0 0 0 0 1\nsymversion=0.2\n',
  ],
  [
    'pmos-1.sym',
    'v 20210407 2\nL 300 600 300 200 3 0 0 0 -1 -1\nT 600 200 5 10 0 0 0 0 1\ndevice=PMOS_TRANSISTOR\nL 200 600 200 200 3 0 0 0 -1 -1\nL 300 600 500 600 3 0 0 0 -1 -1\nL 300 200 500 200 3 0 0 0 -1 -1\nL 300 400 500 400 3 0 0 0 -1 -1\nL 500 400 400 300 3 0 0 0 -1 -1\nL 500 400 400 500 3 0 0 0 -1 -1\nP 500 600 500 800 1 0 1\n{\nT 300 700 5 10 0 1 0 0 1\npinnumber=D\nT 300 700 5 10 0 0 0 0 1\npinseq=1\nT 300 700 5 10 0 1 0 0 1\npinlabel=D\nT 300 700 5 10 0 1 0 0 1\npintype=pas\n}\nP 500 200 500 0 1 0 1\n{\nT 300 0 5 10 0 1 0 0 1\npinnumber=S\nT 300 0 5 10 0 0 0 0 1\npinseq=3\nT 300 0 5 10 0 1 0 0 1\npinlabel=S\nT 300 0 5 10 0 1 0 0 1\npintype=pas\n}\nP 200 400 0 400 1 0 1\n{\nT 0 500 5 10 0 1 0 0 1\npinnumber=G\nT 0 500 5 10 0 0 0 0 1\npinseq=2\nT 0 500 5 10 0 1 0 0 1\npinlabel=G\nT 0 500 5 10 0 1 0 0 1\npintype=pas\n}\nT 700 600 8 10 1 1 0 0 1\nrefdes=Q?\nT 1200 500 8 10 0 0 0 0 1\nsymversion=0.1\n',
  ],
  [
    'opamp-1.sym',
    'v 20050820 1\nL 200 800 200 0 3 0 0 0 -1 -1\nL 200 800 800 400 3 0 0 0 -1 -1\nT 700 800 5 10 0 0 0 0 1\ndevice=OPAMP\nL 800 400 200 0 3 0 0 0 -1 -1\nL 300 650 300 550 3 0 0 0 -1 -1\nL 250 600 350 600 3 0 0 0 -1 -1\nL 250 200 350 200 3 0 0 0 -1 -1\nP 0 600 200 600 1 0 0\n{\nT 150 650 5 8 1 1 0 6 1\npinnumber=1\nT 150 550 5 8 0 1 0 8 1\npinseq=1\nT 250 600 9 8 0 1 0 0 1\npinlabel=in+\nT 250 600 5 8 0 1 0 2 1\npintype=in\n}\nP 0 200 200 200 1 0 0\n{\nT 150 250 5 8 1 1 0 6 1\npinnumber=2\nT 150 150 5 8 0 1 0 8 1\npinseq=2\nT 250 200 9 8 0 1 0 0 1\npinlabel=in-\nT 250 200 5 8 0 1 0 2 1\npintype=in\n}\nP 800 400 1000 400 1 0 1\n{\nT 800 450 5 8 1 1 0 0 1\npinnumber=5\nT 800 350 5 8 0 1 0 2 1\npinseq=5\nT 750 400 9 8 0 1 0 6 1\npinlabel=out\nT 750 400 5 8 0 1 0 8 1\npintype=out\n}\nP 500 600 500 800 1 0 1\n{\nT 550 600 5 8 1 1 0 0 1\npinnumber=3\nT 550 600 5 8 0 1 0 2 1\npinseq=3\nT 500 600 9 8 0 1 0 5 1\npinlabel=V+\nT 500 550 5 8 0 1 0 5 1\npintype=pwr\n}\nP 500 200 500 0 1 0 1\n{\nT 550 100 5 8 1 1 0 0 1\npinnumber=4\nT 550 100 5 8 0 1 0 2 1\npinseq=4\nT 500 200 9 8 0 1 0 3 1\npinlabel=V-\nT 500 300 5 8 0 1 0 3 1\npintype=pwr\n}\nT 700 600 8 10 1 1 0 0 1\nrefdes=U?\nT 700 1000 5 10 0 0 0 0 1\nnumslots=0\nT 700 1400 5 10 0 0 0 0 1\nsymversion=0.1\n',
  ],
  [
    'inductor-1.sym',
    'v 20210407 2\nP 900 100 750 100 1 0 0\n{\nT 800 150 5 8 0 1 0 0 1\npinnumber=2\nT 800 50 5 8 0 1 0 2 1\npinseq=2\nT 700 100 9 8 0 1 0 6 1\npinlabel=2\nT 700 100 5 8 0 1 0 8 1\npintype=pas\n}\nP 0 100 150 100 1 0 0\n{\nT 100 150 5 8 0 1 0 6 1\npinnumber=1\nT 100 50 5 8 0 1 0 8 1\npinseq=1\nT 200 100 9 8 0 1 0 0 1\npinlabel=1\nT 200 100 5 8 0 1 0 2 1\npintype=pas\n}\nA 237 100 75 0 180 3 0 0 0 -1 -1\nA 379 100 75 0 180 3 0 0 0 -1 -1\nA 521 100 75 0 180 3 0 0 0 -1 -1\nA 663 100 75 0 180 3 0 0 0 -1 -1\nT 200 500 5 10 0 0 0 0 1\ndevice=INDUCTOR\nT 200 300 8 10 1 1 0 0 1\nrefdes=L?\nT 200 700 5 10 0 0 0 0 1\nsymversion=0.2\n',
  ],
  [
    '7400-1.sym',
    'v 20031231 1\nL 300 200 300 800 3 0 0 0 -1 -1\nT 300 0 9 8 1 0 0 0 1\n7400\nL 300 800 700 800 3 0 0 0 -1 -1\nT 500 900 5 10 0 0 0 0 1\ndevice=7400\nT 500 1100 5 10 0 0 0 0 1\nslot=1\nT 500 1300 5 10 0 0 0 0 1\nnumslots=4\nT 500 1500 5 10 0 0 0 0 1\nslotdef=1:1,2,3\nT 500 1700 5 10 0 0 0 0 1\nslotdef=2:4,5,6\nT 500 1900 5 10 0 0 0 0 1\nslotdef=3:9,10,8\nT 500 2100 5 10 0 0 0 0 1\nslotdef=4:12,13,11\nL 300 200 700 200 3 0 0 0 -1 -1\nA 700 500 300 270 180 3 0 0 0 -1 -1\nV 1050 500 50 6 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nP 1100 500 1300 500 1 0 1\n{\nT 1100 550 5 8 1 1 0 0 1\npinnumber=3\nT 1100 450 5 8 0 1 0 2 1\npinseq=3\nT 950 500 9 8 0 1 0 6 1\npinlabel=Y\nT 950 500 5 8 0 1 0 8 1\npintype=out\n}\nP 300 300 0 300 1 0 1\n{\nT 200 350 5 8 1 1 0 6 1\npinnumber=2\nT 200 250 5 8 0 1 0 8 1\npinseq=2\nT 350 300 9 8 0 1 0 0 1\npinlabel=B\nT 350 300 5 8 0 1 0 2 1\npintype=in\n}\nP 300 700 0 700 1 0 1\n{\nT 200 750 5 8 1 1 0 6 1\npinnumber=1\nT 200 650 5 8 0 1 0 8 1\npinseq=1\nT 350 700 9 8 0 1 0 0 1\npinlabel=A\nT 350 700 5 8 0 1 0 2 1\npintype=in\n}\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 500 2850 5 10 0 0 0 0 1\nnet=Vcc:14\nT 500 3050 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    '7404-1.sym',
    'v 20031231 1\nL 300 800 800 500 3 0 0 0 -1 -1\nT 600 900 5 10 0 0 0 0 1\ndevice=7404\nT 600 1100 5 10 0 0 0 0 1\nslot=1\nT 600 1300 5 10 0 0 0 0 1\nnumslots=6\nT 600 1500 5 10 0 0 0 0 1\nslotdef=1:1,2\nT 600 1700 5 10 0 0 0 0 1\nslotdef=2:3,4\nT 600 1900 5 10 0 0 0 0 1\nslotdef=3:5,6\nT 600 2100 5 10 0 0 0 0 1\nslotdef=4:9,8\nT 600 2300 5 10 0 0 0 0 1\nslotdef=5:11,10\nT 600 2500 5 10 0 0 0 0 1\nslotdef=6:13,12\nL 800 500 300 200 3 0 0 0 -1 -1\nL 300 800 300 200 3 0 0 0 -1 -1\nV 850 500 50 6 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nP 300 500 0 500 1 0 1\n{\nT 200 550 5 8 1 1 0 6 1\npinnumber=1\nT 200 450 5 8 0 1 0 8 1\npinseq=1\nT 350 500 9 8 0 1 0 0 1\npinlabel=A\nT 350 500 5 8 0 1 0 2 1\npintype=in\n}\nP 1100 500 900 500 1 0 0\n{\nT 900 550 5 8 1 1 0 0 1\npinnumber=2\nT 900 450 5 8 0 1 0 2 1\npinseq=2\nT 750 500 9 8 0 1 0 6 1\npinlabel=Y\nT 750 500 5 8 0 1 0 8 1\npintype=out\n}\nT 300 0 9 8 1 0 0 0 1\n7404\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 600 3100 5 10 0 0 0 0 1\nnet=Vcc:14\nT 600 3300 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    '7408-1.sym',
    'v 20031231 1\nL 300 200 300 800 3 0 0 0 -1 -1\nT 300 0 9 8 1 0 0 0 1\n7408\nL 300 800 700 800 3 0 0 0 -1 -1\nT 700 900 5 10 0 0 0 0 1\ndevice=7408\nT 700 1100 5 10 0 0 0 0 1\nslot=1\nT 700 1300 5 10 0 0 0 0 1\nnumslots=4\nT 700 1500 5 10 0 0 0 0 1\nslotdef=1:1,2,3\nT 700 1700 5 10 0 0 0 0 1\nslotdef=2:4,5,6\nT 700 1900 5 10 0 0 0 0 1\nslotdef=3:9,10,8\nT 700 2100 5 10 0 0 0 0 1\nslotdef=4:12,13,11\nL 300 200 700 200 3 0 0 0 -1 -1\nA 700 500 300 270 180 3 0 0 0 -1 -1\nP 1000 500 1300 500 1 0 1\n{\nT 1100 550 5 8 1 1 0 0 1\npinnumber=3\nT 1100 450 5 8 0 1 0 2 1\npinseq=3\nT 950 500 9 8 0 1 0 6 1\npinlabel=Y\nT 950 500 5 8 0 1 0 8 1\npintype=out\n}\nP 300 700 0 700 1 0 1\n{\nT 200 750 5 8 1 1 0 6 1\npinnumber=1\nT 200 650 5 8 0 1 0 8 1\npinseq=1\nT 350 700 9 8 0 1 0 0 1\npinlabel=A\nT 350 700 5 8 0 1 0 2 1\npintype=in\n}\nP 300 300 0 300 1 0 1\n{\nT 200 350 5 8 1 1 0 6 1\npinnumber=2\nT 200 250 5 8 0 1 0 8 1\npinseq=2\nT 350 300 9 8 0 1 0 0 1\npinlabel=B\nT 350 300 5 8 0 1 0 2 1\npintype=in\n}\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 700 2700 5 10 0 0 0 0 1\nnet=Vcc:14\nT 700 2900 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    '7432-1.sym',
    'v 20031231 1\nL 260 200 600 200 3 0 0 0 -1 -1\nL 260 800 600 800 3 0 0 0 -1 -1\nT 600 900 5 10 0 0 0 0 1\ndevice=7432\nT 600 1100 5 10 0 0 0 0 1\nslot=1\nT 600 1300 5 10 0 0 0 0 1\nnumslots=4\nT 600 1500 5 10 0 0 0 0 1\nslotdef=1:1,2,3\nT 600 1700 5 10 0 0 0 0 1\nslotdef=2:4,5,6\nT 600 1900 5 10 0 0 0 0 1\nslotdef=3:9,10,8\nT 600 2100 5 10 0 0 0 0 1\nslotdef=4:12,13,11\nT 300 0 9 8 1 0 0 0 1\n7432\nA 0 500 400 312 97 3 0 0 0 -1 -1\nP 300 700 0 700 1 0 1\n{\nT 200 750 5 8 1 1 0 6 1\npinnumber=1\nT 200 650 5 8 0 1 0 8 1\npinseq=1\nT 350 700 9 8 0 1 0 0 1\npinlabel=A\nT 350 700 5 8 0 1 0 2 1\npintype=in\n}\nP 300 300 0 300 1 0 1\n{\nT 200 350 5 8 1 1 0 6 1\npinnumber=2\nT 200 250 5 8 0 1 0 8 1\npinseq=2\nT 350 300 9 8 0 1 0 0 1\npinlabel=B\nT 350 300 5 8 0 1 0 2 1\npintype=in\n}\nP 1300 500 988 500 1 0 0\n{\nT 1100 550 5 8 1 1 0 0 1\npinnumber=3\nT 1100 450 5 8 0 1 0 2 1\npinseq=3\nT 950 500 9 8 0 1 0 6 1\npinlabel=Y\nT 950 500 5 8 0 1 0 8 1\npintype=out\n}\nA 600 600 400 270 76 3 0 0 0 -1 -1\nA 600 400 400 14 76 3 0 0 0 -1 -1\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 600 2700 5 10 0 0 0 0 1\nnet=Vcc:14\nT 600 2900 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    '7486-1.sym',
    'v 20031231 1\nL 260 200 600 200 3 0 0 0 -1 -1\nL 260 800 600 800 3 0 0 0 -1 -1\nT 700 900 5 10 0 0 0 0 1\ndevice=7486\nT 700 1100 5 10 0 0 0 0 1\nslot=1\nT 700 1300 5 10 0 0 0 0 1\nnumslots=4\nT 700 1500 5 10 0 0 0 0 1\nslotdef=1:1,2,3\nT 700 1700 5 10 0 0 0 0 1\nslotdef=2:4,5,6\nT 700 1900 5 10 0 0 0 0 1\nslotdef=3:9,10,8\nT 700 2100 5 10 0 0 0 0 1\nslotdef=4:12,13,11\nA 0 500 400 312 97 3 0 0 0 -1 -1\nA -100 500 400 312 97 3 0 0 0 -1 -1\nP 300 700 0 700 1 0 1\n{\nT 150 750 5 8 1 1 0 6 1\npinnumber=1\nT 150 650 5 8 0 1 0 8 1\npinseq=1\nT 350 700 9 8 0 1 0 0 1\npinlabel=A\nT 350 700 5 8 0 1 0 2 1\npintype=in\n}\nP 300 300 0 300 1 0 1\n{\nT 150 350 5 8 1 1 0 6 1\npinnumber=2\nT 150 250 5 8 0 1 0 8 1\npinseq=2\nT 350 300 9 8 0 1 0 0 1\npinlabel=B\nT 350 300 5 8 0 1 0 2 1\npintype=in\n}\nP 988 500 1300 500 1 0 1\n{\nT 1100 550 5 8 1 1 0 0 1\npinnumber=3\nT 1100 450 5 8 0 1 0 2 1\npinseq=3\nT 950 500 9 8 0 1 0 6 1\npinlabel=Y\nT 950 500 5 8 0 1 0 8 1\npintype=out\n}\nA 600 600 400 270 76 3 0 0 0 -1 -1\nA 600 400 400 14 76 3 0 0 0 -1 -1\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 300 0 9 8 1 0 0 0 1\n7486\nT 700 2700 5 10 0 0 0 0 1\nnet=Vcc:14\nT 700 2900 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    '7402-1.sym',
    'v 20031231 1\nL 260 200 600 200 3 0 0 0 -1 -1\nL 260 800 600 800 3 0 0 0 -1 -1\nT 600 900 5 10 0 0 0 0 1\ndevice=7402\nT 600 1100 5 10 0 0 0 0 1\nslot=1\nT 600 1300 5 10 0 0 0 0 1\nnumslots=4\nT 600 1500 5 10 0 0 0 0 1\nslotdef=1:1,2,3\nT 600 1700 5 10 0 0 0 0 1\nslotdef=2:4,5,6\nT 600 1900 5 10 0 0 0 0 1\nslotdef=3:10,8,9\nT 600 2100 5 10 0 0 0 0 1\nslotdef=4:13,11,12\nT 300 0 9 8 1 0 0 0 1\n7402\nA 0 500 400 312 97 3 0 0 0 -1 -1\nP 300 700 0 700 1 0 1\n{\nT 200 750 5 8 1 1 0 6 1\npinnumber=3\nT 200 650 5 8 0 1 0 8 1\npinseq=3\nT 350 700 9 8 0 1 0 0 1\npinlabel=B\nT 350 700 5 8 0 1 0 2 1\npintype=in\n}\nP 300 300 0 300 1 0 1\n{\nT 200 350 5 8 1 1 0 6 1\npinnumber=2\nT 200 250 5 8 0 1 0 8 1\npinseq=2\nT 350 300 9 8 0 1 0 0 1\npinlabel=A\nT 350 300 5 8 0 1 0 2 1\npintype=in\n}\nV 1038 500 50 6 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nP 1300 500 1088 500 1 0 0\n{\nT 1100 550 5 8 1 1 0 0 1\npinnumber=1\nT 1100 450 5 8 0 1 0 2 1\npinseq=1\nT 950 500 9 8 0 1 0 6 1\npinlabel=Y\nT 950 500 5 8 0 1 0 8 1\npintype=out\n}\nA 600 600 400 270 76 3 0 0 0 -1 -1\nA 600 400 400 14 76 3 0 0 0 -1 -1\nT 300 900 8 10 1 1 0 0 1\nrefdes=U?\nT 600 2700 5 10 0 0 0 0 1\nnet=Vcc:14\nT 600 2900 5 10 0 0 0 0 1\nnet=GND:7\n',
  ],
  [
    'busripper-1.sym',
    'v 20031231 1\nT 0 400 5 8 0 0 0 0 1\ndevice=none\nP 0 0 100 100 1 0 0\n{\nT 0 500 5 8 0 0 0 0 1\npinseq=1\nT 0 600 5 8 0 0 0 0 1\npinnumber=1\nT 0 700 5 8 0 0 0 0 1\npintype=pas\nT 0 800 5 8 0 0 0 0 1\npinlabel=netside\n}\nT 0 300 5 8 0 0 0 0 1\ngraphical=1\nL 200 200 100 100 10 30 0 0 -1 -1\n',
  ],
  [
    'busripper-2.sym',
    'v 20031231 1\nT 0 400 5 8 0 0 0 0 1\ndevice=none\nP 0 0 0 100 1 0 0\n{\nT 0 500 5 8 0 0 0 0 1\npinseq=1\nT 0 600 5 8 0 0 0 0 1\npinnumber=1\nT 0 700 5 8 0 0 0 0 1\npintype=pas\nT 0 800 5 8 0 0 0 0 1\npinlabel=netside\n}\nT 0 300 5 8 0 0 0 0 1\ngraphical=1\nL 0 100 100 200 3 0 0 0 -1 -1\nL 0 100 -100 200 3 0 0 0 -1 -1\n',
  ],
  [
    'title-B.sym',
    'v 20031231 1\nB 0 0 17000 11000 15 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nT 14400 1500 5 10 0 0 0 0 1\ngraphical=1\nL 12900 600 12900 0 15 0 0 0 -1 -1\nT 9500 400 15 8 1 0 0 0 1\nFILE:\nT 13000 400 15 8 1 0 0 0 1\nREVISION:\nT 13000 100 15 8 1 0 0 0 1\nDRAWN BY:\nT 9500 100 15 8 1 0 0 0 1\nPAGE\nT 11200 100 15 8 1 0 0 0 1\nOF\nT 9500 700 15 8 1 0 0 0 1\nTITLE\nB 9400 0 7600 1400 15 0 0 0 -1 -1 0 -1 -1 -1 -1 -1\nL 9400 600 17000 600 15 0 0 0 -1 -1\n',
  ],
]);
