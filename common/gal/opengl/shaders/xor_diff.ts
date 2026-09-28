// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gal/shaders/xor_diff_vert.glsl` and `xor_diff_frag.glsl`
 * (`BUILTIN_SHADERS::glsl_xor_diff_vert` / `_frag`), the XOR/difference mode
 * shaders for gerbview layer comparison, in GLSL ES 3.00. The 1.20 vertex
 * shader passes `gl_Vertex` and `gl_MultiTexCoord0` straight through; those
 * are the fixed pipeline's full-screen quad, here the `a_position` and
 * `a_texCoord` attributes the fixed-function shim draws it with.
 */

export const glsl_xor_diff_vert = `#version 300 es
precision highp float;

in vec4 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main()
{
    v_texCoord = a_texCoord;
    gl_Position = a_position;
}
`;

export const glsl_xor_diff_frag = `#version 300 es
precision highp float;

uniform sampler2D srcTex;
uniform sampler2D dstTex;

in vec2 v_texCoord;
out vec4 fragColor;

void main()
{
    vec2 tc = v_texCoord;
    vec4 srcColor = texture( srcTex, tc );
    vec4 dstColor = texture( dstTex, tc );

    // XOR/Difference mode: absolute difference of color channels
    // Identical overlapping content cancels to black (0,0,0)
    // Different content shows the difference
    vec3 diff = abs( srcColor.rgb - dstColor.rgb );

    // Use maximum alpha from either layer
    float alpha = max( srcColor.a, dstColor.a );

    fragColor = vec4( diff, alpha );
}
`;
