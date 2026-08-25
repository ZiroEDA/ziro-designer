// SPDX-License-Identifier: GPL-2.0-or-later
// A standalone oracle for the stripline engine.
//
// KiCad 10.0.5 ships no test for STRIPLINE, and our port was only ever
// exercised INDIRECTLY, through the coupled-stripline vectors. An expectation
// computed by calling our own TypeScript would be the first shape of test that
// cannot fail, so the numbers in
// qa/unittests/pcb_calculator/stripline_oracle.test.ts come from here instead:
// the bodies below are KiCad's own source text, copied verbatim from
//   common/transline_calculations/stripline.cpp        (Analyse, lineImpedance)
//   common/transline_calculations/transline_calculation_base.cpp:147-159
//                                                      (SkinDepth, UnitPropagationDelay)
//   include/transline_calculations/units.h:61-68       (MU0, C0, ZF0, LOG2DB)
// with `GetParameter( TCP::X )` rewritten as the plain double `X`. Nothing
// else is changed; the arithmetic is C++'s, compiled by this machine's
// compiler, and is independent of the port under test.
//
//   g++ -O2 -o stripline_oracle stripline_oracle.cpp && ./stripline_oracle

#include <cmath>
#include <cstdio>

namespace TC {
constexpr double MU0 = 12.566370614e-7;
constexpr double C0 = 299792458.0;
constexpr double ZF0 = 376.730313668;
const double LOG2DB = 20.0 / log( 10.0 );
}

struct P {
    // Declared in the order the case table below writes them; H (the
    // ground-plane spacing, b) is set separately in main.
    double W, L, T, A, ER, TAND, F, SIGMA, MURC, H;
};

// STRIPLINE::lineImpedance, stripline.cpp:130-172.
static double lineImpedance( const P& p, double aHeight, double& aAc )
{
    double       ZL;
    const double hmt = aHeight - p.T;

    aAc = sqrt( p.F / p.SIGMA / 17.2 );

    if( p.W / hmt >= 0.35 )
    {
        ZL = p.W + ( 2.0 * aHeight * log( ( 2.0 * aHeight - p.T ) / hmt )
                     - p.T * log( aHeight * aHeight / hmt / hmt - 1.0 ) ) / M_PI;
        ZL = TC::ZF0 * hmt / sqrt( p.ER ) / 4.0 / ZL;

        aAc *= 2.02e-6 * p.ER * ZL / hmt;
        aAc *= 1.0 + 2.0 * p.W / hmt
               + ( aHeight + p.T ) / hmt / M_PI * log( 2.0 * aHeight / p.T - 1.0 );
    }
    else
    {
        double tdw = p.T / p.W;

        if( p.T / p.W > 1.0 )
            tdw = p.W / p.T;

        double de = 1.0 + tdw / M_PI * ( 1.0 + log( 4.0 * M_PI / tdw ) ) + 0.236 * pow( tdw, 1.65 );

        if( p.T / p.W > 1.0 )
            de *= p.T / 2.0;
        else
            de *= p.W / 2.0;

        ZL = TC::ZF0 / 2.0 / M_PI / sqrt( p.ER ) * log( 4.0 * aHeight / M_PI / de );

        aAc *= 0.01141 / ZL / de;
        aAc *= de / aHeight + 0.5 + tdw / 2.0 / M_PI + 0.5 / M_PI * log( 4.0 * M_PI / tdw )
               + 0.1947 * pow( tdw, 0.65 ) - 0.0767 * pow( tdw, 1.65 );
    }

    return ZL;
}

int main()
{
    // Every case below fixes L = 50 mm, f = 1 GHz, sigma = 5.8e7 S/m (copper),
    // murc = 1, tand = 0.02 -- the transmission line panel's own defaults
    // (transline_ident.cpp) -- and varies W, H, T and A.
    const P cases[] = {
        // W        L      T        A       ER   TAND  F     SIGMA   MURC
        { 0.2e-3,  50e-3, 0.035e-3, 0.8e-3, 4.5, 0.02, 1e9,  5.8e7,  1.0 }, // panel defaults
        { 1.0e-3,  50e-3, 0.035e-3, 0.8e-3, 4.5, 0.02, 1e9,  5.8e7,  1.0 }, // W/hmt >= 0.35 branch
        { 0.1e-3,  50e-3, 0.035e-3, 0.8e-3, 4.5, 0.02, 1e9,  5.8e7,  1.0 }, // narrow, other branch
        { 0.35e-3, 25e-3, 0.0175e-3, 0.5e-3, 2.2, 0.001, 5e9, 5.8e7, 1.0 }, // PTFE, 5 GHz
        { 2.0e-3,  10e-3, 0.07e-3,  1.0e-3, 10.2, 0.0023, 2e9, 5.8e7, 1.0 }, // alumina
        // Strongly OFF-CENTRE. `a` is a parameter, not (h - t) / 2, and these
        // two are the same line seen from either plane: swapping a for
        // h - a - t swaps the two half-line heights, so Z0 must be identical.
        { 0.5e-3,  50e-3, 0.035e-3, 0.3e-3, 4.5, 0.02, 1e9,  5.8e7,  1.0 },
        { 0.5e-3,  50e-3, 0.035e-3, 1.265e-3, 4.5, 0.02, 1e9, 5.8e7, 1.0 },
        // W chosen so BOTH half-lines land in [0.30, 0.35): W / hmt is 0.32
        // below and 0.3346 above, either side of `lineImpedance`'s
        // `W / hmt >= 0.35` branch (stripline.cpp:136) and inside it. Without
        // this the threshold is unpinned -- moving it to 0.30 changed nothing
        // any other vector could see.
        { 0.512e-3, 50e-3, 0.035e-3, 0.8e-3, 4.5, 0.02, 1e9, 5.8e7, 1.0 },
    };

    printf( "  //  W(m)      H(m)      T(m)      A(m)      er     Z0            ang_l(rad)    "
            "eps_eff  cond(dB)      diel(dB)      skin(m)\n" );

    for( const P& c0 : cases )
    {
        P p = c0;
        p.H = 1.6e-3; // b, the ground-plane spacing

        // STRIPLINE::Analyse, stripline.cpp:32-52.
        const double skin = 1.0 / sqrt( M_PI * p.F * p.MURC * TC::MU0 * p.SIGMA );
        const double epsEff = p.ER; // "no dispersion"

        double ac1, ac2;
        const double z0 = 2.0 / ( 1.0 / lineImpedance( p, 2.0 * p.A + p.T, ac1 )
                                  + 1.0 / lineImpedance( p, 2.0 * ( p.H - p.A ) - p.T, ac2 ) );
        const double lossCond = p.L * ( ac1 + ac2 );
        const double lossDiel = TC::LOG2DB * p.L * ( M_PI / TC::C0 ) * p.F * sqrt( p.ER ) * p.TAND;
        const double angL = 2.0 * M_PI * p.L * sqrt( p.ER ) * p.F / TC::C0;
        const double upd = sqrt( epsEff ) * ( 1.0e10 / 2.99e8 );

        printf( "  [%.6g, %.6g, %.6g, %.6g, %.6g, %.17g, %.17g, %.17g, %.17g, %.17g, %.17g, %.17g],\n",
                p.W, p.H, p.T, p.A, p.ER, z0, angL, epsEff, lossCond, lossDiel, skin, upd );
    }

    return 0;
}
