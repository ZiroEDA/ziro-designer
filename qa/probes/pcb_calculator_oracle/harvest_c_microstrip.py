import json, time, oracle as O
from gi.repository import Atspi
R={}; k='transline'
def click(n): Atspi.Action.do_action(n,0); time.sleep(1.0)

def cms(er, W, S, H, T, L, f='1'):
    click(O.pat(k,'0.0.7'))          # Coupled Microstrip Line
    O.set_text(O.pat(k,'2.0.1'),er); O.set_text(O.pat(k,'2.0.4'),'0.02')
    O.set_text(O.pat(k,'2.0.7'),'1.72e-08')
    O.choose(O.pat(k,'2.0.12'),'mm'); O.set_text(O.pat(k,'2.0.11'),H)      # H
    O.choose(O.pat(k,'2.0.15'),'mm'); O.set_text(O.pat(k,'2.0.14'),'1e+20')# H_t
    O.choose(O.pat(k,'2.0.18'),'mm'); O.set_text(O.pat(k,'2.0.17'),T)      # T
    O.choose(O.pat(k,'2.0.21'),'mm'); O.set_text(O.pat(k,'2.0.20'),'0')    # Rough
    O.set_text(O.pat(k,'2.0.23'),'1')                                      # mu cond
    O.choose(O.pat(k,'3.0.2'),'GHz'); O.set_text(O.pat(k,'3.0.1'),f)
    O.choose(O.pat(k,'5.0.2'),'mm'); O.set_text(O.pat(k,'5.0.1'),W)        # W
    O.choose(O.pat(k,'5.0.6'),'mm'); O.set_text(O.pat(k,'5.0.5'),S)        # S
    O.choose(O.pat(k,'5.0.10'),'mm'); O.set_text(O.pat(k,'5.0.9'),L)       # L
    click(O.pat(k,'6'))
    return {'Zeven': O.txt(O.pat(k,'10.0.1')), 'Zodd': O.txt(O.pat(k,'10.0.4')),
            'Ang_l': O.txt(O.pat(k,'10.0.7')),
            'results': {('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(20)}}

R['c_microstrip/er4.3_W0.3_S0.2_H1.6_T0.035_L100'] = cms('4.3','0.3','0.2','1.6','0.035','100')
R['c_microstrip/er4.5_W0.3_S0.2_H0.2_T0.035_L50']  = cms('4.5','0.3','0.2','0.2','0.035','50')
print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_6.json','w'), indent=1, ensure_ascii=False)
