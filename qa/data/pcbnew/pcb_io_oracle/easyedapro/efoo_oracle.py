import pcbnew, os, sys
R='/home/akshay/kicad-reference/qa/data/pcbnew/plugins/easyedapro/'
f=R+'PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2.efoo'
name='PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2'
io=pcbnew.PCB_IO_MGR.FindPlugin(pcbnew.PCB_IO_MGR.EASYEDAPRO)
names=io.FootprintEnumerate(f) if False else None
fp=io.FootprintLoad(f,name)
print(fp, fp.Pads().size() if hasattr(fp.Pads(),'size') else len(fp.Pads()))
out='/home/akshay/pcb_io_oracle/easyedapro/efoo.pretty'
os.makedirs(out,exist_ok=True)
k=pcbnew.PCB_IO_MGR.FindPlugin(pcbnew.PCB_IO_MGR.KICAD_SEXP)
k.FootprintSave(out,fp)
print(os.listdir(out))
