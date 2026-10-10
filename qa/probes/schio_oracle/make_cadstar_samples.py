#!/usr/bin/env python3
"""make_cadstar_samples.py <outdir>: two CADSTAR Schematic Archives (.csa) for the import oracle.

KiCad ships no importable .csa (qa/data/eeschema/io/cadstar holds a parser fragment), so these
are written by hand to the grammar cadstar_sch_archive_parser.cpp reads. Whatever eeschema
10.0.6 makes of them is the expectation; a file it rejects is not a test.

  basic.csa       one sheet: two-pin parts placed plain, rotated and mirrored, power symbols
                  (one renamed per instance), named and unnamed nets with junctions, danglers
                  and labels, a bus with bus terminals, texts in every alignment, figures with
                  arcs, visible and hidden attributes. Format version 9 (1/1000 degree).
  hierarchy.csa   two sheets joined by a block: a two-gate part split across them, a signal
                  reference, a documentation symbol, a scaled symbol, ALL_SHEETS text. Format
                  version 8 (1/10 degree).
"""
import os
import sys

MM = 100000  # CADSTAR hundredth micron per mm
G = 254000   # 2.54 mm


def p(x, y):
    return f"(PT {x} {y})"


HEADER = """ (HEADER
  (FORMAT SCHEMATIC 1 {ver})
  (JOBFILE "C:\\\\ziro\\\\{name}.scm")
  (JOBTITLE "{title}")
  (GENERATOR "CADSTAR Schematic Editor 2018.0")
  (RESOLUTION
   (METRIC HUNDREDTH MICRON)
  )
  (TIMESTAMP 2024 3 14 15 9 26)
 )
"""

ASSIGNMENTS = """ (ASSIGNMENTS
  (CODEDEFS
   (LINECODE LC0 "(Connections)" 2540
    (STYLE SOLID)
   )
   (LINECODE LC1 "Line 1" 2540
    (STYLE SOLID)
   )
   (LINECODE LC2 "Dashed" 5080
    (STYLE DASH)
   )
   (LINECODE LC3 "Bus" 15240
    (STYLE SOLID)
   )
   (TEXTCODE TC0 "(Errors)" 2540 127000 0)
   (TEXTCODE TC1 "Text 100" 2540 254000 0)
   (TEXTCODE TC2 "Bold 150" 5080 381000 254000
    (FONT "Arial" 700 0
     (ITALIC)
    )
   )
   (TEXTCODE TC3 "Small" 1270 190500 0)
   (ROUTECODE W0 "(Default)" 2540)
   (ATTRNAME AT0 "Value"
    (ATTROWNER ALL_ITEMS)
   )
   (ATTRNAME AT1 "Tolerance"
    (ATTROWNER ALL_ITEMS)
   )
   (ATTRNAME AT2 "Supplier"
    (ATTROWNER ALL_ITEMS)
   )
   (TERMINALCODE TCD0 "Dot"
    (ROUND 50800)
   )
   (TERMINALCODE TCD1 "Box"
    (SQUARE 76200)
    (FILLED)
   )
  )
  (SETTINGS
   (UNITS MM)
   (UNITSPRECISION 2)
   (DESIGNAREA (PT 0 0) (PT 42000000 29700000))
   (DESIGNREF (PT 0 0))
   (DESIGNLIMIT (PT 100000000 100000000))
  )
  (GRIDS
   (WORKINGGRID
    (STEPGRID "" 127000 127000)
   )
   (SCREENGRID
    (STEPGRID "" 254000 254000)
   )
  )
 )
"""


def resistor_symdef(sid, name, alt):
    # Body 5.08 x 2.54 mm, pins at +-7.62 mm on the x axis with stubs to the body.
    return f"""  (SYMDEF {sid} "{name}" "{alt}" {p(10*MM, 10*MM)}
   (VERSION 3)
   (FIGURE FIG0 LC1 NO_SHEET
    (OPENSHAPE {p(10*MM - 2*G, 10*MM - G//2)} {p(10*MM + 2*G, 10*MM - G//2)} {p(10*MM + 2*G, 10*MM + G//2)} {p(10*MM - 2*G, 10*MM + G//2)} {p(10*MM - 2*G, 10*MM - G//2)})
   )
   (FIGURE FIG1 LC1 NO_SHEET
    (OPENSHAPE {p(10*MM - 3*G, 10*MM)} {p(10*MM - 2*G, 10*MM)})
   )
   (FIGURE FIG2 LC1 NO_SHEET
    (OPENSHAPE {p(10*MM + 2*G, 10*MM)} {p(10*MM + 3*G, 10*MM)})
   )
   (TERMINAL 1 TCD0
    {p(10*MM - 3*G, 10*MM)}
   )
   (TERMINAL 2 TCD0
    {p(10*MM + 3*G, 10*MM)}
    (ORIENT 180000)
   )
   (PINNUMNAMELOC 1 TC3
    {p(10*MM - 3*G, 10*MM + 50000)}
   )
   (PINLABELLOC 2 TC2
    {p(10*MM + 2*G, 10*MM + 50000)}
   )
   (TEXTLOC SYMBOL_NAME TC1
    {p(10*MM - 2*G, 10*MM + G)}
    (ALIGN BOTTOMLEFT)
   )
   (TEXTLOC PART_NAME TC3
    {p(10*MM, 10*MM - G)}
    (ALIGN TOPCENTER)
   )
   (TEXTLOC ATTRREF TC1
    (ATTRREF AT0)
    {p(10*MM + 2*G, 10*MM + G)}
    (ALIGN CENTERRIGHT)
   )
   (TEXT TXT0 "R" TC3 NO_SHEET
    {p(10*MM - 50000, 10*MM - 50000)}
   )
  )
"""


def cap_symdef(sid):
    # Vertical: pins at +-5.08 mm on the y axis, two plates and an arc for polarity.
    o = 20 * MM
    return f"""  (SYMDEF {sid} "CAP" "POL" {p(o, o)}
   (FIGURE FIG0 LC1 NO_SHEET
    (OPENSHAPE {p(o - G, o + G//4)} {p(o + G, o + G//4)})
   )
   (FIGURE FIG1 LC1 NO_SHEET
    (OPENSHAPE {p(o - G, o - G//4)}
     (ACWARC {p(o, o - G)} {p(o + G, o - G//4)})
    )
   )
   (FIGURE FIG2 LC1 NO_SHEET
    (OPENSHAPE {p(o, o + 2*G)} {p(o, o + G//4)})
   )
   (FIGURE FIG3 LC1 NO_SHEET
    (OPENSHAPE {p(o, o - 2*G)} {p(o, o - G//2)})
   )
   (FIGURE FIG4 LC1 NO_SHEET
    (SOLID {p(o - G//2, o + G)} {p(o - G//4, o + G)} {p(o - G//4, o + G + G//4)} {p(o - G//2, o + G)})
   )
   (TERMINAL 1 TCD0
    {p(o, o + 2*G)}
    (ORIENT 270000)
   )
   (TERMINAL 2 TCD0
    {p(o, o - 2*G)}
    (ORIENT 90000)
   )
   (TEXTLOC SYMBOL_NAME TC1
    {p(o + G, o + G)}
   )
   (ATTR AT1 "20%"
    (ATTRLOC TC3 NO_SHEET
     {p(o + G, o - G)}
     (ALIGN TOPLEFT)
    )
   )
  )
"""


def power_symdef(sid, net, figure="bar"):
    o = 30 * MM
    fig = (f"(OPENSHAPE {p(o - G, o - G)} {p(o + G, o - G)})" if figure == "bar"
           else f"(OPENSHAPE {p(o - G, o - G)} {p(o, o - 2*G)} {p(o + G, o - G)} {p(o - G, o - G)})")
    return f"""  (SYMDEF {sid} "GLOBALSIGNAL" "{net}" {p(o, o)}
   (FIGURE FIG0 LC1 NO_SHEET
    (OPENSHAPE {p(o, o)} {p(o, o - G)})
   )
   (FIGURE FIG1 LC1 NO_SHEET
    {fig}
   )
   (TERMINAL 1 TCD0
    {p(o, o)}
   )
   (TEXTLOC SIGNALNAME_ORIGIN TC1
    {p(o, o - 2*G - 50000)}
    (ALIGN TOPCENTER)
   )
  )
"""


def part(pid, name, symname, alt, value, gates="A", hide=False, extra_attrs=""):
    gate_defs = "".join(f'    (GATEDEFINITION {g} "{symname}" "{alt}" 2)\n' for g in gates)
    pins = ""
    n = 1
    for g in gates:
        for t in (1, 2):
            pins += f'    (PARTDEFINITIONPIN {n}\n     (PINNAME "{n}")\n     (PINTERM {g} {t})\n     (PINTYPE {"INPUT" if t == 1 else "OUTPUT_NOT_OR"})\n    )\n'
            n += 1
    return f"""  (PART {pid} "{name}"
   (VERSION 2)
   (PARTDEFINITION "{name}-DEF"
{"    (HIDEPINNAMES)" + chr(10) if hide else ""}{gate_defs}{pins}    (ATTR AT0 "{value}")
    (ATTR AT2 "Ziro Parts")
{extra_attrs}   )
   (PARTPIN 1)
   (PARTPIN 2)
  )
"""


def attrloc(tc, sheet, x, y, align=None, orient=None):
    s = f"(ATTRLOC {tc} {sheet} {p(x, y)}"
    if align:
        s += f" (ALIGN {align})"
    if orient is not None:
        s += f" (ORIENT {orient})"
    return s + ")"


def basic():
    S = "SHT1"
    out = ["(CADSTARSCM\n", HEADER.format(ver=9, name="basic", title="Basic import test"), ASSIGNMENTS]
    out.append(" (LIBRARY\n")
    out.append(resistor_symdef("SYM0", "RES", ""))
    out.append(cap_symdef("SYM1"))
    out.append(power_symdef("SYM2", "GND"))
    out.append(power_symdef("SYM3", "VCC", figure="arrow"))
    out.append(" )\n")
    out.append(" (PARTS\n")
    out.append(part("PA0", "RES-10K", "RES", "", "10k"))
    out.append(part("PA1", "CAP-100N", "CAP", "POL", "100n", hide=True,
                    extra_attrs='    (ATTR AT1 "10%")\n'))
    out.append(" )\n")
    out.append(f' (SHEETS\n  (SHEET {S} "Main Sheet")\n )\n')

    # Placements (sheet coordinates, CADSTAR y up).
    r1 = (60 * MM, 150 * MM)
    r2 = (120 * MM, 150 * MM)   # rotated 90, mirrored
    r3 = (60 * MM, 100 * MM)    # rotated 180
    c1 = (160 * MM, 120 * MM)
    gnd = (160 * MM, 90 * MM)
    vcc = (30 * MM, 170 * MM)
    agnd = (60 * MM, 70 * MM)

    sch = [" (SCHEMATIC\n"]
    sch.append(f"""  (SYMBOL SY0 SYM0 {S} {p(*r1)}
   (COMP "R1"
    {attrloc("TC1", S, r1[0] - 2*G, r1[1] + G, "BOTTOMLEFT")}
   )
   (PARTREF PA0
    {attrloc("TC3", S, r1[0], r1[1] - G, "TOPCENTER")}
   )
   (GATE A)
   (ATTR AT0 "10k"
    {attrloc("TC1", S, r1[0] + 2*G, r1[1] + G, "CENTERRIGHT")}
   )
   (ATTR AT2 "Ziro Parts"
    {attrloc("TC1", S, r1[0], r1[1] + 2*G)}
   )
  )
  (SYMBOL SY1 SYM0 {S} {p(*r2)}
   (COMP "R2"
    {attrloc("TC1", S, r2[0] + G, r2[1] + 2*G, "BOTTOMLEFT", 90000)}
   )
   (PARTREF PA0)
   (ORIENT 90000)
   (MIRROR)
   (GATE A)
   (ATTR AT0 "4k7"
    {attrloc("TC1", S, r2[0] - G, r2[1], "CENTERLEFT", 90000)}
   )
  )
  (SYMBOL SY2 SYM0 {S} {p(*r3)}
   (COMP "R3"
    {attrloc("TC2", S, r3[0], r3[1] + G, "BOTTOMCENTER", 180000)}
   )
   (PARTREF PA0)
   (ORIENT 180000)
   (SYMPINNAME 1 "A")
   (SYMPINNAME 2 "B")
  )
  (SYMBOL SY3 SYM1 {S} {p(*c1)}
   (COMP "C1"
    {attrloc("TC1", S, c1[0] + G, c1[1] + G)}
   )
   (PARTREF PA1)
   (GATE A)
   (ATTR AT1 "10%"
    {attrloc("TC3", S, c1[0] + G, c1[1] - G, "TOPLEFT")}
   )
  )
  (SYMBOL SY4 SYM2 {S} {p(*gnd)}
   (SYMBOLVARIANT
    (GLOBALSIGNAL "GND")
   )
  )
  (SYMBOL SY5 SYM3 {S} {p(*vcc)}
   (SYMBOLVARIANT
    (GLOBALSIGNAL "VCC")
   )
  )
  (SYMBOL SY6 SYM2 {S} {p(*agnd)}
   (ORIENT 180000)
   (SYMBOLVARIANT
    (GLOBALSIGNAL "AGND")
   )
  )
""")
    # Pin positions (unrotated R: pins at origin +- 3G on x).
    r1p1 = (r1[0] - 3*G, r1[1]); r1p2 = (r1[0] + 3*G, r1[1])
    # R2 rotated 90 then mirrored: pins at origin +- 3G on y.
    r2top = (r2[0], r2[1] + 3*G); r2bot = (r2[0], r2[1] - 3*G)
    r3p1 = (r3[0] + 3*G, r3[1]); r3p2 = (r3[0] - 3*G, r3[1])
    c1p1 = (c1[0], c1[1] + 2*G); c1p2 = (c1[0], c1[1] - 2*G)
    j1 = (r1p2[0] + 4*G, r1p2[1])

    sch.append(f"""  (NET NET0
   (SIGNAME "VIN")
   (JPT J1 TCD0 {S}
    {p(*j1)}
    (SIGLOC TC1 {p(j1[0], j1[1] + G)})
   )
   (TERM P1 SY0 2)
   (TERM P2 SY1 1
    (SIGLOC TC3 {p(r2top[0] + G, r2top[1])})
   )
   (TERM P3 SY3 1)
   (DANGLER D1 TCD1 {S}
    {p(j1[0], j1[1] - 8*G)}
    (SIGLOC TC2 {p(j1[0] + G, j1[1] - 8*G)} (ALIGN CENTERLEFT))
   )
   (CONN P1 J1 W0 {S}
    (PATH {p(*r1p2)} {p(*j1)})
   )
   (CONN J1 P2 W0 {S}
    (PATH {p(*j1)} {p(r2top[0], j1[1])} {p(*r2top)})
   )
   (CONN J1 P3 W0 {S}
    (PATH {p(*j1)} {p(j1[0], c1p1[1] + 4*G)} {p(c1p1[0], c1p1[1] + 4*G)} {p(*c1p1)})
   )
   (CONN J1 D1 W0 {S}
    (PATH {p(*j1)} {p(j1[0], j1[1] - 8*G)})
    (CONLINECODE LC2)
   )
  )
  (NET NET1
   (SIGNUM 7)
   (TERM P4 SY0 1)
   (TERM P5 SY5 1)
   (CONN P4 P5 W0 {S}
    (PATH {p(*r1p1)} {p(vcc[0], r1p1[1])} {p(*vcc)})
   )
  )
  (NET NET2
   (SIGNAME "GND")
   (TERM P6 SY3 2)
   (TERM P7 SY4 1
    (SIGLOC TC1 {p(gnd[0] + G, gnd[1] - 2*G)})
   )
   (CONN P6 P7 W0 {S})
  )
  (NET NET3
   (SIGNAME "AGND")
   (TERM P8 SY2 2)
   (TERM P9 SY6 1)
   (CONN P8 P9 W0 {S}
    (PATH {p(*r3p2)} {p(agnd[0], r3p2[1])} {p(*agnd)})
   )
  )
  (NET NET4
   (SIGNAME "SENSE")
   (TERM P10 SY2 1
    (SIGLOC TC1 {p(r3p1[0] + G, r3p1[1])})
   )
   (TERM P11 SY1 2)
   (CONN P10 P11 W0 {S}
    (PATH {p(*r3p1)} {p(r2bot[0], r3p1[1])} {p(*r2bot)})
   )
  )
""")
    # A bus with two members, each leaving through a bus terminal to a labelled dangler.
    b0 = (200 * MM, 160 * MM); b1 = (200 * MM, 80 * MM)
    sch.append(f"""  (BUS BS0 LC3 {S}
   (OPENSHAPE {p(*b0)} {p(*b1)} {p(b1[0] + 10*G, b1[1])})
   (BUSNAME "DATA"
    (SIGLOC TC1 {p(b0[0] + G, b0[1] - 4*G)})
   )
  )
  (BUS BS1 LC3 {S}
   (OPENSHAPE {p(230*MM, 160*MM)} {p(230*MM, 120*MM)})
   (BUSNAME "ADDR")
  )
""")
    for i, y in enumerate((140 * MM, 110 * MM)):
        bt1 = (b0[0], y); bt2 = (b0[0] + G, y - G)
        d = (b0[0] + 6*G, y - G)
        label = f"\n    (SIGLOC TC1 {p(bt2[0], bt2[1] + 50000)})" if i == 0 else ""
        sch.append(f"""  (NET NET{5+i}
   (SIGNAME "D{i}")
   (BUSTERM BT{i} BS0
    {p(*bt1)}
    {p(*bt2)}{label}
   )
   (DANGLER D{10+i} TCD0 {S}
    {p(*d)}
   )
   (CONN BT{i} D{10+i} W0 {S})
  )
""")
    # Figures and texts.
    sch.append(f"""  (FIGURE FIG0 LC2 {S}
   (OPENSHAPE {p(20*MM, 20*MM)} {p(100*MM, 20*MM)} {p(100*MM, 50*MM)} {p(20*MM, 50*MM)} {p(20*MM, 20*MM)})
  )
  (FIGURE FIG1 LC1 {S}
   (OPENSHAPE {p(120*MM, 30*MM)}
    (CWARC {p(130*MM, 30*MM)} {p(140*MM, 30*MM)})
    (ACWSEMI {p(160*MM, 30*MM)})
    {p(160*MM, 40*MM)}
   )
  )
  (FIGURE FIG2 LC1 {S}
   (OUTLINE {p(180*MM, 20*MM)} {p(200*MM, 20*MM)} {p(200*MM, 40*MM)} {p(180*MM, 20*MM)})
  )
""")
    aligns = ["BOTTOMLEFT", "BOTTOMCENTER", "BOTTOMRIGHT", "CENTERLEFT", "CENTERCENTER",
              "CENTERRIGHT", "TOPLEFT", "TOPCENTER", "TOPRIGHT", None]
    orients = [0, 90000, 180000, 270000, 45000]
    for i, a in enumerate(aligns):
        o = orients[i % len(orients)]
        al = f"\n   (ALIGN {a})" if a else ""
        tc = ["TC1", "TC2", "TC3"][i % 3]
        sch.append(f"""  (TEXT TX{i} "Text {i} {a or 'none'}" {tc} {S}
   {p(30*MM + i * 15*MM, 250*MM)}{al}
   (ORIENT {o})
  )
""")
    sch.append(f"""  (TEXT TX20 "Mirrored" TC1 {S}
   {p(30*MM, 220*MM)}
   (MIRROR)
   (ALIGN BOTTOMLEFT)
  )
  (TEXT TX21 "Bar /over/ text" TC1 {S}
   {p(90*MM, 220*MM)}
  )
""")
    sch.append(" )\n")
    out += sch
    out.append("""(DISPLAY
  (ATTRCOLORS
   (DFLTSETTINGS COL0)
   (ATTRCOL AT0 COL1)
   (ATTRCOL AT1 COL2)
   (ATTRCOL AT2 COL3
    (INVISIBLE)
   )
  )
  (SCMITEMCOLORS
   (SYMCOL
    (PARTNAMECOL COL4)
   )
  )
 )
)
""")
    return "".join(out)


def hierarchy():
    TOP, SUB = "SHT1", "SHT2"
    out = ["(CADSTARSCM\n", HEADER.format(ver=8, name="hierarchy", title="Hierarchy test"),
           ASSIGNMENTS.replace("(ORIENT 180000)", "(ORIENT 1800)")]
    out.append(" (LIBRARY\n")
    out.append(resistor_symdef("SYM0", "RES", "").replace("(ORIENT 180000)", "(ORIENT 1800)"))
    out.append(f"""  (SYMDEF SYM1 "SIGNALREF" "in" {p(0, 0)}
   (FIGURE FIG0 LC1 NO_SHEET
    (OPENSHAPE {p(0, 0)} {p(G, G//2)} {p(G, -G//2)} {p(0, 0)})
   )
   (TERMINAL 1 TCD0
    {p(0, 0)}
   )
   (TEXTLOC LINK_ORIGIN TC1
    {p(G + 50000, 0)}
    (ALIGN CENTERLEFT)
   )
  )
  (SYMDEF SYM2 "TITLE" "" {p(0, 0)}
   (FIGURE FIG0 LC1 NO_SHEET
    (OPENSHAPE {p(0, 0)} {p(80*MM, 0)} {p(80*MM, 20*MM)} {p(0, 20*MM)} {p(0, 0)})
   )
   (FIGURE FIG1 LC1 NO_SHEET
    (OPENSHAPE {p(0, 10*MM)} {p(80*MM, 10*MM)})
   )
   (TEXT TXT0 "Ziro test board" TC2 NO_SHEET
    {p(2*MM, 12*MM)}
   )
   (TEXT TXT1 "Rev A" TC1 NO_SHEET
    {p(2*MM, 2*MM)}
    (ORIENT 900)
   )
  )
""")
    out.append(" )\n (PARTS\n")
    out.append(part("PA0", "RES-DUAL", "RES", "", "1k", gates="AB"))
    out.append(" )\n")
    out.append(f' (SHEETS\n  (SHEET {TOP} "Top Level")\n  (SHEET {SUB} "Sub Circuit")\n )\n')

    ra = (60 * MM, 120 * MM)
    rb = (60 * MM, 120 * MM)   # gate B, on the sub-sheet
    rc = (60 * MM, 60 * MM)    # scaled 2:1 on the top sheet
    blk = [(120 * MM, 100 * MM), (180 * MM, 140 * MM)]  # block outline corners
    sref = (30 * MM, 120 * MM)
    sch = [" (SCHEMATIC\n"]
    sch.append(f"""  (SYMBOL SY0 SYM0 {TOP} {p(*ra)}
   (COMP "RN1"
    {attrloc("TC1", TOP, ra[0] - 2*G, ra[1] + G)}
   )
   (PARTREF PA0)
   (GATE A)
  )
  (SYMBOL SY1 SYM0 {SUB} {p(*rb)}
   (COMP "RN1"
    {attrloc("TC1", SUB, rb[0] - 2*G, rb[1] + G)}
   )
   (PARTREF PA0)
   (GATE B)
   (ORIENT 900)
  )
  (SYMBOL SY2 SYM0 {TOP} {p(*rc)}
   (COMP "R9"
    {attrloc("TC1", TOP, rc[0], rc[1] + 2*G)}
   )
   (PARTREF PA0)
   (GATE A)
   (SCALE 2 1)
  )
  (SYMBOL SY3 SYM1 {TOP} {p(*sref)}
   (SYMBOLVARIANT
    (SIGNALREF)
   )
  )
  (BLOCK BLK0 "" {TOP}
   (CHILD {SUB})
   (BLOCKNAME "Sub Circuit"
    (ATTRLOC TC1 {TOP} {p(blk[0][0], blk[1][1] + G)})
   )
   (TERMINAL 1 TCD0
    {p(blk[0][0], 120 * MM)}
   )
   (TERMINAL 2 TCD0
    {p(blk[1][0], 110 * MM)}
    (ORIENT 1800)
   )
   (FIGURE FIG0 LC1 {TOP}
    (OPENSHAPE {p(blk[0][0], blk[0][1])} {p(blk[1][0], blk[0][1])} {p(blk[1][0], blk[1][1])} {p(blk[0][0], blk[1][1])} {p(blk[0][0], blk[0][1])})
   )
  )
  (BLOCK BLK1 "" {SUB}
   (PARENT {TOP})
   (TERMINAL 1 TCD0
    {p(20 * MM, 120 * MM)}
   )
   (TERMINAL 2 TCD0
    {p(120 * MM, 120 * MM)}
    (ORIENT 1800)
   )
  )
""")
    ra2 = (ra[0] + 3*G, ra[1]); ra1 = (ra[0] - 3*G, ra[1])
    rb1 = (rb[0], rb[1] - 3*G); rb2 = (rb[0], rb[1] + 3*G)
    sch.append(f"""  (NET NET0
   (SIGNAME "LINK_IN")
   (TERM P1 SY0 2)
   (BLOCKTERM BLKT1 BLK0 1)
   (BLOCKTERM BLKT2 BLK1 1)
   (TERM P2 SY1 1)
   (CONN P1 BLKT1 W0 {TOP}
    (PATH {p(*ra2)} {p(blk[0][0] + 2*G, 120 * MM)})
   )
   (CONN BLKT2 P2 W0 {SUB}
    (PATH {p(20 * MM, 120 * MM)} {p(rb1[0], 120 * MM)} {p(*rb1)})
   )
  )
  (NET NET1
   (SIGNAME "EXT")
   (TERM P3 SY3 1)
   (TERM P4 SY0 1)
   (CONN P3 P4 W0 {TOP})
  )
  (NET NET2
   (SIGNAME "LINK_OUT")
   (TERM P5 SY1 2)
   (BLOCKTERM BLKT3 BLK1 2)
   (BLOCKTERM BLKT4 BLK0 2)
   (DANGLER D1 TCD0 {TOP}
    {p(blk[1][0] + 8*G, 110 * MM)}
    (SIGLOC TC1 {p(blk[1][0] + 8*G, 110 * MM + G)})
   )
   (CONN P5 BLKT3 W0 {SUB}
    (PATH {p(*rb2)} {p(rb2[0], rb2[1] + 4*G)} {p(120 * MM, rb2[1] + 4*G)} {p(120 * MM, 120 * MM)})
   )
   (CONN BLKT4 D1 W0 {TOP})
  )
  (DOCSYMBOL DS0 SYM2 {TOP} {p(200 * MM, 20 * MM)}
   (ORIENT 0)
  )
  (DOCSYMBOL DS1 SYM2 {SUB} {p(150 * MM, 20 * MM)}
   (MIRROR)
   (SCALE 1 2)
  )
  (TEXT TX0 "On every sheet" TC1 ALL_SHEETS
   {p(10 * MM, 10 * MM)}
  )
  (TEXT TX1 "Top only" TC2 {TOP}
   {p(10 * MM, 200 * MM)}
   (ALIGN TOPRIGHT)
   (ORIENT 900)
  )
""")
    sch.append(" )\n")
    out += sch
    out.append(")\n")
    return "".join(out)


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(outdir, exist_ok=True)
    for name, text in (("basic", basic()), ("hierarchy", hierarchy())):
        with open(os.path.join(outdir, f"{name}.csa"), "w", encoding="cp1252", newline="\r\n") as f:
            f.write(text)
        print(os.path.join(outdir, f"{name}.csa"))


if __name__ == "__main__":
    main()
