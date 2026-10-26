#!/usr/bin/env python3
# The expectations qa/unittests/common/imagjpeg.test.ts checks, from wx's own libjpeg calls against
# the system libjpeg-turbo KiCad links (qa/probes/wxjpeg_oracle.c, wxjpeg_enc_oracle.c) - never from
# our code. Writes the fixture JPEGs and expected.json into qa/data/wx/jpeg.
#
#   gcc -O2 -o /tmp/wxjpeg_oracle qa/probes/wxjpeg_oracle.c -ljpeg
#   gcc -O2 -o /tmp/wxjpeg_enc_oracle qa/probes/wxjpeg_enc_oracle.c -ljpeg
#   python3 -I qa/probes/gen_jpeg_expectations.py qa/data/wx/jpeg /tmp
#
# The input images are drawn and encoded with Pillow; another Pillow may encode them differently,
# which only changes the inputs - every expectation is still the oracle's answer for them.
import hashlib, json, os, random, subprocess, sys, tempfile

from PIL import Image

out, oracles = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
dec = os.path.join(oracles, 'wxjpeg_oracle')
enc = os.path.join(oracles, 'wxjpeg_enc_oracle')

def drawn(w, h, mode='RGB'):
    random.seed(7)
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 7 + y * 3) % 256, (x * x + y) % 256,
                        random.randrange(256) if (x // 5 + y // 5) % 3 == 0 else (y * 11) % 256)
    return im.convert(mode) if mode != 'RGB' else im

def encoded(im, **kw):
    with tempfile.NamedTemporaryFile(suffix='.jpg') as f:
        im.save(f.name, **kw)
        return open(f.name, 'rb').read()

def jfif_patched(data, unit, x, y):
    b = bytearray(data)
    assert b[2:4] == b'\xff\xe0' and b[6:11] == b'JFIF\x00'
    b[13] = unit; b[14:16] = x.to_bytes(2, 'big'); b[16:18] = y.to_bytes(2, 'big')
    return bytes(b)

small, large = drawn(37, 23), drawn(129, 77)
exif = Image.Exif(); exif[0x0112] = 6  # Orientation: rotate 90 CW, which wx 3.2 does not apply
b420 = encoded(small, quality=85, subsampling=2)
files = {
    'baseline_420.jpg': b420,
    'baseline_444.jpg': encoded(small, quality=85, subsampling=0),
    'progressive_422.jpg': encoded(small, quality=85, subsampling=1, progressive=True),
    'grey.jpg': encoded(drawn(37, 23, 'L'), quality=90),
    'cmyk.jpg': encoded(drawn(37, 23, 'CMYK'), quality=90),
    'exif_rotate90.jpg': encoded(large, quality=85, exif=exif.tobytes()),
    # unit 0 is "aspect ratio only", and wx still hands the density over as the resolution
    'jfif_unitless_72.jpg': jfif_patched(b420, 0, 72, 72),
    'jfif_cm_118.jpg': jfif_patched(b420, 2, 118, 118),
}
whole = encoded(large, quality=85, subsampling=2)
files['truncated.jpg'] = whole[: len(whole) * 3 // 5]  # wx's fake EOI finishes it

decode = {}
for name, data in files.items():
    open(os.path.join(out, name), 'wb').write(data)
    r = subprocess.run([dec, os.path.join(out, name)], capture_output=True, check=True).stdout
    nl = r.index(b'\n')
    w, h, jfif, unit, x, y = map(int, r[:nl].split())
    rgb = r[nl + 1:]
    assert len(rgb) == w * h * 3
    decode[name] = {'width': w, 'height': h, 'rgbSha256': hashlib.sha256(rgb).hexdigest(),
                    'sawJFIF': bool(jfif), 'densityUnit': unit, 'xDensity': x, 'yDensity': y}

# Every truncation of a file either fails or decodes to what libjpeg makes of it: wx's fake EOI
# finishes a cut scan, and a cut header is an error_exit. Neither may leave libjpeg running.
truncations = {}
src = b420
for n in [2, 4, 10, 20, 100, 200, 400, 600, 800, 1000]:
    path = os.path.join(out, '.cut.jpg')
    open(path, 'wb').write(src[:n])
    r = subprocess.run([dec, path], capture_output=True)
    os.remove(path)
    if r.returncode != 0:
        truncations[str(n)] = None
    else:
        nl = r.stdout.index(b'\n')
        truncations[str(n)] = hashlib.sha256(r.stdout[nl + 1:]).hexdigest()

def pattern(w, h):  # the encoder's input; qa recomputes the same formula
    return bytes(((i * (c + 3) * 7 + (i >> 4) * 13) & 255) for i in range(w * h) for c in range(3))

encode = {}
for key, (w, h, args) in {
    'defaults_37x23': (37, 23, []),
    'defaults_64x48': (64, 48, []),
    'quality90_37x23': (37, 23, ['90']),
    'inches300_37x23': (37, 23, ['-1', '1', '300', '300']),
    'cm118_37x23': (37, 23, ['-1', '2', '118', '118']),
    # resolution options with unit 0, as a unitless JFIF file loads: GetResolutionFromOptions
    # makes it inches, so the stream written says dots per inch
    'unitless72_37x23': (37, 23, ['-1', '1', '72', '72']),
    # the single Resolution option, no X/Y: both take it, in inches
    'single150_37x23': (37, 23, ['-1', '1', '150', '150']),
}.items():
    raw = os.path.join(out, '.enc_in.rgb')
    open(raw, 'wb').write(pattern(w, h))
    jpg = subprocess.run([enc, str(w), str(h), raw, *args], capture_output=True, check=True).stdout
    os.remove(raw)
    encode[key] = {'width': w, 'height': h, 'args': args, 'length': len(jpg),
                   'sha256': hashlib.sha256(jpg).hexdigest()}

json.dump({'libjpegTurbo': subprocess.run(['dpkg-query', '-W', '-f=${Version}', 'libjpeg-turbo8:amd64'],
                                          capture_output=True, text=True).stdout,
           'decode': decode, 'encode': encode,
           'truncationsOf': 'baseline_420.jpg', 'truncations': truncations},
          open(os.path.join(out, 'expected.json'), 'w'), indent=2)
print('wrote', len(decode), 'decode and', len(encode), 'encode expectations to', out)
