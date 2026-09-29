# Independent transcription of BuildCornersList_S_Shape (microwave_inductor.cpp, 10.0.6)
import math, sys, json
def kir(v): return int(math.floor(v+0.5)) if v>=0 else -int(math.floor(-v+0.5))
def tr(a,b): return int(a/b)   # C++ int division truncates toward zero
ARC_HIGH_DEF=5000
def arc_seg_count(radius, err, angle_deg):
    radius=max(1,int(radius)); err=max(1,err)
    rel=err/radius
    inc=180/math.pi*math.acos(1.0-rel)*2
    inc=min(360.0/8,inc)
    return max(kir(abs(angle_deg)/inc),2)
def gen_arc(buf,start,center,ang_deg):
    fp=(start[0]-center[0],start[1]-center[1])
    radius=math.hypot(*fp)
    n=arc_seg_count(radius,ARC_HIGH_DEF,ang_deg)
    inc=math.radians(ang_deg)/n
    for i in range(1,n+1):
        r=inc*i; c=math.cos(r); s=math.sin(r)
        cx=kir(fp[0]*c+fp[1]*s); cy=kir(fp[1]*c-fp[0]*s)
        buf.append((center[0]+cx,center[1]+cy))
def rotate(pt,centre,ang_deg):
    x=pt[0]-centre[0]; y=pt[1]-centre[1]
    a=ang_deg%360
    if a==0: nx,ny=x,y
    elif a==90: nx,ny=y,-x
    elif a==180: nx,ny=-x,-y
    elif a==270: nx,ny=-y,x
    else:
        r=math.radians(ang_deg); c=math.cos(r); s=math.sin(r)
        nx=kir(x*c+y*s); ny=kir(y*c-x*s)
    return (nx+centre[0],ny+centre[1])
def norm(pt):
    x,y=pt
    if abs(x)==abs(y): return kir(abs(x)*math.sqrt(2))
    if x==0: return abs(y)
    if y==0: return abs(x)
    return kir(math.hypot(x,y))
def build(start,end,length,width):
    buf=[]
    ADJ=0.988
    pt=(end[0]-start[0],end[1]-start[1])
    angle=math.degrees(math.atan2(pt[1],pt[0]))
    min_len=norm(pt)
    angle=-angle
    size=(tr(min_len,2),min_len)
    radius=min(width*5,tr(size[0],4))
    segm_count=0
    while True:
        stubs=tr(size[1]-radius*2*(segm_count+2),2)
        if stubs<tr(size[1],10):
            stubs=tr(size[1],10)
            radius=tr(size[1]-2*stubs,2*(segm_count+2))
            if radius<width: return 'TOO_LONG',None
        segm_len=size[0]-radius*2
        full=2*stubs
        full+=segm_len*segm_count
        full+=kir((segm_count+2)*math.pi*ADJ*radius)
        full+=segm_len-2*radius
        if full>=length: break
        segm_count+=1
    delta=full-length
    segm_len-=tr(delta,segm_count+1)
    if int(2*stubs+2*math.pi*ADJ*radius)>length: return 'TOO_SHORT',None
    if segm_len-2*radius<0: return 'NO_REPR',None
    pt=start; buf.append(pt); pt=(pt[0],pt[1]+stubs); buf.append(pt)
    centre=(pt[0]-radius,pt[1])
    gen_arc(buf,pt,centre,-90); pt=buf[-1]
    half=tr(segm_len,2)-radius
    if half:
        pt=(pt[0]-half,pt[1]); buf.append(pt)
    sign=1; segm_count+=1
    for ii in range(segm_count):
        sign=-1 if ii&1 else 1
        centre=(pt[0],pt[1]+radius)
        gen_arc(buf,pt,centre,180*sign)
        pt=buf[-1]; pt=(pt[0]+segm_len*sign,pt[1]); buf.append(pt)
    sign*=-1
    buf[-1]=(start[0]+radius*sign,buf[-1][1])
    pt=buf[-1]; centre=(pt[0],pt[1]+radius)
    gen_arc(buf,pt,centre,90*sign)
    angle+=90
    buf=[rotate(p,start,angle) for p in buf]
    buf.append(end)
    return 'OK',buf
if __name__=='__main__':
    cases=[((0,0),(0,10000000),20000000,250000),
           ((0,0),(10000000,0),22000000,250000),
           ((1000000,2000000),(6000000,9000000),30000000,200000)]
    out=[]
    for s,e,l,w in cases:
        r,b=build(s,e,l,w)
        out.append({'start':s,'end':e,'length':l,'width':w,'result':r,'points':b})
    json.dump(out,open('/home/akshay/microwave_oracle/inductor_cases.json','w'))
    for o in out: print(o['result'], len(o['points']) if o['points'] else 0, o['points'][:4] if o['points'] else '')
