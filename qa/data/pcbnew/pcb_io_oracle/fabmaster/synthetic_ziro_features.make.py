"""Build synthetic_ziro_features.txt: a Fabmaster (Allegro extracta) board that
reaches what KiCad's qa files do not: a LAYER_SORT section, FIG_RECTANGLE,
DIAMOND and HEXAGON_Y graphics, a circle with unequal radii, blind and
buried vias, a refdes split over two placements, a refdes that starts with
a digit, an unplaced component, orphan pins, and a mirrored part with
silkscreen lines, arcs, circles and text."""
import sys
out = sys.argv[1] if len(sys.argv) > 1 else 'synthetic_ziro_features.txt'
J = ['J', 'synth.brd', 'Mon Feb 3 10:00:00 2026', '-100.0000', '-100.0000', '100.0000', '100.0000', '0.0001', 'millimeters', '', '10.000000 mil', '2', 'UP TO DATE']
L = []
def row(*cells): L.append('!'.join(cells) + '!')
def sec(header, rows):
    row('A', *header); row(*J)
    for r in rows:
        assert len(r) == len(header), (header, r)
        row('S', *r)

sec(['LAYER_SORT', 'LAYER_SUBCLASS', 'LAYER_ARTWORK', 'LAYER_USE', 'LAYER_CONDUCTOR', 'LAYER_DIELECTRIC_CONSTANT', 'LAYER_ELECTRICAL_CONDUCTIVITY', 'LAYER_MATERIAL'],
    [['1', '', 'POSITIVE', '', 'YES', '1', '595900', 'COPPER'],
     ['2', '', 'POSITIVE', '', 'NO', '4.5', '0', 'FR-4'],
     ['3', '', 'NEGATIVE', 'PLANE', 'YES', '1', '595900', 'COPPER'],
     ['4', 'NAMED', 'POSITIVE', '', 'YES', '1', '595900', 'COPPER'],
     ['5', '', 'POSITIVE', '', 'NO', '1', '0', 'AIR']])

sec(['CLASS', 'SUBCLASS'],
    [['ETCH', 'TOP'], ['ETCH', 'INNER1'], ['ANTI ETCH', 'INNER2'], ['ETCH', 'BOTTOM'],
     ['BOARD GEOMETRY', 'SILKSCREEN_TOP'], ['BOARD GEOMETRY', 'SILKSCREEN_BOTTOM'],
     ['BOARD GEOMETRY', 'OUTLINE'], ['PACKAGE GEOMETRY', 'ASSEMBLY_TOP'],
     ['BOARD GEOMETRY', 'SOLDERMASK_TOP'], ['BOARD GEOMETRY', 'PASTEMASK_BOTTOM'],
     ['MANUFACTURING', 'NCLEGEND-1-4'], ['MANUFACTURING', 'AUTOSILK_TOP'],
     ['DRAWING FORMAT', 'TITLE_DATA']])

PH = ['PAD_NAME', 'REC_NUMBER', 'LAYER', 'FIXFLAG', 'VIAFLAG', 'PADSHAPE1', 'PADWIDTH', 'PADHGHT', 'PADXOFF', 'PADYOFF', 'PADFLASH', 'PADSHAPENAME']
def pad(name, rec, layer, via, shape, w, h, xo='0.0000', yo='0.0000', sn=''):
    return [name, rec, layer, 'o', via, shape, w, h, xo, yo, '', sn]
sec(PH, [
    pad('VIA_TI', '00001', 'TOP', 'v', 'CIRCLE', '0.6000', '0.6000'),
    pad('VIA_TI', '00002', 'INNER1', 'v', 'CIRCLE', '0.6000', '0.6000'),
    pad('VIA_TI', '00003', '~DRILL', 'v', '0.3000', '0.3000', '0.3000', sn='P'),
    pad('VIA_II', '00001', 'INNER1', 'v', 'CIRCLE', '0.5000', '0.5000'),
    pad('VIA_II', '00002', 'INNER2', 'v', 'CIRCLE', '0.5000', '0.5000'),
    pad('VIA_II', '00003', '~DRILL', 'v', '0.2500', '0.2500', '0.2500', sn='P'),
    pad('VIA_TB', '00001', 'TOP', 'v', 'CIRCLE', '0.8000', '0.8000'),
    pad('VIA_TB', '00002', 'BOTTOM', 'v', 'CIRCLE', '0.8000', '0.8000'),
    pad('VIA_TB', '00003', '~DRILL', 'v', '0.4000', '0.4000', '0.4000', sn='P'),
    pad('SMD_R', '00001', 'TOP', '', 'ROUNDED_RECT', '1.2000', '0.6000', '0.1000', '0.2000'),
    pad('SMD_R', '00002', '~TSM', '', 'ROUNDED_RECT', '1.3000', '0.7000'),
    pad('SMD_R', '00003', '~TSP', '', 'ROUNDED_RECT', '1.2000', '0.6000'),
    pad('SMD_OCT', '00001', 'TOP', '', 'OCTAGON', '1.0000', '1.0000'),
    pad('SMD_SQ', '00001', 'BOTTOM', '', 'SQUARE', '0.9000', '0.4000'),
    pad('SLOT', '00001', 'TOP', '', 'OBLONG_Y', '1.0000', '2.0000'),
    pad('SLOT', '00002', 'BOTTOM', '', 'OBLONG_Y', '1.0000', '2.0000'),
    pad('SLOT', '00003', '~DRILL', '', '0.5000', '0.5000', '1.5000', sn='N'),
    pad('BAD', '00001', 'TOP', '', 'STAR', '1.0000', '1.0000'),
])

sec(['REFDES', 'COMP_CLASS', 'COMP_PART_NUMBER', 'COMP_HEIGHT', 'COMP_DEVICE_LABEL', 'COMP_INSERTION_CODE', 'SYM_TYPE', 'SYM_NAME', 'SYM_MIRROR', 'SYM_ROTATE', 'SYM_X', 'SYM_Y', 'COMP_VALUE', 'COMP_TOL', 'COMP_VOLTAGE'],
    [['R1', 'DISCRETE', 'PN1', '1.0', '', 'A', 'PACKAGE', 'RES0603', 'NO', '90.000', '10.0000', '20.0000', '10K', '1%', ''],
     ['U2', 'IC', 'PN2', '1.0', '', 'A', 'PACKAGE', 'SOIC', 'YES', '30.000', '30.0000', '20.0000', '', '', ''],
     ['J3', 'IO', 'PN3', '', '', 'A', 'MECHANICAL', 'CONN', 'NO', '0.000', '50.0000', '10.0000', '', '', ''],
     ['J3', 'IO', 'PN3', '', '', 'A', 'MECHANICAL', 'CONN', 'NO', '180.000', '55.0000', '10.0000', '', '', ''],
     ['1X', 'IC', 'PN4', '', '', 'A', 'FORMAT', 'LOGO', 'NO', '0.000', '70.0000', '30.0000', '', '', ''],
     ['U9', 'IC', 'PN5', '', '', 'A', 'PACKAGE', 'SOIC', 'NO', '', '', '', '', '', '']])

sec(['NET_NAME', 'REFDES', 'PIN_NUMBER', 'PIN_NAME', 'PIN_GROUND', 'PIN_POWER'],
    [['VCC', 'R1', '1', 'A', 'NO', 'YES'], ['GND', 'R1', '2', 'B', 'YES', 'NO'],
     ['VCC', 'U2', '1', 'VDD', 'NO', 'YES'], ['SIG', 'U2', '2', 'IO', 'NO', 'NO'],
     ['SIG', 'TP7', '1', '1', 'NO', 'NO'], ['GND', 'J3', '1', '1', 'NO', 'NO'],
     ['GND', 'R1', '2', 'B', 'YES', 'NO']])

sec(['SYM_NAME', 'SYM_MIRROR', 'PIN_NAME', 'PIN_NUMBER', 'PIN_X', 'PIN_Y', 'PAD_STACK_NAME', 'REFDES', 'PIN_ROTATION', 'TEST_POINT'],
    [['RES0603', 'NO', 'A', '1', '9.2000', '20.0000', 'SMD_R', 'R1', '90.000', ''],
     ['RES0603', 'NO', 'B', '2', '10.8000', '20.0000', 'SMD_R', 'R1', '90.000', ''],
     ['SOIC', 'YES', 'VDD', '1', '29.0000', '19.0000', 'SMD_OCT', 'U2', '0.000', ''],
     ['SOIC', 'YES', 'IO', '2', '31.0000', '19.0000', 'SMD_SQ', 'U2', '45.000', ''],
     ['SOIC', 'YES', 'NC', '10', '31.0000', '21.0000', 'SMD_R', 'U2', '0.000', ''],
     ['CONN', 'NO', '1', '1', '50.0000', '10.0000', 'SLOT', 'J3', '0.000', ''],
     ['CONN', 'NO', '2', '2', '52.0000', '10.0000', 'MISSING', 'J3', '0.000', ''],
     ['TP', 'NO', '1', '1', '80.0000', '40.0000', 'VIA_TB', 'TP7', '0.000', ''],
     ['TP', 'NO', '2', '2', '84.0000', '44.0000', 'BAD', 'TP7', '0.000', ''],
     ['FID', 'NO', '1', '1', '90.0000', '5.0000', 'SMD_OCT', '', '0.000', '']])

GH = ['GRAPHIC_DATA_NAME', 'GRAPHIC_DATA_NUMBER', 'RECORD_TAG', 'GRAPHIC_DATA_1', 'GRAPHIC_DATA_2', 'GRAPHIC_DATA_3', 'GRAPHIC_DATA_4', 'GRAPHIC_DATA_5', 'GRAPHIC_DATA_6', 'GRAPHIC_DATA_7', 'GRAPHIC_DATA_8', 'GRAPHIC_DATA_9', 'SUBCLASS', 'SYM_NAME', 'REFDES']
def g(name, tag, d, sub, sym='', ref=''):
    d = d + [''] * (9 - len(d))
    return [name, '1', tag] + d + [sub, sym, ref]
TXT = '0 1 1.0000 0.8000 0.0000 0.0000 0.0000 0.1000'
sec(GH, [
    g('LINE', '10 1', ['-5.0000', '-5.0000', '95.0000', '-5.0000', '0.1500'], 'SILKSCREEN_TOP'),
    g('FIG_RECTANGLE', '11 1', ['40.0000', '40.0000', '6.0000', '3.0000', '1'], 'ASSEMBLY_TOP'),
    g('DIAMOND', '12 1', ['45.0000', '40.0000', '2.0000', '2.0000', '0.1000'], 'SILKSCREEN_TOP'),
    g('HEXAGON_Y', '13 1', ['48.0000', '40.0000', '2.0000', '2.0000', '0.1000'], 'SOLDERMASK_TOP'),
    g('CIRCLE', '14 1', ['52.0000', '40.0000', '2.0000', '3.0000', '0.1000'], 'SILKSCREEN_TOP'),
    g('CIRCLE', '15 1', ['56.0000', '40.0000', '2.0000', '2.0000', '0.0000'], 'SILKSCREEN_TOP'),
    g('TEXT', '16 1', ['60.0000', '40.0000', '180.000', 'YES', 'RIGHT', TXT, 'SYNTH'], 'TITLE_DATA'),
    g('TEXT', '17 1', ['60.0000', '44.0000', '270.000', 'NO', 'CENTER', '0 1 1.0', 'SHORT'], 'NCLEGEND-1-4'),
    g('LINE', '20 1', ['29.0000', '21.0000', '31.0000', '21.0000', '0.1200'], 'SILKSCREEN_TOP', 'SOIC', 'U2'),
    g('ARC', '21 1', ['29.0000', '22.0000', '31.0000', '22.0000', '30.0000', '22.0000', '1.0000', '0.1200', 'CLOCKWISE'], 'SILKSCREEN_TOP', 'SOIC', 'U2'),
    g('CIRCLE', '22 1', ['30.0000', '18.0000', '0.5000', '0.5000', '0.1000'], 'SILKSCREEN_BOTTOM', 'SOIC', 'U2'),
    g('RECTANGLE', '23 1', ['28.0000', '17.0000', '32.0000', '23.0000', '0'], 'ASSEMBLY_TOP', 'SOIC', 'U2'),
    g('TEXT', '24 1', ['30.0000', '24.0000', '0.000', 'NO', 'LEFT', TXT, 'SOIC-8'], 'ASSEMBLY_TOP', 'SOIC', 'U2'),
    g('TEXT', '25 1', ['30.0000', '16.0000', '90.000', 'NO', 'LEFT', TXT, 'PIN1'], 'SILKSCREEN_TOP', 'SOIC', 'U2'),
    g('LINE', '26 1', ['9.0000', '19.0000', '11.0000', '19.0000', '0'], 'SILKSCREEN_TOP', 'RES0603', 'R1'),
    g('ARC', '27 1', ['9.0000', '21.0000', '11.0000', '21.0000', '10.0000', '21.0000', '1.0000', '0.1000', 'COUNTERCLOCKWISE'], 'ASSEMBLY_BOTTOM', 'RES0603', 'R1'),
])

TH = ['CLASS', 'SUBCLASS', 'GRAPHIC_DATA_NAME', 'GRAPHIC_DATA_NUMBER', 'RECORD_TAG', 'GRAPHIC_DATA_1', 'GRAPHIC_DATA_2', 'GRAPHIC_DATA_3', 'GRAPHIC_DATA_4', 'GRAPHIC_DATA_5', 'GRAPHIC_DATA_6', 'GRAPHIC_DATA_7', 'GRAPHIC_DATA_8', 'GRAPHIC_DATA_9', 'NET_NAME']
def t(cls, sub, name, tag, d, net=''):
    d = d + [''] * (9 - len(d))
    return [cls, sub, name, '1', tag] + d + [net]
sq = lambda x0, y0, x1, y1: [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]
rows = [
    t('ETCH', 'TOP', 'LINE', '100 1', ['9.2000', '20.0000', '29.0000', '19.0000', '0.2000'], 'VCC'),
    t('ETCH', 'TOP', 'ARC', '100 2', ['29.0000', '19.0000', '31.0000', '19.0000', '30.0000', '19.0000', '1.0000', '0.2000', 'COUNTERCLOCKWISE'], 'VCC'),
    t('ETCH', 'INNER1', 'LINE', '101 1', ['10.0000', '30.0000', '40.0000', '30.0000', '0.3000'], 'SIG'),
    t('ETCH', 'INNER1', 'RECTANGLE', '101 2', ['10.0000', '31.0000', '12.0000', '33.0000', '0'], 'SIG'),
    t('ETCH', 'BOTTOM', 'LINE', '102 1', ['10.0000', '40.0000', '40.0000', '40.0000', '0.2500'], 'GND'),
    t('REF DES', 'SILKSCREEN_TOP', 'TEXT', '103 1', ['10.0000', '22.0000', '90.000', 'NO', 'LEFT', TXT, 'R1']),
    t('REF DES', 'ASSEMBLY_TOP', 'TEXT', '104 1', ['10.0000', '23.0000', '0.000', 'NO', 'CENTER', TXT, 'R1']),
    t('REF DES', 'SILKSCREEN_BOTTOM', 'TEXT', '105 1', ['30.0000', '25.0000', '0.000', 'NO', 'LEFT', TXT, 'U2']),
    t('REF DES', 'NOWHERE', 'TEXT', '106 1', ['50.0000', '12.0000', '0.000', 'NO', 'LEFT', TXT, 'J3']),
    t('COMPONENT VALUE', 'ASSEMBLY_TOP', 'TEXT', '107 1', ['10.0000', '24.0000', '0.000', 'NO', 'LEFT', TXT, '10K']),
    t('BOARD GEOMETRY', 'DIMENSION', 'LINE', '108 1', ['0.0000', '-8.0000', '90.0000', '-8.0000', '0.1000']),
    t('DRAWING FORMAT', 'OUTLINE', 'LINE', '109 1', ['0.0000', '-9.0000', '90.0000', '-9.0000', '0.1000']),
    t('BOARD GEOMETRY', 'ASSEMBLY_TOP', 'CROSS', '110 1', ['70.0000', '10.0000', '2.0000', '2.0000', '0.1000']),
    t('BOARD GEOMETRY', 'ASSEMBLY_TOP', 'OBLONG_X', '111 1', ['75.0000', '10.0000', '4.0000', '1.0000', '0.1000']),
]
i = 1
for (x0, y0, x1, y1) in sq('0.0000', '0.0000', '90.0000', '60.0000'):
    rows.append(t('BOARD GEOMETRY', 'OUTLINE', 'LINE', f'200 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('60.0000', '20.0000', '80.0000', '35.0000'):
    rows.append(t('ETCH', 'TOP', 'LINE', f'201 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
for (x0, y0, x1, y1) in sq('65.0000', '25.0000', '70.0000', '30.0000'):
    rows.append(t('ETCH', 'TOP', 'LINE', f'201 {i} 1', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('61.0000', '21.0000', '79.0000', '34.0000'):
    rows.append(t('ETCH', 'TOP', 'LINE', f'202 {i}', [x0, y0, x1, y1, '0.0000'], 'GND')); i += 1
i = 1
for (x0, y0, x1, y1) in sq('5.0000', '45.0000', '15.0000', '55.0000'):
    rows.append(t('ROUTE KEEPOUT', 'ALL', 'LINE', f'203 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('20.0000', '45.0000', '30.0000', '55.0000'):
    rows.append(t('VIA KEEPOUT', 'OUTER_LAYERS', 'LINE', f'204 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('35.0000', '45.0000', '45.0000', '55.0000'):
    rows.append(t('CONSTRAINT REGION', 'INNER_SIGNAL_LAYERS', 'LINE', f'205 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('50.0000', '45.0000', '55.0000', '50.0000'):
    rows.append(t('BOARD GEOMETRY', 'SILKSCREEN_TOP', 'LINE', f'206 {i}', [x0, y0, x1, y1, '0.0000'])); i += 1
i = 1
for (x0, y0, x1, y1) in sq('56.0000', '45.0000', '58.0000', '47.0000'):
    rows.append(t('BOARD GEOMETRY', 'ASSEMBLY_TOP', 'LINE', f'207 {i}', [x0, y0, x1, y1, '0.1000'])); i += 1
sec(TH, rows)

sec(['VIA_X', 'VIA_Y', 'PAD_STACK_NAME', 'NET_NAME', 'TEST_POINT', 'VIA_MIRROR'],
    [['20.0000', '30.0000', 'VIA_TI', 'SIG', '', 'NO'],
     ['25.0000', '30.0000', 'VIA_II', 'SIG', '', 'NO'],
     ['30.0000', '40.0000', 'VIA_TB', 'GND', 'YES', 'NO'],
     ['35.0000', '40.0000', 'NOPAD', 'NOSUCH', '', 'NO']])

open(out, 'w').write('\n'.join(L) + '\n')
