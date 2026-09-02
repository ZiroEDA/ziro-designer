// SPDX-License-Identifier: GPL-3.0-or-later
// wxString::AfterLast, which NETINFO_ITEM::SetNetname uses for the short name.
#include <wx/string.h>
#include <cstdio>
int main()
{
    const char* cases[] = { "/Sheet1/SDA", "GND", "", "/Sheet1/", "/", "a/b/" };
    for( const char* c : cases )
    {
        wxString s( c );
        printf( "%-16s -> \"%s\"\n", ( "\"" + s + "\"" ).ToStdString().c_str(),
                s.AfterLast( '/' ).ToStdString().c_str() );
    }
    return 0;
}
