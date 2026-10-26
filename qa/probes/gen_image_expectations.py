#!/usr/bin/env python3
# The expectations qa/unittests/common/wx_image_handlers.test.ts checks: what wxImage::LoadFile on
# the wxGTK 3.2 KiCad links (qa/probes/wximage_load_oracle.cpp) makes of each BMP and GIF in
# qa/data/wx/image - never from our code.
#
#   g++ -O2 -o /tmp/wximage_load_oracle qa/probes/wximage_load_oracle.cpp \
#       $(wx-config --cxxflags --libs core,base)
#   python3 -I qa/probes/gen_image_expectations.py qa/data/wx/image /tmp/wximage_load_oracle
#
# The images themselves are inputs, written once by Pillow and ImageMagick; expected.json is the
# oracle's answer for whatever they hold, including the truncations taken here.
import hashlib, json, os, subprocess, sys

d, oracle = sys.argv[1:3]

def ask(path):
    r = subprocess.run([oracle, path], capture_output=True, check=True).stdout
    nl = r.index(b'\n')
    head = r[:nl].decode()
    if head == 'fail':
        return None
    w, h, typ, alpha, mask, mr, mg, mb, rx, ry, unit = map(int, head.split())
    rgb, rest = r[nl + 1: nl + 1 + w * h * 3], r[nl + 1 + w * h * 3:]
    assert len(rgb) == w * h * 3 and len(rest) == (w * h if alpha else 0)
    return {'width': w, 'height': h, 'type': typ, 'mask': [mr, mg, mb] if mask else None,
            'resolution': [rx, ry, unit], 'rgbSha256': hashlib.sha256(rgb).hexdigest(),
            'alphaSha256': hashlib.sha256(rest).hexdigest() if alpha else None}

expected = {'load': {}, 'truncations': {}}
for name in sorted(os.listdir(d)):
    if name.endswith(('.bmp', '.gif')):
        expected['load'][name] = ask(os.path.join(d, name))

# every cut of one file of each kind either fails or loads what wx makes of it
for name in ['b8_rle.bmp', 'b24.bmp', 'g_interlaced.gif', 'g_animated.gif', 'g_large_noise.gif',
             'g_anim_local.gif', 'g_comment.gif']:
    data = open(os.path.join(d, name), 'rb').read()
    cuts = {}
    for n in sorted({2, 10, 30, 54, 60, 100, len(data) // 2, len(data) - 1}):
        path = os.path.join(d, '.cut')
        open(path, 'wb').write(data[:n])
        cuts[str(n)] = ask(path)
        os.remove(path)
    expected['truncations'][name] = cuts

json.dump(expected, open(os.path.join(d, 'expected.json'), 'w'), indent=1)
print(len(expected['load']), 'files,', sum(len(c) for c in expected['truncations'].values()), 'cuts')
