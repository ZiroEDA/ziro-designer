// What wxString::ToCDouble leaves in its output when the text is not wholly a
// number. GerbView's ReadXYCoord / ReadIJCoord / ReadDouble all parse through
// it, and a Gerber number is routinely followed by X, Y, D, * or ','.
//
//   g++ -o /tmp/tocd qa/probes/gerbview_tocdouble_probe.cpp $(wx-config --cxxflags --libs base)
#include <cstdio>
#include <wx/init.h>
#include <wx/string.h>

int main()
{
    wxInitializer init;
    const char* texts[] = { "0.5X0X0", "12", "-3", "abc", "1.5e3", "+", "", "0x1A", ".5",
                            "3 4", "1.25 ", " 2", "-.5", "1.", "007", "12D01" };

    for( const char* s : texts )
    {
        double v = -777;
        bool ok = wxString( s ).ToCDouble( &v );
        printf( "[%s] ok=%d v=%.17g\n", s, ok, v );
    }
}
