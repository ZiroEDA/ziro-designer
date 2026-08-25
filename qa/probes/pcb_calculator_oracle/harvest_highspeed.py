import json, time, oracle as O
from gi.repository import Atspi
R={}
k='transline'
def click(n): Atspi.Action.do_action(n,0); time.sleep(1.0)
def res(n=10): return {('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(n)}

# Stripline with a geometry that gives finite answers, sweeping `a`.
click(O.pat(k,'0.0.6'))
O.set_text(O.pat(k,'2.0.1'),'4.5'); O.set_text(O.pat(k,'2.0.4'),'0.02')
O.set_text(O.pat(k,'2.0.7'),'1.72e-08')
O.set_text(O.pat(k,'2.0.11'),'1.6')      # H
O.set_text(O.pat(k,'2.0.17'),'0.035')    # T
O.set_text(O.pat(k,'2.0.20'),'1')        # mu conductor
O.set_text(O.pat(k,'3.0.1'),'1')         # 1 GHz
O.set_text(O.pat(k,'5.0.1'),'0.3')       # W
O.set_text(O.pat(k,'5.0.5'),'50')        # L
for a in ['0.8','0.4','0.2']:
    O.set_text(O.pat(k,'2.0.14'), a)
    click(O.pat(k,'6'))
    R['transline/StripLine/H1.6_W0.3_a%s' % a] = {
        'Z0': O.txt(O.pat(k,'10.0.1')), 'Ang_l': O.txt(O.pat(k,'10.0.7')),
        'results': res()}

# Microstrip synthesize
click(O.pat(k,'0.0.8'))
O.set_text(O.pat(k,'2.0.1'),'4.6'); O.set_text(O.pat(k,'2.0.4'),'0.02')
O.set_text(O.pat(k,'2.0.7'),'1.72e-08'); O.set_text(O.pat(k,'2.0.11'),'1.6')
O.set_text(O.pat(k,'2.0.14'),'1e+20'); O.set_text(O.pat(k,'2.0.17'),'0.035')
O.set_text(O.pat(k,'2.0.20'),'0'); O.set_text(O.pat(k,'2.0.23'),'1'); O.set_text(O.pat(k,'2.0.26'),'1')
O.set_text(O.pat(k,'3.0.1'),'1')
O.set_text(O.pat(k,'10.0.1'),'50'); O.set_text(O.pat(k,'10.0.7'),'90')
O.choose(O.pat(k,'10.0.8'),'deg')
click(O.pat(k,'8'))
R['transline/MicroStrip/synth_50ohm_90deg'] = {
    'W': O.txt(O.pat(k,'5.0.1')), 'L': O.txt(O.pat(k,'5.0.5')),
    'Z0': O.txt(O.pat(k,'10.0.1')), 'Ang_l': O.txt(O.pat(k,'10.0.7')), 'results': res()}
O.choose(O.pat(k,'10.0.8'),'rad')

# Microstrip analyze with the substrate in mil
click(O.pat(k,'0.0.8'))
O.set_text(O.pat(k,'2.0.11'),'1.6'); O.choose(O.pat(k,'2.0.12'),'mil')
O.set_text(O.pat(k,'5.0.1'),'3.0'); O.choose(O.pat(k,'5.0.2'),'mm')
click(O.pat(k,'6'))
R['transline/MicroStrip/H_1.6mil'] = {'H': O.txt(O.pat(k,'2.0.11')),
    'Z0': O.txt(O.pat(k,'10.0.1')), 'Ang_l': O.txt(O.pat(k,'10.0.7')), 'results': res()}
O.choose(O.pat(k,'2.0.12'),'mm')

# Frequency in MHz rather than GHz
O.set_text(O.pat(k,'2.0.11'),'1.6')
O.set_text(O.pat(k,'3.0.1'),'1000'); O.choose(O.pat(k,'3.0.2'),'MHz')
click(O.pat(k,'6'))
R['transline/MicroStrip/f_1000MHz'] = {'Z0': O.txt(O.pat(k,'10.0.1')),
    'Ang_l': O.txt(O.pat(k,'10.0.7')), 'results': res()}
O.choose(O.pat(k,'3.0.2'),'GHz'); O.set_text(O.pat(k,'3.0.1'),'1')

# --- RF attenuator: attenuation below the minimum a bridged tee/splitter allows
k2='rf_attenuators'
Atspi.Action.do_action(O.pat(k2,'0.0.0'),0); time.sleep(0.8)   # Resistive splitter
O.set_text(O.pat(k2,'2.0.1'),'3')
Atspi.Action.do_action(O.pat(k2,'3'),0); time.sleep(0.8)
R['rf_attenuators/splitter_a3_error'] = {
    'R1': O.txt(O.pat(k2,'5.0.1')), 'R2': O.txt(O.pat(k2,'5.0.4')), 'R3': O.txt(O.pat(k2,'5.0.7')),
    'atten_field': O.txt(O.pat(k2,'2.0.1')), 'zin_field': O.txt(O.pat(k2,'2.0.4'))}
Atspi.Action.do_action(O.pat(k2,'0.0.2'),0); time.sleep(0.8)   # Tee
O.set_text(O.pat(k2,'2.0.1'),'0.5'); O.set_text(O.pat(k2,'2.0.4'),'50'); O.set_text(O.pat(k2,'2.0.7'),'75')
Atspi.Action.do_action(O.pat(k2,'3'),0); time.sleep(0.8)
R['rf_attenuators/tee_a0.5_too_low'] = {
    'R1': O.txt(O.pat(k2,'5.0.1')), 'R2': O.txt(O.pat(k2,'5.0.4')), 'R3': O.txt(O.pat(k2,'5.0.7'))}

print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_4.json','w'), indent=1, ensure_ascii=False)
