// SPDX-License-Identifier: GPL-3.0-or-later
// What wxSplit actually does, asked of wxWidgets rather than guessed.
//
// `NETINFO_LIST::RebuildDisplayNetnames` splits a net name on '/' with
// wxSplit's DEFAULT escape character, which is '\\'. A net name may contain a
// backslash — EscapeString(CTX_NETNAME) escapes '/' and drops newlines and
// nothing else — so the escape is reachable, and the port has to match whatever
// wx does with it, including the empty-token cases.
#include <wx/string.h>
#include <wx/arrstr.h>
#include <cstdio>

static void show( const char* label, const wxString& s )
{
    wxArrayString parts = wxSplit( s, '/' );
    printf( "%-28s %-22s -> %zu [", label, ( "\"" + s + "\"" ).ToStdString().c_str(),
            (size_t) parts.GetCount() );
    for( size_t i = 0; i < parts.GetCount(); ++i )
        printf( "%s\"%s\"", i ? ", " : "", parts[i].ToStdString().c_str() );
    printf( "]\n" );
}

int main()
{
    show( "leading slash", "/Sheet1/SDA" );
    show( "no slash", "GND" );
    show( "empty", "" );
    show( "trailing slash", "/Sheet1/" );
    show( "double slash", "/a//b" );
    show( "backslash before sep", "/Sheet\\/SDA" );
    show( "backslash elsewhere", "/She\\et/SDA" );
    show( "trailing backslash", "/Sheet\\" );
    show( "only a slash", "/" );
    return 0;
}
