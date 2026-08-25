import json, time, oracle as O
R={}; k='track_width'
O.kill_all(); O.write_cfg(lambda c: c.__setitem__('last_page', 6)); O.launch()
# current-controlled, external width read/displayed in mil
O.set_text(O.pat(k,'0.0.1'),'5'); O.set_text(O.pat(k,'0.0.4'),'10')
O.choose(O.pat(k,'0.0.8'),'mm'); O.set_text(O.pat(k,'0.0.7'),'20')
O.set_text(O.pat(k,'0.0.10'),'1.72e-08')
O.choose(O.pat(k,'2.0.5'),'µm'); O.set_text(O.pat(k,'2.0.4'),'35')
O.choose(O.pat(k,'3.0.5'),'µm'); O.set_text(O.pat(k,'3.0.4'),'35')
O.choose(O.pat(k,'2.0.2'),'mil'); time.sleep(1.2)
R['track_width/ext_width_unit_mil'] = {
    'W': O.txt(O.pat(k,'2.0.1')), 'W_unit': O.nm(O.pat(k,'2.0.2')),
    'area': O.txt(O.pat(k,'2.0.10')), 'area_unit': O.nm(O.pat(k,'2.0.11')),
    'R': O.txt(O.pat(k,'2.0.13')), 'Vdrop': O.txt(O.pat(k,'2.0.16')), 'P': O.txt(O.pat(k,'2.0.19'))}
O.choose(O.pat(k,'2.0.2'),'inch'); time.sleep(1.2)
R['track_width/ext_width_unit_inch'] = {
    'W': O.txt(O.pat(k,'2.0.1')), 'area': O.txt(O.pat(k,'2.0.10')),
    'area_unit': O.nm(O.pat(k,'2.0.11')), 'R': O.txt(O.pat(k,'2.0.13'))}
print(json.dumps(R, indent=1, ensure_ascii=False))
json.dump(R, open('kicad_answers_8.json','w'), indent=1, ensure_ascii=False)
