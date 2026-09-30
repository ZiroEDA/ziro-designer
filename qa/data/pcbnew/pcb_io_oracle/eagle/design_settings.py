import json, sys, pcbnew
R='/home/akshay/kicad-reference/qa/data/pcbnew/plugins/eagle/'
cases={'issue18515_managed_lib':R+'issue18515_managed_lib.brd','test_eagle':R+'test_eagle_23016/test_eagle.brd',
 'Adafruit_AHT20':R+'Adafruit-AHT20-PCB/Adafruit AHT20 Temperature & Humidity.brd','synthetic':'/home/akshay/pcb_io_oracle/eagle/synth/synthetic.brd'}
out={}
for k,p in cases.items():
    b=pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.EAGLE,p)
    bds=b.GetDesignSettings()
    ns=bds.m_NetSettings
    def nc(c):
        return {'clearance':c.GetClearance(),'trackWidth':c.GetTrackWidth(),'viaDiameter':c.GetViaDiameter(),'viaDrill':c.GetViaDrill()}
    classes={'Default':nc(ns.GetDefaultNetclass())}
    for name,c in ns.GetNetclasses().items():
        classes[str(name)]=nc(c)
    out[k]={'m_TrackMinWidth':bds.m_TrackMinWidth,'m_ViasMinSize':bds.m_ViasMinSize,'m_MinThroughDrill':bds.m_MinThroughDrill,
      'm_ViasMinAnnularWidth':bds.m_ViasMinAnnularWidth,'m_MinClearance':bds.m_MinClearance,'copperLayers':b.GetCopperLayerCount(),
      'netclasses':classes}
json.dump(out,open(sys.argv[1],'w'),indent=1,sort_keys=True)
print(json.dumps(out,indent=1,sort_keys=True))
