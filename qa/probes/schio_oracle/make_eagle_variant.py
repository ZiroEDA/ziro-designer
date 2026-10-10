#!/usr/bin/env python3
"""make_eagle_variant.py <eagle-import-testfile.sch> <out.sch>

KiCad's EAGLE test file leaves much of SCH_IO_EAGLE untested (the mutation sweep's
survivors). This writes a variant of it that reaches those paths, for real eeschema to
import as the expectation:
  - references: one with no trailing digit, one starting with a digit, one starting '#';
  - plain texts at R180, R270 and MR90;
  - a polygon (with a curved edge) in a symbol that is placed;
  - part attributes out of alphabetical order, one shown on its instance;
  - a bus named as a comma list with an odd number of '!' overbar markers;
  - a net with a second, unlabelled segment.
"""
import sys, re, copy
import xml.etree.ElementTree as ET

src = open(sys.argv[1], encoding='utf-8').read()
head = src[:src.index('<eagle')]
root = ET.fromstring(src[src.index('<eagle'):])
sch = root.find('drawing/schematic')

renames = {'R1': 'R', 'L1': '5L', 'C1': '#C1'}
for el in root.iter():
    for attr in ('name', 'part'):
        if el.tag in ('part', 'instance', 'pinref') and el.get(attr) in renames:
            el.set(attr, renames[el.get(attr)])

sheet1 = sch.find('sheets')[0]
texts = sheet1.findall('plain/text')
for t, rot in zip(texts, ['R180', 'R270', 'MR90']):
    t.set('rot', rot)

used = {(p.get('library'), p.get('deviceset')) for p in sch.find('parts')}
done = False
for lib in sch.find('libraries'):
    for ds in lib.findall('devicesets/deviceset'):
        if done or (lib.get('name'), ds.get('name')) not in used:
            continue
        gate = ds.find('gates/gate')
        sym = lib.find(f"symbols/symbol[@name='{gate.get('symbol')}']")
        poly = ET.SubElement(sym, 'polygon', {'width': '0.254', 'layer': '94'})
        ET.SubElement(poly, 'vertex', {'x': '-1.27', 'y': '-1.27'})
        ET.SubElement(poly, 'vertex', {'x': '1.27', 'y': '-1.27', 'curve': '90'})
        ET.SubElement(poly, 'vertex', {'x': '0', 'y': '1.27'})
        done = True

part = sch.find("parts/part[@name='R3']")
for name, value in (('ZZZ', 'zed'), ('AAA', 'ay'), ('MMM', 'em')):
    ET.SubElement(part, 'attribute', {'name': name, 'value': value})
inst = sheet1.find("instances/instance[@part='R3']")
ET.SubElement(inst, 'attribute', {'name': 'AAA', 'x': inst.get('x'), 'y': inst.get('y'),
                                  'size': '1.778', 'layer': '96', 'display': 'value'})

bus = sheet1.find("busses/bus[@name='A[1..3]']")
bus.set('name', 'A1,!A2,A3')

net = max(sheet1.findall('nets/net'), key=lambda n: len(n.findall('segment')) == 1)
seg = net.find('segment')
wire = seg.find('wire')
if wire is not None:
    extra = ET.SubElement(net, 'segment')
    w = copy.deepcopy(wire)
    for k in ('y1', 'y2'):
        w.set(k, str(round(float(w.get(k)) - 5.08, 4)))
    extra.append(w)

body = ET.tostring(root, encoding='unicode')
open(sys.argv[2], 'w', encoding='utf-8').write(head + body + '\n')
print('renamed', renames, 'polygon', done, 'net', net.get('name'))
