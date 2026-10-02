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
cases.append({'op':'order','insert':['R','J','#PWR'],'order':run('order','R','J','#PWR')[:-1],'buckets':13})
out['cases']=cases
json.dump(out,open(HERE.parent/'data/common/libc/std_unordered_map_probe.json','w'),indent=1)
print(len(cases))
