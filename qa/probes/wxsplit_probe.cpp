// What wxSplit( s, sep ) returns with the default '\\' escape, on this machine's wx.
// Build: g++ wxsplit_probe.cpp $(wx-config --cxxflags --libs base) -o wxsplit_probe
#include <wx/arrstr.h>
#include <wx/init.h>
#include <cstdio>

int main()
{
    wxInitializer init;
    const char* cases[] = { "SYMBOL Misc\\\\jumper -752 -240 M0", "a\\ b c", "a\\\\ b", "x\\y z", "a  b ", "" };

    for( const char* c : cases )
    {
        wxArrayString t = wxSplit( wxString( c ), ' ' );
        printf( "[%s] ->", c );

        for( const wxString& s : t )
            printf( " <%s>", (const char*) s.utf8_str() );

        printf( "\n" );
    }
}
