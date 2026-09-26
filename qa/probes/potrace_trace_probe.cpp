// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/*
 * Oracle for libs/potrace: run KiCad 10.0.5's own vendored potracelib
 * (thirdparty/potrace/src) on a bitmap and print the path list exactly.
 *
 * Build (from the repo root):
 *   P=/home/akshay/kicad-reference/thirdparty/potrace
 *   g++ -O0 -I$P/include -o /tmp/potrace_trace_probe qa/probes/potrace_trace_probe.cpp \
 *       $P/src/decompose.cpp $P/src/trace.cpp $P/src/curve.cpp $P/src/potracelib.cpp
 *
 * Input (stdin): "w h" then h rows of w characters, '1' = black. Row y of the
 * text is put at bitmap row y, as BITMAP2CMP_PANEL::ExportToBuffer does
 * (BM_PUT( potrace_bitmap, x, y, pixel ? 0 : 1 )).
 *
 * Parameters are BITMAPCONV_INFO::ConvertBitmap's: the defaults with
 * turdsize = 0 and opttolerance = 0.2.
 *
 * Output: one line per path, "path <sign> <area> <n>", then one line per
 * segment, "<tag> c0x c0y c1x c1y c2x c2y", every double as %.17g so the text
 * round-trips to the same bits.
 */
#include <cstdio>
#include <cstdlib>

#include "bitmap.h"
#include "potracelib.h"

int main()
{
    int w, h;

    if( scanf( "%d %d", &w, &h ) != 2 )
        return 2;

    potrace_bitmap_t* bm = bm_new( w, h );

    for( int y = 0; y < h; y++ )
    {
        char row[65536];

        if( scanf( "%65535s", row ) != 1 )
            return 2;

        for( int x = 0; x < w; x++ )
            BM_PUT( bm, x, y, row[x] == '1' ? 1 : 0 );
    }

    potrace_param_t* param = potrace_param_default();
    param->turdsize = 0;
    param->opttolerance = 0.2;

    potrace_state_t* st = potrace_trace( param, bm );

    if( !st || st->status != POTRACE_STATUS_OK )
        return 1;

    for( potrace_path_t* p = st->plist; p; p = p->next )
    {
        printf( "path %c %d %d\n", p->sign, p->area, p->curve.n );

        for( int i = 0; i < p->curve.n; i++ )
        {
            printf( "%d %.17g %.17g %.17g %.17g %.17g %.17g\n", p->curve.tag[i],
                    p->curve.c[i][0].x, p->curve.c[i][0].y, p->curve.c[i][1].x,
                    p->curve.c[i][1].y, p->curve.c[i][2].x, p->curve.c[i][2].y );
        }
    }

    potrace_state_free( st );
    potrace_param_free( param );
    bm_free( bm );
    return 0;
}
