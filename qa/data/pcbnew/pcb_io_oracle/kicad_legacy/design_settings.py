import json, sys, pcbnew
R='/home/akshay/kicad-reference/qa/data/pcbnew/plugins/legacy_demos/'
cases={'ecc83-pp':'ecc83/ecc83-pp.brd','ecc83-pp_v2':'ecc83/ecc83-pp_v2.brd','flat_hierarchy':'flat_hierarchy/flat_hierarchy.brd','interf_u':'interf_u/interf_u.brd','microwave':'microwave/microwave.brd','pic_programmer':'pic_programmer/pic_programmer.brd','sonde_xilinx':'sonde xilinx/sonde xilinx.brd','carte_test':'test_xil_95108/carte_test.brd','video':'video/video.brd'}
out={}
for k,p in cases.items():
    b=pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.LEGACY,R+p)
    bds=b.GetDesignSettings(); ns=bds.m_NetSettings
    def nc(c): return {'clearance':c.GetClearance(),'trackWidth':c.GetTrackWidth(),'viaDiameter':c.GetViaDiameter(),'viaDrill':c.GetViaDrill(),'uViaDiameter':c.GetuViaDiameter(),'uViaDrill':c.GetuViaDrill()}
    classes={'Default':nc(ns.GetDefaultNetclass())}
    for name,c in ns.GetNetclasses().items(): classes[str(name)]=nc(c)
    out[k]={'m_TrackMinWidth':bds.m_TrackMinWidth,'m_ViasMinSize':bds.m_ViasMinSize,'m_MinThroughDrill':bds.m_MinThroughDrill,'m_MicroViasMinSize':bds.m_MicroViasMinSize,'m_MicroViasMinDrill':bds.m_MicroViasMinDrill,
      'm_SolderMaskExpansion':bds.m_SolderMaskExpansion,'m_SolderPasteMargin':bds.m_SolderPasteMargin,'m_SolderPasteMarginRatio':bds.m_SolderPasteMarginRatio,
      'trackWidths':list(bds.m_TrackWidthList),'viaSizes':[[v.m_Diameter,v.m_Drill] for v in bds.m_ViasDimensionsList],
      'lineThickness':[bds.GetLineThickness(l) for l in (pcbnew.F_Cu,pcbnew.Edge_Cuts,pcbnew.F_SilkS,pcbnew.Dwgs_User)],
      'zoneClearance':bds.GetDefaultZoneSettings().m_ZoneClearance,'copperLayers':b.GetCopperLayerCount(),'netclasses':classes}
json.dump(out,open(sys.argv[1],'w'),indent=1,sort_keys=True)
print(json.dumps(out['ecc83-pp'],indent=1,sort_keys=True))
