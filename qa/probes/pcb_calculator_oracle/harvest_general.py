import json, time, oracle as O
from gi.repository import Atspi
R = {}
def rd(key,*paths): return {p: O.txt(O.pat(key,p)) for p in paths}
def click(n): Atspi.Action.do_action(n,0); time.sleep(0.9)

# ---------------- Cable Size ----------------
k='cable_size'
O.choose(O.pat(k,'0.0.4'),'mm'); O.set_text(O.pat(k,'0.0.3'),'1')
O.set_text(O.pat(k,'0.0.9'),'1.72e-08'); O.set_text(O.pat(k,'0.0.13'),'3.93e-3')
O.choose(O.pat(k,'0.0.17'),'Ω/m'); O.choose(O.pat(k,'0.0.20'),'GHz')
O.set_text(O.pat(k,'1.0.1'),'20'); O.set_text(O.pat(k,'1.0.4'),'1')
O.choose(O.pat(k,'1.0.8'),'cm'); O.set_text(O.pat(k,'1.0.7'),'100')
O.choose(O.pat(k,'1.0.14'),'mV'); O.choose(O.pat(k,'1.0.17'),'mW')
time.sleep(1.2)
R['cable_size/d1mm_20C_1A_100cm'] = rd(k,'0.0.6','0.0.16','0.0.19','0.0.22','1.0.10','1.0.13','1.0.16')
O.choose(O.pat(k,'0.0.17'),'Ω/km'); O.choose(O.pat(k,'0.0.20'),'Hz')
O.choose(O.pat(k,'1.0.14'),'V'); O.choose(O.pat(k,'1.0.17'),'W'); time.sleep(1.2)
R['cable_size/units_switched'] = rd(k,'0.0.16','0.0.19','1.0.10','1.0.13','1.0.16')
O.choose(O.pat(k,'0.0.17'),'Ω/m'); O.choose(O.pat(k,'0.0.20'),'GHz')
O.choose(O.pat(k,'1.0.14'),'mV'); O.choose(O.pat(k,'1.0.17'),'mW')
# AWG standard size drives the diameter
O.choose(O.pat(k,'0.0.1'),'AWG12'); time.sleep(1.2)
R['cable_size/AWG12'] = rd(k,'0.0.3','0.0.6','0.0.16','0.0.19','0.0.22','1.0.10','1.0.13','1.0.16')

# ---------------- Fusing Current ----------------
k='fusing_current'
O.set_text(O.pat(k,'2'),'25'); O.set_text(O.pat(k,'6'),'1084')
O.choose(O.pat(k,'11'),'mm'); O.set_text(O.pat(k,'10'),'0.100000')
O.choose(O.pat(k,'15'),'mm'); O.set_text(O.pat(k,'14'),'0.035000')
O.set_text(O.pat(k,'18'),'10.000000'); O.set_text(O.pat(k,'22'),'0.010000')
click(O.pat(k,'8'))          # solve for track width
click(O.pat(k,'24'))         # Calculate
R['fusing_current/solve_width'] = dict(rd(k,'10','14','18','22'), msg=O.nm(O.pat(k,'25')))
click(O.pat(k,'12')); click(O.pat(k,'24'))   # solve for thickness
R['fusing_current/solve_thickness'] = dict(rd(k,'10','14','18','22'), msg=O.nm(O.pat(k,'25')))
click(O.pat(k,'16')); click(O.pat(k,'24'))   # solve for current
R['fusing_current/solve_current'] = dict(rd(k,'10','14','18','22'), msg=O.nm(O.pat(k,'25')))
click(O.pat(k,'20')); click(O.pat(k,'24'))   # solve for time
R['fusing_current/solve_time'] = dict(rd(k,'10','14','18','22'), msg=O.nm(O.pat(k,'25')))
# thickness in oz/ft^2, solve for current
click(O.pat(k,'16')); O.choose(O.pat(k,'15'),'oz/ft²'); O.set_text(O.pat(k,'14'),'1')
click(O.pat(k,'24'))
R['fusing_current/solve_current_1oz'] = dict(rd(k,'10','14','18','22'))

# ---------------- RF Attenuators ----------------
k='rf_attenuators'
for idx, label in [('0.0.3','Pi'), ('0.0.2','Tee'), ('0.0.1','Bridged tee'), ('0.0.0','Resistive splitter')]:
    click(O.pat(k,idx))
    O.set_text(O.pat(k,'2.0.1'),'6'); O.set_text(O.pat(k,'2.0.4'),'50')
    try: O.set_text(O.pat(k,'2.0.7'),'50')
    except Exception: pass
    click(O.pat(k,'3'))
    R['rf_attenuators/%s_a6_50_50' % label.replace(' ','_')] = rd(k,'5.0.1','5.0.4','5.0.7')
# asymmetric Tee
click(O.pat(k,'0.0.2'))
O.set_text(O.pat(k,'2.0.1'),'10'); O.set_text(O.pat(k,'2.0.4'),'75'); O.set_text(O.pat(k,'2.0.7'),'50')
click(O.pat(k,'3'))
R['rf_attenuators/Tee_a10_75_50'] = rd(k,'5.0.1','5.0.4','5.0.7')

# ---------------- Resistor Calculator ----------------
k='r_calculator'
click(O.pat(k,'0.0.12'))                       # E6
O.set_text(O.pat(k,'0.0.1'),'3.65')
O.set_text(O.pat(k,'0.0.4'),''); O.set_text(O.pat(k,'0.0.7'),'')
click(O.pat(k,'1.0.16'))
R['r_calculator/E6_3.65k'] = rd(k,'1.0.1','1.0.3','1.0.6','1.0.8','1.0.11','1.0.13')
click(O.pat(k,'0.0.14'))                       # E24
O.set_text(O.pat(k,'0.0.1'),'3.65'); click(O.pat(k,'1.0.16'))
R['r_calculator/E24_3.65k'] = rd(k,'1.0.1','1.0.3','1.0.6','1.0.8','1.0.11','1.0.13')
click(O.pat(k,'0.0.11'))                       # E3
O.set_text(O.pat(k,'0.0.1'),'3.65'); click(O.pat(k,'1.0.16'))
R['r_calculator/E3_3.65k'] = rd(k,'1.0.1','1.0.3','1.0.6','1.0.8','1.0.11','1.0.13')

# ---------------- Regulators ----------------
k='regulators'
O.choose(O.pat(k,'1'),'3 Terminal Type'); time.sleep(0.5)
O.set_text(O.pat(k,'12'),'0.240'); O.set_text(O.pat(k,'18'),'0.720')
O.set_text(O.pat(k,'28'),'1.20'); O.set_text(O.pat(k,'29'),'1.25'); O.set_text(O.pat(k,'30'),'1.30')
O.set_text(O.pat(k,'33'),'50'); O.set_text(O.pat(k,'34'),'100'); O.set_text(O.pat(k,'41'),'1')
click(O.pat(k,'21'))     # solve for Vout
click(O.pat(k,'47'))
R['regulators/3term_vout'] = dict(rd(k,'11','12','13','17','18','19','23','24','25','37','38'),
                                  power=O.txt(O.pat(k,'44')), msg=O.nm(O.pat(k,'46')))
click(O.pat(k,'15'))     # solve for R2
O.set_text(O.pat(k,'24'),'5'); click(O.pat(k,'47'))
R['regulators/3term_r2'] = dict(rd(k,'11','12','13','17','18','19','23','24','25','37','38'))
click(O.pat(k,'9'))      # solve for R1
O.set_text(O.pat(k,'24'),'5'); O.set_text(O.pat(k,'18'),'0.720'); click(O.pat(k,'47'))
R['regulators/3term_r1'] = dict(rd(k,'11','12','13','17','18','19','23','24','25','37','38'))

print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_2.json','w'), indent=1, ensure_ascii=False)
