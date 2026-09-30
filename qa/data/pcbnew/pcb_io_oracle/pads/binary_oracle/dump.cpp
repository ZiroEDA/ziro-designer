#include "pads_binary_parser.h"
#include <cstdio>
#include <wx/init.h>
using namespace PADS_IO;
static void js( const std::string& s ) { putchar('"'); for( unsigned char c : s ) { if( c == '"' || c == '\\' ) { putchar('\\'); putchar(c);} else if( c < 0x20 ) printf("\\u%04x", c); else putchar(c);} putchar('"'); }
int main( int argc, char** argv )
{
    wxInitializer init;
    BINARY_PARSER p;
    try { p.Parse( wxString( argv[1] ) ); } catch( std::exception& e ) { printf("{\"error\":"); js(e.what()); printf("}\n"); return 0; }
    printf("{\"layer_count\":%d,\"origin\":[%.17g,%.17g],\"parts\":[", p.GetParameters().layer_count, p.GetParameters().origin.x, p.GetParameters().origin.y);
    bool f = true;
    for( auto& pt : p.GetParts() ) { if(!f) putchar(','); f=false; printf("["); js(pt.name); printf(",%.17g,%.17g,%.17g]", pt.location.x, pt.location.y, pt.rotation); }
    printf("],\"nets\":["); f = true;
    for( auto& n : p.GetNets() ) { if(!f) putchar(','); f=false; js(n.name); }
    printf("],\"decals\":["); f = true;
    for( auto& [k, d] : p.GetPartDecals() ) { if(!f) putchar(','); f=false; printf("["); js(k); putchar(','); js(d.units); printf("]"); }
    printf("],\"texts\":["); f = true;
    for( auto& t : p.GetTexts() ) { if(!f) putchar(','); f=false; printf("["); js(t.content); printf(",%.17g,%.17g,%.17g,%.17g,%d,%.17g]", t.location.x, t.location.y, t.height, t.width, t.layer, t.rotation); }
    printf("],\"outlines\":["); f = true;
    for( auto& o : p.GetBoardOutlines() ) { if(!f) putchar(','); f=false; printf("["); bool g=true; for( auto& q : o.points ) { if(!g) putchar(','); g=false; printf("[%.17g,%.17g]", q.x, q.y);} printf("]"); }
    printf("],\"routes\":["); f = true;
    for( auto& r : p.GetRoutes() ) { if(!f) putchar(','); f=false; printf("{\"tracks\":["); bool g=true; for( auto& t : r.tracks ) { if(!g) putchar(','); g=false; printf("[%.17g,%.17g,%.17g,%.17g,%.17g]", t.width, t.points[0].x, t.points[0].y, t.points[1].x, t.points[1].y);} printf("],\"vias\":["); g=true; for( auto& v : r.vias ) { if(!g) putchar(','); g=false; printf("[%.17g,%.17g]", v.location.x, v.location.y);} printf("]}"); }
    printf("]}\n");
    return 0;
}
