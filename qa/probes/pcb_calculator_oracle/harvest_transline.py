import json, time, oracle as O
from gi.repository import Atspi
R={}
k='transline'
def click(n): Atspi.Action.do_action(n,0); time.sleep(1.0)
def rd(*paths): return {p: O.txt(O.pat(k,p)) for p in paths}
def labels():
    out={}
    for i in range(0,28):
        L=O.nm(O.pat(k,'2.0.%d'%i)) if O.role(O.pat(k,'2.0.%d'%i))=='label' else None
        if L: out['2.0.%d'%i]=L
    for i in range(0,11):
        n=O.pat(k,'5.0.%d'%i)
        if O.role(n)=='label' and O.nm(n): out['5.0.%d'%i]=O.nm(n)
    for i in range(0,9):
        n=O.pat(k,'10.0.%d'%i)
        if O.role(n)=='label' and O.nm(n): out['10.0.%d'%i]=O.nm(n)
    for i in range(0,20):
        n=O.pat(k,'11.0.%d'%i)
        if O.role(n)=='label' and O.nm(n): out['11.0.%d'%i]=O.nm(n)
    return out

TYPES = [('0.0.8','MicroStrip'), ('0.0.7','CoupledMicroStrip'), ('0.0.6','StripLine'),
         ('0.0.5','CoupledStripLine'), ('0.0.4','CoPlanar'), ('0.0.3','GrCoPlanar'),
         ('0.0.2','RectWaveGuide'), ('0.0.1','Coax'), ('0.0.0','TwistedPair')]

for idx, name in TYPES:
    click(O.pat(k, idx))
    click(O.pat(k, '6'))   # Analyze with whatever the panel loaded
    ent = {'labels': labels()}
    ent['substrate'] = {p: O.txt(O.pat(k,p)) for p in
                        ['2.0.1','2.0.4','2.0.7','2.0.11','2.0.14','2.0.17','2.0.20','2.0.23','2.0.26']}
    ent['freq'] = O.txt(O.pat(k,'3.0.1'))
    ent['physical'] = {p: O.txt(O.pat(k,p)) for p in ['5.0.1','5.0.5','5.0.9']}
    ent['electrical'] = {p: O.txt(O.pat(k,p)) for p in ['10.0.1','10.0.4','10.0.7']}
    ent['results'] = {('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(0,20)}
    R['transline/%s/analyze_defaults' % name] = ent

# --- Stripline: does `a` reach the engine? ---
click(O.pat(k,'0.0.6'))
O.set_text(O.pat(k,'2.0.11'),'0.2'); O.set_text(O.pat(k,'2.0.14'),'0.2')
O.set_text(O.pat(k,'5.0.1'),'0.2'); click(O.pat(k,'6'))
R['transline/StripLine/a_0.2'] = dict(rd('10.0.1','10.0.7'),
    results={('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(0,10)})
O.set_text(O.pat(k,'2.0.14'),'0.5'); click(O.pat(k,'6'))
R['transline/StripLine/a_0.5'] = dict(rd('10.0.1','10.0.7'),
    results={('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(0,10)})
O.set_text(O.pat(k,'2.0.14'),'0.05'); click(O.pat(k,'6'))
R['transline/StripLine/a_0.05'] = dict(rd('10.0.1','10.0.7'))

# --- Microstrip: a realistic 50-ohm-ish analyze, then synthesize ---
click(O.pat(k,'0.0.8'))
O.set_text(O.pat(k,'2.0.1'),'4.6'); O.set_text(O.pat(k,'2.0.4'),'0.02')
O.set_text(O.pat(k,'2.0.7'),'1.72e-08'); O.set_text(O.pat(k,'2.0.11'),'1.6')
O.set_text(O.pat(k,'2.0.17'),'0.035'); O.set_text(O.pat(k,'2.0.20'),'0')
O.set_text(O.pat(k,'3.0.1'),'1')
O.set_text(O.pat(k,'5.0.1'),'3.0'); O.set_text(O.pat(k,'5.0.5'),'50')
click(O.pat(k,'6'))
R['transline/MicroStrip/analyze_W3_H1.6_er4.6'] = dict(
    rd('10.0.1','10.0.7'),
    results={('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(0,10)})
O.set_text(O.pat(k,'10.0.1'),'50'); O.set_text(O.pat(k,'10.0.7'),'90')
Atspi.Action.do_action(O.pat(k,'10.0.8').get_child_at_index(0).get_child_at_index(1),0); time.sleep(0.6)
click(O.pat(k,'5.0.3')); click(O.pat(k,'5.0.7'))   # let W and L both be synthesized
click(O.pat(k,'8'))
R['transline/MicroStrip/synth_Z50_ang90deg'] = dict(rd('5.0.1','5.0.5','10.0.1','10.0.7'))

# --- switching type must not wipe the parameters ---
click(O.pat(k,'0.0.8')); O.set_text(O.pat(k,'2.0.1'),'3.38'); click(O.pat(k,'6'))
before = O.txt(O.pat(k,'2.0.1'))
click(O.pat(k,'0.0.6')); click(O.pat(k,'0.0.8'))
R['transline/type_switch_keeps_er'] = {'before': before, 'after': O.txt(O.pat(k,'2.0.1'))}

print(json.dumps(R, indent=1, ensure_ascii=False)[:2000])
json.dump(R, open('kicad_answers_3.json','w'), indent=1, ensure_ascii=False)
print('OK')
