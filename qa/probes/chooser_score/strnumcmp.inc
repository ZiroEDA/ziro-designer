int StrNumCmp( const wxString& aString1, const wxString& aString2, bool aIgnoreCase )
{
    int nb1 = 0, nb2 = 0;

    auto str1 = aString1.begin();
    auto str2 = aString2.begin();

    const auto str1End = aString1.end();
    const auto str2End = aString2.end();

    while( str1 != str1End && str2 != str2End )
    {
        wxUniChar c1 = *str1;
        wxUniChar c2 = *str2;

        if( wxIsdigit( c1 ) && wxIsdigit( c2 ) ) // Both characters are digits, do numeric compare.
        {
            nb1 = 0;
            nb2 = 0;

            do
            {
                c1 = *str1;
                nb1 = nb1 * 10 + (int) c1 - '0';
                ++str1;
            } while( str1 != str1End && wxIsdigit( *str1 ) );

            do
            {
                c2 = *str2;
                nb2 = nb2 * 10 + (int) c2 - '0';
                ++str2;
            } while( str2 != str2End && wxIsdigit( *str2 ) );

            if( nb1 < nb2 )
                return -1;

            if( nb1 > nb2 )
                return 1;

            c1 = ( str1 != str1End ) ? *str1 : wxUniChar( 0 );
            c2 = ( str2 != str2End ) ? *str2 : wxUniChar( 0 );
        }

        // Any numerical comparisons to here are identical.
        if( aIgnoreCase )
        {
            if( c1 != c2 )
            {
                wxUniChar uc1 = wxToupper( c1 );
                wxUniChar uc2 = wxToupper( c2 );

                if( uc1 != uc2 )
                    return uc1 < uc2 ? -1 : 1;
            }
        }
        else
        {
            if( c1 < c2 )
                return -1;

            if( c1 > c2 )
                return 1;
        }

        if( str1 != str1End )
            ++str1;

        if( str2 != str2End )
            ++str2;
    }

    if( str1 == str1End && str2 != str2End )
    {
        return -1;   // Identical to here but aString1 is longer.
    }
    else if( str1 != str1End && str2 == str2End )
    {
        return 1;    // Identical to here but aString2 is longer.
    }

    return 0;
}
