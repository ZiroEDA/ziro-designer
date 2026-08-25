import json, time, oracle as O

R = {}

def rd(key, *paths):
    return {p: O.txt(O.pat(key, p)) for p in paths}

# ---------------- Track Width ----------------
k='track_width'
O.set_text(O.pat(k,'0.0.1'), '5')        # Current 5 A
O.set_text(O.pat(k,'0.0.4'), '10')       # dT 10 C
O.set_text(O.pat(k,'0.0.7'), '20')       # length 20
O.choose(O.pat(k,'0.0.8'), 'mm')
O.set_text(O.pat(k,'0.0.10'), '1.72e-08')
O.choose(O.pat(k,'2.0.5'), 'µm'); O.set_text(O.pat(k,'2.0.4'), '35')
O.choose(O.pat(k,'3.0.5'), 'µm'); O.set_text(O.pat(k,'3.0.4'), '35')
time.sleep(1.0)
R['track_width/current_5A_mm'] = rd(k,'2.0.1','2.0.10','2.0.13','2.0.16','2.0.19',
                                      '3.0.1','3.0.10','3.0.13','3.0.16','3.0.19')
# unit switch: conductor length now read as INCH (KiCad recalculates, does not convert)
O.choose(O.pat(k,'0.0.8'), 'inch'); time.sleep(1.0)
R['track_width/len_unit_inch'] = dict(rd(k,'0.0.7','2.0.1','2.0.10','2.0.13','2.0.16','2.0.19'))
O.choose(O.pat(k,'0.0.8'), 'mm'); time.sleep(0.6)
# unit switch: external thickness in oz/ft^2
O.choose(O.pat(k,'2.0.5'), 'oz/ft²'); O.set_text(O.pat(k,'2.0.4'), '1'); time.sleep(1.0)
R['track_width/ext_thickness_1oz'] = rd(k,'2.0.4','2.0.1','2.0.10','2.0.13')
# width-driven direction: type a width, current follows
O.choose(O.pat(k,'2.0.5'), 'µm'); O.set_text(O.pat(k,'2.0.4'), '35'); time.sleep(0.5)
O.set_text(O.pat(k,'2.0.1'), '1.0'); time.sleep(1.0)
R['track_width/ext_width_1mm_drives_current'] = dict(rd(k,'0.0.1','2.0.10','2.0.13','3.0.1'))

# ---------------- Via Size ----------------
k='via_size'
for path, v in [('0.0.1','0.4'),('0.0.4','0.035'),('0.0.7','1.6'),('0.0.10','0.6'),
                ('0.0.13','1.0'),('0.0.16','50'),('0.0.19','1'),('0.0.22','6.9e-8'),
                ('0.0.26','4.5'),('0.0.29','10'),('0.0.32','1')]:
    O.set_text(O.pat(k,path), v)
for c in ['0.0.2','0.0.5','0.0.8','0.0.11','0.0.14']:
    O.choose(O.pat(k,c), 'mm')
O.choose(O.pat(k,'0.0.17'), 'Ω')
time.sleep(1.2)
R['via_size/defaults'] = rd(k,'2.0.1','2.0.4','2.0.7','2.0.10','2.0.13','2.0.16','2.0.19','2.0.22','2.0.25')
# unit switch: hole diameter now read in mil
O.choose(O.pat(k,'0.0.2'), 'mil'); time.sleep(1.2)
R['via_size/hole_unit_mil'] = dict(rd(k,'0.0.1','2.0.1','2.0.10','2.0.13','2.0.16','2.0.19','2.0.22','2.0.25'))
O.choose(O.pat(k,'0.0.2'), 'mm'); time.sleep(0.6)
# Z0 in kohm
O.choose(O.pat(k,'0.0.17'), 'kΩ'); O.set_text(O.pat(k,'0.0.16'), '0.05'); time.sleep(1.2)
R['via_size/z0_kohm'] = rd(k,'2.0.19','2.0.22','2.0.25')

# ---------------- Wavelength ----------------
k='wavelength'
O.choose(O.pat(k,'2'), 'GHz'); O.set_text(O.pat(k,'1'), '1')
O.set_text(O.pat(k,'16'), '4.5'); O.set_text(O.pat(k,'19'), '1')
for c,u in [('5','ns'),('8','cm'),('11','cm'),('14','m/s')]:
    O.choose(O.pat(k,c), u)
time.sleep(1.2)
R['wavelength/1GHz_er4.5'] = rd(k,'4','7','10','13')
O.choose(O.pat(k,'14'), 'mi/h'); time.sleep(1.0)
R['wavelength/speed_mi_per_h'] = rd(k,'13')
O.choose(O.pat(k,'8'), 'inch'); O.choose(O.pat(k,'11'), 'feet'); time.sleep(1.0)
R['wavelength/lambda_inch_feet'] = rd(k,'7','10')
O.choose(O.pat(k,'14'), 'm/s'); O.choose(O.pat(k,'8'),'cm'); O.choose(O.pat(k,'11'),'cm')
# period drives frequency
O.choose(O.pat(k,'5'),'ps'); O.set_text(O.pat(k,'4'), '500'); time.sleep(1.0)
R['wavelength/period_500ps_drives_freq'] = rd(k,'1','7','10','13')

print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_1.json','w'), indent=1, ensure_ascii=False)
