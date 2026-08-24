// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// GERBER_FILE_IMAGE_LIST::SortImagesByFileExtension is `std::sort` with
// `sortFileExtension` (gerber_file_image_list.cpp:329-382). Every `.gbr` maps
// to GERBER_BOARD_OUTLINE and `.drl` to GERBER_DRILL, so for a KiCad plot
// folder the comparator is all-ties apart from the drill file — and what
// std::sort then does with the ties is implementation-defined, not random.
// This asks libstdc++ on this machine what it does.
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

// GERBER_ORDER_ENUM: DRILL = 0, BOARD_OUTLINE = 1.
static int order( const std::string& n )
{
    return n.size() >= 4 && n.compare( n.size() - 4, 4, ".drl" ) == 0 ? 0 : 1;
}

static bool sortFileExtension( const std::string& ref, const std::string& test )
{
    return order( ref ) < order( test );
}

int main()
{
    // NEWEST mtime first — the order a file chooser sorted by Modified
    // descending hands over, which is what Chrome/Firefox gave us.
    std::vector<std::string> newest = {
        "F_Fab.gbr", "B_Courtyard.gbr", "F_Courtyard.gbr", "Margin.gbr",
        "Edge_Cuts.gbr", "User_Comments.gbr", "User_Drawings.gbr", "B_Mask.gbr",
        "F_Mask.gbr", "B_Silkscreen.gbr", "F_Silkscreen.gbr", "B_Paste.gbr",
        "F_Paste.gbr", "B_Adhesive.gbr", "F_Adhesive.gbr", "B_Cu.gbr",
        "In2_Cu.gbr", "In1_Cu.gbr", "Top_layer.gbr", "PTH.drl",
    };

    // Oldest mtime first.
    std::vector<std::string> oldest( newest.rbegin(), newest.rend() );

    // Alphabetical, in case the chooser was sorted by Name.
    std::vector<std::string> byname = newest;
    std::sort( byname.begin(), byname.end() );

    const char* kicad[] = {
        "PTH.drl", "B_Courtyard.gbr", "F_Fab.gbr", "Top_layer.gbr", "In1_Cu.gbr",
        "In2_Cu.gbr", "B_Cu.gbr", "F_Adhesive.gbr", "B_Adhesive.gbr",
        "F_Paste.gbr", "B_Paste.gbr", "B_Silkscreen.gbr", "F_Mask.gbr",
        "B_Mask.gbr", "User_Drawings.gbr", "User_Comments.gbr", "Edge_Cuts.gbr",
        "Margin.gbr", "F_Courtyard.gbr", "F_Silkscreen.gbr",
    };

    struct Case { const char* label; std::vector<std::string> v; };
    std::vector<Case> cases = { { "newest-first", newest }, { "oldest-first", oldest },
                                { "by name", byname } };

    for( Case& c : cases )
    {
        std::sort( c.v.begin(), c.v.end(), sortFileExtension );
        bool match = true;
        for( size_t i = 0; i < c.v.size(); ++i )
            if( c.v[i] != kicad[i] ) match = false;
        printf( "%-14s -> %s\n", c.label, match ? "MATCHES KiCad" : "no" );
        if( !match )
            for( size_t i = 0; i < c.v.size(); ++i )
                if( c.v[i] != kicad[i] )
                { printf( "     first diff at %zu: got %s, KiCad %s\n", i + 1,
                          c.v[i].c_str(), kicad[i] ); break; }
    }
    return 0;
}
