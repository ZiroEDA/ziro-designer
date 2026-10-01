# KiCad 10.0.6's own PCB_IO_EASYEDAPRO over each board of each qa project.
# A project with several boards asks a chooser the python module cannot supply,
# so each board is loaded from a copy whose project.json lists only that board.
import json, sys, zipfile, pcbnew, os
R='/home/akshay/kicad-reference/qa/data/pcbnew/plugins/easyedapro/'
O='/home/akshay/pcb_io_oracle/easyedapro/'
T=O+'variants/'
os.makedirs(T, exist_ok=True)
files=sys.argv[1:] or sorted(f for f in os.listdir(R) if f.endswith(('.zip','.epro')))
for f in files:
    z=zipfile.ZipFile(R+f)
    prj=json.loads(z.read('project.json'))
    stem=f.rsplit('.',1)[0].replace(' ','_')
    for pcbid,name in prj['pcbs'].items():
        v=dict(prj); v['pcbs']={pcbid:name}
        os.makedirs(T+pcbid, exist_ok=True)
        vp=T+pcbid+'/'+f  # the original file name: the footprint library is named after it
        with zipfile.ZipFile(vp,'w',zipfile.ZIP_DEFLATED) as w:
            for info in z.infolist():
                data=z.read(info.filename)
                if info.filename=='project.json': data=json.dumps(v,ensure_ascii=False).encode()
                ni=zipfile.ZipInfo(info.filename, info.date_time); ni.compress_type=zipfile.ZIP_DEFLATED; ni.external_attr=info.external_attr
                w.writestr(ni, data)
        try:
            b=pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.EASYEDAPRO,vp)
        except Exception as e:
            print('ERR',f,pcbid,e,flush=True); continue
        if b is None: print('NONE',f,pcbid,flush=True); continue
        out=O+'%s__%s.kicad_pcb'%(stem,pcbid)
        pcbnew.PCB_IO_MGR.Save(pcbnew.PCB_IO_MGR.KICAD_SEXP,out,b)
        print('OK',out,len(b.GetFootprints()),flush=True)
