import json, sys, os, pcbnew
S='/home/akshay/pcb_io_oracle/pads/src/'
out={}
for root,_,files in os.walk(S):
  for f in sorted(files):
    if not f.endswith('.asc'): continue
    rel=os.path.relpath(os.path.join(root,f),S).replace('/','_')
    b=pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.PADS,os.path.join(root,f))
    bds=b.GetDesignSettings(); ns=bds.m_NetSettings
    def nc(c): return {'clearance':c.GetClearance(),'trackWidth':c.GetTrackWidth(),'viaDiameter':c.GetViaDiameter(),'viaDrill':c.GetViaDrill(),'dpWidth':c.GetDiffPairWidth(),'dpGap':c.GetDiffPairGap()}
    classes={'Default':nc(ns.GetDefaultNetclass())}
    for name,c in ns.GetNetclasses().items(): classes[str(name)]=nc(c)
    pats={}
    for name in sorted(str(n) for n in b.GetNetsByName().keys()):
      if name=='': continue
      c=str(ns.GetEffectiveNetClass(name).GetName())
      if c!='Default': pats[name]=c
    out[rel]={'m_MinClearance':bds.m_MinClearance,'m_TrackMinWidth':bds.m_TrackMinWidth,'m_ViasMinSize':bds.m_ViasMinSize,'m_MinThroughDrill':bds.m_MinThroughDrill,
      'm_HoleToHoleMin':bds.m_HoleToHoleMin,'m_SilkClearance':bds.m_SilkClearance,'m_SolderMaskExpansion':bds.m_SolderMaskExpansion,'m_CopperEdgeClearance':bds.m_CopperEdgeClearance,
      'customTrack':bds.GetCustomTrackWidth(),'customVia':[bds.GetCustomViaSize(),bds.GetCustomViaDrill()],
      'viaSizes':[[v.m_Diameter,v.m_Drill] for v in bds.m_ViasDimensionsList],
      'thickness':bds.GetBoardThickness(),'hasStackup':bds.m_HasStackup,'copperLayers':b.GetCopperLayerCount(),
      'netclasses':classes,'patterns':pats}
json.dump(out,open(sys.argv[1],'w'),indent=1,sort_keys=True)
k=sorted(out)[0]; print(k, json.dumps(out[k])[:600])
print([ (k,v['patterns'][:2]) for k,v in out.items() if v['patterns']][:3])
