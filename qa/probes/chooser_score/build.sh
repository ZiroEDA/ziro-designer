#!/bin/sh
# Compiles KiCad 10.0.5's own eda_pattern_match.cpp straight out of the pinned
# reference tree; nothing here is a re-implementation of the matcher.
set -e
cd "$(dirname "$0")"
KICAD=${KICAD_REFERENCE:-/home/akshay/kicad-reference}
g++ -std=c++17 -O1 -Wall -o chooser_score main.cpp "$KICAD/common/eda_pattern_match.cpp" \
    -I. -I"$KICAD/include" $(wx-config --cxxflags --libs)
