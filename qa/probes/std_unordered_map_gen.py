# Regenerates qa/data/common/libc/std_unordered_map_probe.json from the probe's answers.
import json, random, subprocess, pathlib
HERE=pathlib.Path(__file__).resolve().parent
P=str(HERE/'std_unordered_map_probe')
def run(*a): return subprocess.run([P,*a],capture_output=True,text=True,check=True).stdout.splitlines()
random.seed(1006)
alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ#_'
def rkey(): return ''.join(random.choice(alpha) for _ in range(random.randint(1,12)))
strings=['','a','R','J','#PWR','#FLG','abcdefgh','abcdefghi','abcdefghijklmnopq','Ω','µF','U','RV','TP','SW','D','C','Q']
out={'hash':dict(zip(strings,run('hash',*strings)))}
cases=[]
for n in [1,2,3,5,12,13,14,15,28,29,30,58,59,60,120]:
    keys=list(dict.fromkeys(rkey() for _ in range(n*2)))[:n]
    lines=run('order',*keys); cases.append({'op':'order','insert':keys,'order':lines[:-1],'buckets':int(lines[-1].split()[-1])})
for n in [5,14,40]:
    keys=list(dict.fromkeys(rkey() for _ in range(n*2)))[:n]
    er=random.sample(keys,n//2)
    lines=run('erase',*keys,'--',*er); cases.append({'op':'erase','insert':keys,'erase':er,'order':lines[:-1],'buckets':int(lines[-1].split()[-1])})
    again=list(dict.fromkeys(rkey() for _ in range(n)))
    lines=run('clear',*keys,'--',*again); cases.append({'op':'clear','insert':keys,'after':again,'order':lines[:-1],'buckets':int(lines[-1].split()[-1])})
# KiCad's own file: the refdes prefixes of test1243
# erase, then insert: the bucket fix-ups only show in where later keys land
for n in [6,14,30]:
    keys=list(dict.fromkeys(rkey() for _ in range(n*2)))[:n]
    er=random.sample(keys,n//2)
    more=list(dict.fromkeys(rkey() for _ in range(n)))
    lines=run('erase',*keys,'--',*er,'--',*more); cases.append({'op':'erase','insert':keys,'erase':er,'after':more,'order':lines[:-1],'buckets':int(lines[-1].split()[-1])})
cases.append({'op':'order','insert':['R','J','#PWR'],'order':run('order','R','J','#PWR')[:-1],'buckets':13})
out['cases']=cases
# wxString's hash, and CONNECTION_GRAPH's NET_MAP order (name@code; "--" clears)
wstrings=['','GND','Net-(R1-Pad1)','µ','unconnected-(U2-Pad1)_1','/sheet/VCC','Ω€𝄞']
out['whash']=dict(zip(wstrings,run('whash',*wstrings)))
net=[]
def netcase(keys):
    lines=run('netorder',*keys); net.append({'insert':keys,'order':lines[:-1],'buckets':int(lines[-1].split()[-1])})
netcase(['GND@1','VCC@2','unconnected-(U2-Pad1)@-1','unconnected-(U2-Pad1)_1@-1'])
for n in [5,14,30,70]:
    keys=[f"{rkey()}@{random.randint(-5,60)}" for _ in range(n)]
    netcase(keys)
keys=[f"N{i}@{i}" for i in range(20)]
netcase(keys+['--']+[f"M{i}@{i}" for i in range(6)])
out['netorder']=net
json.dump(out,open(HERE.parent/'data/common/libc/std_unordered_map_probe.json','w'),indent=1)
print(len(cases))
