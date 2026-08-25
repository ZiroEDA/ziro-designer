import json, time, oracle as O
from gi.repository import Atspi
R={}; k='transline'
def click(n): Atspi.Action.do_action(n,0); time.sleep(1.0)
def rwg(a,b,L,f,er,mur):
    click(O.pat(k,'0.0.2'))     # Rectangular Waveguide
    O.set_text(O.pat(k,'2.0.1'),er); O.set_text(O.pat(k,'2.0.4'),'0.02')
    O.set_text(O.pat(k,'2.0.7'),'1.72e-08')
    O.set_text(O.pat(k,'2.0.11'),mur)     # mu(insulator)
    O.set_text(O.pat(k,'2.0.14'),'1')     # mu(conductor)
    O.choose(O.pat(k,'3.0.2'),'GHz'); O.set_text(O.pat(k,'3.0.1'),f)
    O.choose(O.pat(k,'5.0.2'),'mm'); O.set_text(O.pat(k,'5.0.1'),a)
    O.choose(O.pat(k,'5.0.6'),'mm'); O.set_text(O.pat(k,'5.0.5'),b)
    O.choose(O.pat(k,'5.0.10'),'mm'); O.set_text(O.pat(k,'5.0.9'),L)
    O.choose(O.pat(k,'10.0.8'),'rad')
    click(O.pat(k,'6'))
    return {'Z0': O.txt(O.pat(k,'10.0.1')), 'Ang_l': O.txt(O.pat(k,'10.0.7')),
            'results': {('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(12)}}
R['rectwaveguide/WR90_10GHz_er4.5'] = rwg('22.86','10.16','50','10','4.5','1')
R['rectwaveguide/WR90_10GHz_air']   = rwg('22.86','10.16','50','10','1','1')
R['rectwaveguide/a10_b5_1GHz_er4.5'] = rwg('10','5','50','1','4.5','1')
print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_7.json','w'), indent=1, ensure_ascii=False)
