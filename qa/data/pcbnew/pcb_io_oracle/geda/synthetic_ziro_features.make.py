"""Build synthetic_ziro_features.pcb: a gEDA board reaching what KiCad's qa
boards do not (arcs on copper and elsewhere, the old "(" units, Pin( and
Pad( forms, every layer name mapLayer knows, comments inside a
parameter list, a non-ASCII byte, a text with no scale)."""
import sys
out = sys.argv[1] if len(sys.argv) > 1 else 'synthetic_ziro_features.pcb'
S = '''# release: pcb 20140316
FileVersion[20091103]

PCB["synthetic" 6000.00mil 4000.00mil]

Grid[1000.000000 0.0000 0.0000 0]
Flags("nameonpcb")
Styles["Signal,10.00mil,36.00mil,20.00mil,10.00mil"]

Element["" "DIP4" "U1" "NE555" 100000 100000 -2000 -3000 0 100 ""]
(
	Pin[0 0 6000 2000 6600 3000 "1" "1" "square"]
	Pin[0 10000 6000 2000 6600 3000 "2" "2" ""]
	Pin[30000 10000 6000 2000 6600 3000 "3" "3" "0x0100"]
	Pin[30000 0 7000 3000 "4" "4" "0x0001"]
	ElementLine [-5000 -5000 35000 -5000 1000]
	ElementArc [15000 -5000 5000 5000 0 180 1000]
	ElementArc [15000 5000 3000 3000 0 360 800]
	)

Element("0x00" "old style" "Q1" "BC547" 2000 1500 0 100 0x00)
(
	Pin(0 0 60 28 "1" 0x101)
	Pin(100 0 60 30 "2" 0x01)
	Pad(0 100 50 100 20 "3" 0x80)
	ElementLine(-50 -50 150 -50 10)
	ElementArc(50 0 80 80 45 270 10)
)

Element["onsolder" "SOT23" "D1" "BAT54" 200000 150000 0 0 0 100 "auto"]
(
	Pad[-3000 0 -3000 1000 2000 1000 2600 "1" "1" "square,onsolder"]
	Pad[3000 0 3000 1000 2000 1000 2600 "2" "2" "onsolder"]
	Pad[0 5000 5000 5000 2400 1000 3000 "3" "3" "0x00000080"]
	ElementLine [-4000 -2000 4000 -2000 600]
	)

Element["" "mm part" "R1" "" 3.0mm 2.5mm 0 0 0 100 ""]
(
	Pad[-0.5mm 0 0.5mm 0 0.6mm 0.2mm 0.8mm "1" "1" ""]
	Pad[-20.0mil 40.0mil 20.0mil 40.0mil 24.0mil 8.0mil 30.0mil "2" "2" ""]
	Pin[1.0mm 1.0mm 1.2mm 0.3mm 1.4mm 0.7mm "3" "3" ""]
	)

Element["" "12" "12" "" 250000 50000 0 0 0 100 ""]
(
	Pin[0 0 8000 2000 8600 4000 "A" "A" ""]
	)

Via[150000 100000 3600 2000 0 2000 "" ""]
Via[160000 100000 4000 2000 4600 1500 "" "thermal(0X)"]
Via(1700 1000 36 20 0 20 "" 0x02)

Layer(1 "component")
(
	Line[100000 50000 150000 50000 1000 2000 "clearline"]
	Arc[150000 70000 20000 20000 1000 2000 90 90 "clearline"]
	Arc[150000 90000 10000 12000 1000 2000 0 -180 ""]
	Text[120000 60000 0 150 "TOP \xe9 TEXT" "clearline"]
	Text[120000 70000 1 abc "ROTATED" ""]
)
Layer(2 "solder")
(
	Line[100000 60000 150000 60000 1000 2000 "clearline"]
	Text[120000 80000 2 100 "BOTTOM" "onsolder"]
)
Layer(3 "GND")
(
	Line(1000 700 1500 700 10 20 0x20)
	Polygon("clearpoly")
	(
		[0 0] [150000 0] [150000 100000] [0 100000]
	)
)
Layer(4 "Route")
(
	Line[0 0 400000 0 1000 2000 "clearline"]
	Arc[200000 200000 50000 50000 1000 2000 0 360 ""]
	Arc[300000 200000 20000 20000 1000 2000 45 -90 ""]
)
Layer(5 "top mask")
(
	Line[0 10000 5000 10000 1000 2000 ""]
)
Layer(6 "bottom paste")
(
	Line[0 20000 5000 20000 1000 2000 ""]
)
Layer(7 "fab")
(
	Text[10000 10000 3 50 "fab note" ""]
)
Layer(8 "solder silk")
(
	Line[0 30000 5000 30000 1000 2000 ""]
)
Layer(9 "signal5")
(
	Line[0 40000 # a comment inside
	5000 40000 1000 2000 ""]
)
Layer(18 "overflow")
(
	Line[0 50000 5000 50000 1000 2000 ""]
)
Layer(10 "silk")
(
	Line[0 60000 5000 60000 1000 2000 ""]
	Arc[20000 60000 3000 3000 800 2000 0 90 ""]
)
NetList()
(
	Net("VCC" "(unknown)")
	(
		Connect("U1-1")
		Connect("Q1-2")
		Connect("12-A")
	)
	Net("GND" "(unknown)")
	(
		Connect("U1-2")
		Connect("D1-3")
		Connect("NOPE-1")
		Connect("nodash")
	)
	Net("VCC" "(unknown)")
	(
		Connect("R1-3")
	)
)
'''
open(out, 'wb').write(S.encode('latin-1'))
