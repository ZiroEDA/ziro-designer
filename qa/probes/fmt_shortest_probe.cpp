// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/*
 * fmt's `{}` for a double, from KiCad 10.0.5's own vendored fmt (12.1.0), the
 * expectation source for `shortest` in common/plotters/fmt.ts.
 *
 *   g++ -std=c++17 -DFMT_HEADER_ONLY -I/home/akshay/kicad-reference/thirdparty/fmt/include \
 *       -o fmt_shortest_probe qa/probes/fmt_shortest_probe.cpp
 */
#include <cstdio>
#include <fmt/format.h>

int main()
{
    const double values[] = { 0.0,      -0.0,    1.0,       -0.5,      0.931333,   -0.931334,
                              0.0001,   0.00001, 1.5e-05,   -2.5e-07,  1e15,       1e16,
                              1.5e16,   123.456, 0.1 + 0.2, 1e-4 * 3, 5e-324,     1.7976931348623157e308,
                              1234567.0, 0.508,  -0.000508 };

    for( double v : values )
        std::printf( "%.17g -> %s\n", v, fmt::format( "{}", v ).c_str() );

    return 0;
}
