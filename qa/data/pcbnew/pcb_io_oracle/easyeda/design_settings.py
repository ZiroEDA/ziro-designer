import json, sys, pcbnew
R='/home/akshay/kicad-reference/qa/data/pcbnew/plugins/easyeda/'
cases={'smartwatch':R+'PCB_PCB_ESP32-PICO-D4 smart watch_2023-09-02.json','usbmeter':R+'PCB_USBMETER-PD QC修改版_2023-09-02.json'}
out={}
for k,p in cases.items():
    b=pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.EASYEDA,p)
    bds=b.GetDesignSettings()
    c=bds.m_NetSettings.GetDefaultNetclass()
    ao=bds.GetAuxOrigin()
    out[k]={'copperLayers':b.GetCopperLayerCount(),'auxOrigin':[ao.x,ao.y],
      'default':{'clearance':c.GetClearance(),'trackWidth':c.GetTrackWidth(),'viaDiameter':c.GetViaDiameter(),'viaDrill':c.GetViaDrill()}}
json.dump(out,open(sys.argv[1],'w'),indent=1,sort_keys=True,ensure_ascii=False)
print(json.dumps(out,indent=1,sort_keys=True,ensure_ascii=False)[:1500])
