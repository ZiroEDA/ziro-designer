import json, time, oracle as O
from gi.repository import Atspi
R={}; k='transline'
def click(n): Atspi.Action.do_action(n,0); time.sleep(1.0)
def res(n=10): return {('11.0.%d'%i): O.txt(O.pat(k,'11.0.%d'%i)) for i in range(n)}

def microstrip(H='1.6', Hunit='mm', W='3.0', Wunit='mm', L='50', f='1', funit='GHz', er='4.6'):
    click(O.pat(k,'0.0.8'))
    O.set_text(O.pat(k,'2.0.1'),er); O.set_text(O.pat(k,'2.0.4'),'0.02')
    O.set_text(O.pat(k,'2.0.7'),'1.72e-08')
    O.choose(O.pat(k,'2.0.12'),Hunit); O.set_text(O.pat(k,'2.0.11'),H)
    O.choose(O.pat(k,'2.0.15'),'mm'); O.set_text(O.pat(k,'2.0.14'),'1e+20')
    O.choose(O.pat(k,'2.0.18'),'mm'); O.set_text(O.pat(k,'2.0.17'),'0.035')
    O.choose(O.pat(k,'2.0.21'),'mm'); O.set_text(O.pat(k,'2.0.20'),'0')
    O.set_text(O.pat(k,'2.0.23'),'1'); O.set_text(O.pat(k,'2.0.26'),'1')
    O.choose(O.pat(k,'3.0.2'),funit); O.set_text(O.pat(k,'3.0.1'),f)
    O.choose(O.pat(k,'5.0.2'),Wunit); O.set_text(O.pat(k,'5.0.1'),W)
    O.choose(O.pat(k,'5.0.6'),'mm'); O.set_text(O.pat(k,'5.0.5'),L)
    O.choose(O.pat(k,'10.0.8'),'rad')
    click(O.pat(k,'6'))
    return {'H': O.txt(O.pat(k,'2.0.11')), 'W': O.txt(O.pat(k,'5.0.1')),
            'Z0': O.txt(O.pat(k,'10.0.1')), 'Ang_l': O.txt(O.pat(k,'10.0.7')), 'results': res()}

R['transline/MicroStrip/W3_H1.6_1GHz'] = microstrip()
R['transline/MicroStrip/W3_H1.6_1000MHz'] = microstrip(f='1000', funit='MHz')
R['transline/MicroStrip/W3_H1.6mil'] = microstrip(H='1.6', Hunit='mil')
R['transline/MicroStrip/W118.11mil_H1.6'] = microstrip(W='118.11', Wunit='mil')
print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_5.json','w'), indent=1, ensure_ascii=False)
