// Recover the file-dialog order KiCad was given, by inverting std::sort.
// sortFileExtension only distinguishes drill (0) from .gbr (1), so for a fixed
// position of the drill file std::sort applies a permutation of POSITIONS that
// does not depend on the names. Invert it against KiCad's displayed order.
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

int main()
{
    const std::vector<std::string> kicad = {
        "PTH.drl", "B_Courtyard.gbr", "F_Fab.gbr", "Top_layer.gbr", "In1_Cu.gbr",
        "In2_Cu.gbr", "B_Cu.gbr", "F_Adhesive.gbr", "B_Adhesive.gbr",
        "F_Paste.gbr", "B_Paste.gbr", "B_Silkscreen.gbr", "F_Mask.gbr",
        "B_Mask.gbr", "User_Drawings.gbr", "User_Comments.gbr", "Edge_Cuts.gbr",
        "Margin.gbr", "F_Courtyard.gbr", "F_Silkscreen.gbr",
    };
    const int N = (int) kicad.size();

    for( int drillPos = 0; drillPos < N; ++drillPos )
    {
        // Sort the identity, with the drill's slot ranking first.
        std::vector<int> idx( N );
        for( int i = 0; i < N; ++i ) idx[i] = i;

        std::sort( idx.begin(), idx.end(), [&]( int a, int b ) {
            return ( a == drillPos ? 0 : 1 ) < ( b == drillPos ? 0 : 1 );
        } );

        // idx[i] is the INPUT slot that ended up at output position i, so the
        // input order that produces `kicad` is input[idx[i]] = kicad[i].
        std::vector<std::string> input( N );
        for( int i = 0; i < N; ++i ) input[ idx[i] ] = kicad[i];

        if( input[drillPos] != "PTH.drl" ) continue;   // inconsistent

        printf( "drill at input slot %2d gives dialog order:\n   ", drillPos );
        for( int i = 0; i < N; ++i ) printf( "%s ", input[i].c_str() );
        printf( "\n" );
    }
    return 0;
}
