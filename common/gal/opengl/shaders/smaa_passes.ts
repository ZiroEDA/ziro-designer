// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gal/shaders/smaa_pass_{1,2,3}_{vert,frag*}.glsl`, the three SMAA
 * passes around `smaa_base.glsl`, in GLSL ES 3.00: `varying` is `in`/`out`,
 * `gl_MultiTexCoord0.st` is the `a_texCoord` attribute, `ftransform()` the
 * `a_position` attribute (the full-screen triangle is given in clip space
 * with identity matrices), `gl_FragColor` is `fragColor`.
 */

export const glsl_smaa_pass_1_vert = `
in vec4 a_position;
in vec2 a_texCoord;
out vec4 offset[3];
out vec2 texcoord;

void main()
{
    texcoord = a_texCoord;
    SMAAEdgeDetectionVS( texcoord, offset);
    gl_Position   = a_position;
}
`;

export const glsl_smaa_pass_1_frag_luma = `
in vec2 texcoord;
in vec4 offset[3];
out vec4 fragColor;

uniform sampler2D colorTex;

void main()
{
    fragColor = vec4( 0.0 );
    fragColor.xy = SMAALumaEdgeDetectionPS(texcoord, offset, colorTex).xy;
}
`;

export const glsl_smaa_pass_1_frag_color = `
in vec2 texcoord;
in vec4 offset[3];
out vec4 fragColor;

uniform sampler2D colorTex;

void main()
{
    fragColor = vec4( 0.0 );
    fragColor.xy = SMAAColorEdgeDetectionPS(texcoord, offset, colorTex).xy;
}
`;

export const glsl_smaa_pass_2_vert = `
in vec4 a_position;
in vec2 a_texCoord;
out vec4 offset[3];
out vec2 texcoord;
out vec2 pixcoord;

void main()
{
    texcoord = a_texCoord;
    SMAABlendingWeightCalculationVS( texcoord, pixcoord, offset );
    gl_Position = a_position;
}
`;

export const glsl_smaa_pass_2_frag = `
in vec2 texcoord;
in vec2 pixcoord;
in vec4 offset[3];
out vec4 fragColor;

uniform sampler2D edgesTex;
uniform sampler2D areaTex;
uniform sampler2D searchTex;

void main()
{
    fragColor = SMAABlendingWeightCalculationPS(texcoord, pixcoord, offset, edgesTex, areaTex, searchTex, vec4(0.,0.,0.,0.));
}
`;

export const glsl_smaa_pass_3_vert = `
in vec4 a_position;
in vec2 a_texCoord;
out vec4 offset;
out vec2 texcoord;

void main()
{
    texcoord = a_texCoord;
    SMAANeighborhoodBlendingVS( texcoord, offset );
    gl_Position = a_position;
}
`;

export const glsl_smaa_pass_3_frag = `
in vec2 texcoord;
in vec4 offset;
out vec4 fragColor;

uniform sampler2D colorTex;
uniform sampler2D blendTex;

void main()
{
    fragColor = SMAANeighborhoodBlendingPS(texcoord, offset, colorTex, blendTex);
}
`;
