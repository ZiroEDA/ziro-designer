#!/bin/sh
# Build the probe against KiCad's vendored Zint, which is the library pcbnew
# actually links. Nothing is installed; the objects land beside this script.
set -e
Z=/home/akshay/kicad-reference/thirdparty/zint/backend
cd "$(dirname "$0")"
cc -O1 -w -DZINT_NO_PNG -I"$Z" -o zint_probe zint_probe.c \
   "$Z"/common.c "$Z"/eci.c "$Z"/filemem.c "$Z"/general_field.c "$Z"/gs1.c \
   "$Z"/large.c "$Z"/library.c "$Z"/reedsol.c "$Z"/code.c "$Z"/code128.c \
   "$Z"/qr.c "$Z"/dmatrix.c "$Z"/2of5.c "$Z"/2of5inter.c "$Z"/2of5inter_based.c \
   "$Z"/bc412.c "$Z"/channel.c "$Z"/codabar.c "$Z"/code11.c "$Z"/code128_based.c \
   "$Z"/dxfilmedge.c "$Z"/medical.c "$Z"/plessey.c "$Z"/rss.c "$Z"/telepen.c \
   "$Z"/upcean.c "$Z"/auspost.c "$Z"/imail.c "$Z"/mailmark.c "$Z"/postal.c \
   "$Z"/aztec.c "$Z"/codablock.c "$Z"/code1.c "$Z"/code16k.c "$Z"/code49.c \
   "$Z"/composite.c "$Z"/dotcode.c "$Z"/gridmtx.c "$Z"/hanxin.c "$Z"/maxicode.c \
   "$Z"/pdf417.c "$Z"/ultra.c "$Z"/output.c "$Z"/ps.c "$Z"/raster.c "$Z"/vector.c \
   "$Z"/bmp.c "$Z"/gif.c "$Z"/png.c "$Z"/pcx.c "$Z"/svg.c "$Z"/tif.c "$Z"/emf.c -lm
echo "built $(pwd)/zint_probe"
