// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gal/shaders/kicad_frag.glsl` (`BUILTIN_SHADERS::glsl_kicad_frag`),
 * in GLSL ES 3.00: `varying` is `in`, `gl_Color` is the flat `v_color`,
 * `gl_TexCoord[0].st` is `v_texCoord`, `gl_FragColor` is `fragColor`,
 * `texture2D` is `texture`. Everything else is the reference line for line.
 */

export const glsl_kicad_frag = `#version 300 es
precision highp float;

// Multi-channel signed distance field
#define USE_MSDF

// Shader types
const float SHADER_FILLED_CIRCLE        = 2.0;
const float SHADER_STROKED_CIRCLE       = 3.0;
const float SHADER_FONT                 = 4.0;
const float SHADER_LINE_A               = 5.0;
const float SHADER_HOLE_WALL            = 11.0;

in vec4 v_shaderParams;
in vec2 v_circleCoords;
in vec2 v_texCoord;
flat in vec4 v_color;
out vec4 fragColor;

uniform sampler2D u_fontTexture;
uniform float u_worldPixelSize;

// Needed to reconstruct the mipmap level / texel derivative
uniform int u_fontTextureWidth;

void filledCircle( vec2 aCoord )
{
    if( dot( aCoord, aCoord ) < 1.0 )
        fragColor = v_color;
    else
        discard;
}

float pixelSegDistance( vec2 aCoord )
{
    float aspect = v_shaderParams[1];
    float dist;
    vec2 v = vec2( 1.0 - ( aspect - abs( aCoord.s ) ), aCoord.t );

    if( v.x <= 0.0 )
    {
        dist = abs( aCoord.t );
    }
    else
    {
        dist = length( v );
    }

    return dist;
}

int isPixelInSegment( vec2 aCoord )
{
    return pixelSegDistance( aCoord ) <= 1.0 ? 1 : 0;
}

void strokedCircle( vec2 aCoord, float aRadius, float aWidth )
{
    float outerRadius = max( aRadius, 0.0 );
    float innerRadius = max( aRadius - aWidth, 0.0 );

    if( ( dot( aCoord, aCoord ) < 1.0 ) &&
        ( dot( aCoord, aCoord ) * ( outerRadius * outerRadius ) > innerRadius * innerRadius ) )
        fragColor = v_color;
    else
        discard;
}

void drawLine( vec2 aCoord )
{
    if( isPixelInSegment( aCoord ) != 0)
        fragColor = v_color;
    else
        discard;
}

#ifdef USE_MSDF
float median( vec3 v )
{
    return max( min( v.r, v.g ), min( max( v.r, v.g ), v.b ) );
}
#endif

void main()
{
    // VS to FS pipeline does math that means we can't rely on the mode
    // parameter being bit-exact without rounding it first.
    float mode = floor( v_shaderParams[0] + 0.5 );

    if( mode == SHADER_LINE_A )
    {
        drawLine( v_texCoord );
    }
    else if( mode == SHADER_FILLED_CIRCLE )
    {
        filledCircle( v_circleCoords );
    }
    else if( mode == SHADER_STROKED_CIRCLE )
    {
        strokedCircle( v_circleCoords, v_shaderParams[2], v_shaderParams[3] );
    }
    else if( mode == SHADER_HOLE_WALL )
    {
        strokedCircle( v_circleCoords, v_shaderParams[2], v_shaderParams[3] );
    }
    else if( mode == SHADER_FONT )
    {
        vec2 tex           = v_shaderParams.yz;

        // Unless we're stretching chars it is okay to consider
        // one derivative for filtering
        float derivative   = length( dFdx( tex ) ) * float( u_fontTextureWidth ) / 4.0;

#ifdef USE_MSDF
        float dist         = median( texture( u_fontTexture, tex ).rgb );
#else
        float dist         = texture( u_fontTexture, tex ).r;
#endif

        // use the derivative for zoom-adaptive filtering
        float alpha = smoothstep( 0.5 - derivative, 0.5 + derivative, dist ) * v_color.a;

        fragColor = vec4( v_color.rgb, alpha );
    }
    else
    {
        // Simple pass-through
        fragColor = v_color;
    }
}
`;
