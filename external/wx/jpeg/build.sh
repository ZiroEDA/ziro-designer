#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
#
# Builds imagjpeg_wasm.js: wxJPEGHandler's libjpeg calls (imagjpeg_wasm.c) linked against the
# libjpeg-turbo that KiCad links, compiled to WebAssembly. The output is checked in; run this only
# to rebuild it, e.g. when the reference KiCad's libjpeg-turbo moves (`ldd $(which kicad)` names
# libjpeg.so.8; `dpkg -l libjpeg-turbo8` gives its version).
#
#   EMSDK=/path/to/emsdk ./build.sh
#
# Pinned so a rebuild is byte-identical: change a version here and the oracle tests say whether
# the pixels moved (qa/unittests/common/imagjpeg.test.ts; qa/probes/gen_jpeg_expectations.py
# rewrites its expectations from the system libjpeg).
set -euo pipefail

LIBJPEG_TURBO_TAG=2.1.5   # Ubuntu 24.04's libjpeg-turbo8, what /usr/bin/kicad 10.0.6 links
EMSCRIPTEN_VERSION=3.1.74

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$(mktemp -d)}"
: "${EMSDK:?set EMSDK to an emsdk checkout with ${EMSCRIPTEN_VERSION} installed}"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null
[ "$(emcc -dumpversion)" = "$EMSCRIPTEN_VERSION" ] ||
  { echo "emcc is $(emcc -dumpversion), want $EMSCRIPTEN_VERSION" >&2; exit 1; }

[ -d "$WORK/libjpeg-turbo" ] ||
  git clone -q --depth 1 --branch "$LIBJPEG_TURBO_TAG" \
    https://github.com/libjpeg-turbo/libjpeg-turbo.git "$WORK/libjpeg-turbo"

# The static libjpeg alone: no SIMD (wasm32 has none of libjpeg-turbo's), no TurboJPEG, no tools.
# SIMD and C produce the same samples; the oracle test is what holds that.
emcmake cmake -S "$WORK/libjpeg-turbo" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release -DWITH_SIMD=0 -DENABLE_SHARED=0 -DWITH_TURBOJPEG=0 \
  -DCMAKE_C_FLAGS="-Oz" >/dev/null
emmake make -C "$WORK/build" -j"$(nproc)" jpeg-static >/dev/null

# SINGLE_FILE: the wasm rides inside the .js as a data URI, so the window, the workers and node (the
# tests) all load it the same way, with no URL to resolve. ENVIRONMENT has no `node`: its branch
# imports Node's `module`, which Vite has to stub out of the browser bundle, and node runs the web
# branch fine off the data URI. Instantiation stays asynchronous (a
# browser refuses a synchronous compile of this size on the main thread): wxInitAllImageHandlers.
emcc -Oz "$HERE/imagjpeg_wasm.c" "$WORK/build/libjpeg.a" \
  -I "$WORK/libjpeg-turbo" -I "$WORK/build" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createImagJpeg \
  -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sFILESYSTEM=0 \
  -o "$HERE/imagjpeg_wasm.js"

echo "built $HERE/imagjpeg_wasm.js ($(wc -c <"$HERE/imagjpeg_wasm.js") bytes)"
