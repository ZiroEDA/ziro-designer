// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gal/opengl/shader.h` + `.cpp`: `KIGFX::SHADER`, a program built from
 * source strings, with its uniforms registered as numbered parameters.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/// Type definition for the shader
export enum SHADER_TYPE {
  SHADER_TYPE_VERTEX = 0x8b31, ///< Vertex shader (GL_VERTEX_SHADER)
  SHADER_TYPE_FRAGMENT = 0x8b30, ///< Fragment shader (GL_FRAGMENT_SHADER)
  SHADER_TYPE_GEOMETRY = 0x8dd9, ///< Geometry shader (not in WebGL)
}

/**
 * Provide the access to the OpenGL shaders.
 *
 * The purpose of this class is advanced drawing with OpenGL. One example is using the pixel
 * shader to draw exact circles or for anti-aliasing. This class supports vertex, geometry
 * and fragment shaders.
 * <br>
 * Make sure that the hardware supports these features. This can be checked with the OpenGL
 * extensions and the shader compilation status.
 */
export class SHADER {
  private shaderNumbers: WebGLShader[] = []; ///< Shader number list
  private programNumber: WebGLProgram | null; ///< Shader program number
  private isProgramCreated: boolean; ///< Flag for program creation
  private isShaderLinked: boolean; ///< Is the shader linked?
  private active: boolean; ///< Is any of shaders used?
  private maximumVertices: number; ///< The maximum of vertices to be generated

  ///< Input type [e.g. GL_LINES, GL_TRIANGLES, GL_QUADS etc.]
  private geomInputType: number;

  ///< Output type [e.g. GL_LINES, GL_TRIANGLES, GL_QUADS etc.]
  private geomOutputType: number;
  private parameterLocation: WebGLUniformLocation[] = []; ///< Location of the parameter

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.isProgramCreated = false;
    this.isShaderLinked = false;
    this.active = false;
    this.maximumVertices = 4;
    this.geomInputType = gl.LINES;
    this.geomOutputType = gl.LINES;

    // Do not have uninitialized members:
    this.programNumber = null;
  }

  /** `~SHADER`. */
  destroy(): void {
    if (this.active) this.Deactivate();

    if (this.isProgramCreated) {
      // Delete the shaders and the program
      for (const shader of this.shaderNumbers) {
        if (this.gl.isShader(shader)) {
          this.gl.detachShader(this.programNumber!, shader);
          this.gl.deleteShader(shader);
        }
      }

      this.gl.deleteProgram(this.programNumber);
    }
  }

  /**
   * Add a shader and compile the shader sources.
   *
   * @param aArgs is the list of strings (std::string or convertible to const char*) which
   *              are concatenated and compiled as a single shader source code.
   * @param aShaderType is the type of the shader.
   * @return True in case of success, false otherwise.
   */
  LoadShaderFromStrings(aShaderType: SHADER_TYPE, ...aArgs: string[]): boolean {
    return this.loadShaderFromStringArray(aShaderType, aArgs);
  }

  /**
   * Configure the geometry shader - has to be done before linking!
   *
   * @param maxVertices is the maximum number of vertices to be generated.
   * @param geometryInputType is the input type [e.g. GL_LINES, GL_TRIANGLES, GL_QUADS etc.]
   * @param geometryOutputType is the output type [e.g. GL_LINES, GL_TRIANGLES, GL_QUADS etc.]
   */
  ConfigureGeometryShader(
    maxVertices: number,
    geometryInputType: number,
    geometryOutputType: number,
  ): void {
    this.maximumVertices = maxVertices;
    this.geomInputType = geometryInputType;
    this.geomOutputType = geometryOutputType;
  }

  /**
   * Link the shaders.
   *
   * @return true in case of success, false otherwise.
   */
  Link(): boolean {
    const gl = this.gl;

    // Shader linking
    gl.linkProgram(this.programNumber!);
    this.programInfo(this.programNumber!);

    // Check the Link state
    this.isShaderLinked = !!gl.getProgramParameter(this.programNumber!, gl.LINK_STATUS);

    return this.isShaderLinked;
  }

  /**
   * Return true if shaders are linked correctly.
   */
  IsLinked(): boolean {
    return this.isShaderLinked;
  }

  /**
   * Use the shader.
   */
  Use(): void {
    this.gl.useProgram(this.programNumber);
    this.active = true;
  }

  /**
   * Deactivate the shader and use the default OpenGL program.
   */
  Deactivate(): void {
    this.gl.useProgram(null);
    this.active = false;
  }

  /**
   * Return the current state of the shader.
   *
   * @return True if any of shaders is enabled.
   */
  IsActive(): boolean {
    return this.active;
  }

  /**
   * Add a parameter to the parameter queue.
   *
   * To communicate with the shader use this function to set up the names for the uniform
   * variables. These are queued in a list and can be assigned with the SetParameter(..)
   * method using the queue position.
   *
   * @param aParameterName is the name of the parameter.
   * @return the added parameter location.
   */
  AddParameter(aParameterName: string): number {
    const location = this.gl.getUniformLocation(this.programNumber!, aParameterName);

    if (location !== null) this.parameterLocation.push(location);
    else throw new Error(`Could not find shader uniform: ${aParameterName}`);

    return this.parameterLocation.length - 1;
  }

  /**
   * Set a parameter of the shader.
   *
   * @param aParameterNumber is the number of the parameter.
   * @param aValue is the value of the parameter.
   */
  SetParameter(aParameterNumber: number, aValue: number): void;
  SetParameter(aParameterNumber: number, aValue: Vec2): void;
  SetParameter(aParameterNumber: number, f0: number, f1: number, f2: number, f3: number): void;
  SetParameter(
    aParameterNumber: number,
    a: number | Vec2,
    f1?: number,
    f2?: number,
    f3?: number,
  ): void {
    console.assert(aParameterNumber < this.parameterLocation.length);
    const gl = this.gl;

    if (typeof a !== 'number') {
      gl.uniform2f(this.parameterLocation[aParameterNumber]!, a.x, a.y);
      return;
    }

    if (f1 !== undefined) {
      gl.uniform4fv(this.parameterLocation[aParameterNumber]!, [a, f1, f2!, f3!]);
      return;
    }

    gl.uniform1f(this.parameterLocation[aParameterNumber]!, a);
  }

  /**
   * The uniform location a parameter number stands for, for the one uniform
   * the fixed pipeline used to supply (`gl_ModelViewProjectionMatrix`).
   */
  Location(aParameterNumber: number): WebGLUniformLocation {
    console.assert(aParameterNumber < this.parameterLocation.length);
    return this.parameterLocation[aParameterNumber]!;
  }

  /** `SetParameter( int aParameterNumber, int aValue )`: the integer overload. */
  SetParameterInt(aParameterNumber: number, aValue: number): void {
    console.assert(aParameterNumber < this.parameterLocation.length);
    this.gl.uniform1i(this.parameterLocation[aParameterNumber]!, aValue);
  }

  /**
   * Return the attribute location.
   *
   * @param aAttributeName is the name of the attribute.
   * @return the attribute location.
   */
  GetAttribute(aAttributeName: string): number {
    return this.gl.getAttribLocation(this.programNumber!, aAttributeName);
  }

  /**
   * Compile vertex of fragment shader source code into the program.
   */
  private loadShaderFromStringArray(aShaderType: SHADER_TYPE, aArray: string[]): boolean {
    console.assert(!this.isShaderLinked);
    const gl = this.gl;

    // Create the program
    if (!this.isProgramCreated) {
      this.programNumber = gl.createProgram();
      this.isProgramCreated = true;
    }

    // Create a shader
    const shaderNumber = gl.createShader(aShaderType)!;
    this.shaderNumbers.push(shaderNumber);

    // Get the program info
    this.programInfo(this.programNumber!);

    // Attach the sources
    gl.shaderSource(shaderNumber, aArray.join(''));
    this.programInfo(this.programNumber!);

    // Compile and attach shader to the program
    gl.compileShader(shaderNumber);

    const status = gl.getShaderParameter(shaderNumber, gl.COMPILE_STATUS);

    if (!status) {
      this.shaderInfo(shaderNumber);

      const errorLog = gl.getShaderInfoLog(shaderNumber) ?? '';

      // Provide the infolog in whatever manor you deem best.
      // Exit with failure.
      gl.deleteShader(shaderNumber); // Don't leak the shader.
      throw new Error(errorLog);
    }

    gl.attachShader(this.programNumber!, shaderNumber);
    this.programInfo(this.programNumber!);

    // Special handling for the geometry shader: none in WebGL

    return true;
  }

  /**
   * Get the shader program information.
   *
   * @param aProgram is the program number.
   */
  private programInfo(aProgram: WebGLProgram): void {
    // Get the length of the info string; print the information (a debug aid in the C++)
    this.gl.getProgramInfoLog(aProgram);
  }

  /**
   * Get the shader information.
   *
   * @param aShader is the shader number.
   */
  private shaderInfo(aShader: WebGLShader): void {
    this.gl.getShaderInfoLog(aShader);
  }
}
