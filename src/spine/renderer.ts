// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// WebGL2 renderer

/**
 * Draws `TriangleList`s with one WebGL2 program. Each frame fills one vertex buffer and one index buffer, and starts a new draw call only
 * when the page texture changes. Colour is premultiplied throughout: the page textures are uploaded premultiplied, the vertex tint is
 * premultiplied, and every list blends with `ONE, ONE_MINUS_SRC_ALPHA`. `MATH.md` records the blend.
 */

import type { TriangleList } from "./geometry.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Floats per vertex: position x, y, then uv u, v, then premultiplied colour r, g, b, a. */
const FLOATS_PER_VERTEX = 8;

/** Bytes per float in the vertex buffer. */
const BYTES_PER_FLOAT = 4;

/** Bytes per index in the index buffer, which holds 32-bit indices. */
const BYTES_PER_INDEX = 4;

/** Location of the position attribute, bound before the program links so the vertex array layout is fixed. */
const POSITION_LOCATION = 0;

/** Location of the uv attribute. */
const UV_LOCATION = 1;

/** Location of the premultiplied colour attribute. */
const COLOR_LOCATION = 2;

/** Vertex shader: maps world positions through the projection and passes the uv and tint on. */
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform mat3 u_projection;
out vec2 v_uv;
out vec4 v_color;
void main() {
	v_uv = a_uv;
	v_color = a_color;
	gl_Position = vec4((u_projection * vec3(a_position, 1.0)).xy, 0.0, 1.0);
}
`;

/** Fragment shader: the premultiplied texel times the premultiplied tint. */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
	fragColor = texture(u_texture, v_uv) * v_color;
}
`;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** The world-space rectangle a frame shows, mapped onto the whole viewport with y up. */
export interface View {
	/** World X at the viewport's left edge. */
	minX: number;
	/** World Y at the viewport's bottom edge. */
	minY: number;
	/** World X at the viewport's right edge. */
	maxX: number;
	/** World Y at the viewport's top edge. */
	maxY: number;
}

/** One draw call: a run of indices that all sample the same texture. */
interface Batch {
	/** The page texture the run samples. */
	texture: WebGLTexture;
	/** Index of the run's first entry in the index buffer. */
	start: number;
	/** Number of indices in the run. */
	count: number;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Compiles one shader stage.
 *
 * @param gl The WebGL2 context.
 * @param type `VERTEX_SHADER` or `FRAGMENT_SHADER`.
 * @param source The GLSL source.
 * @returns The compiled shader.
 */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error("Could not create a shader");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile failed: ${log}`);
	}
	return shader;
}

/**
 * Compiles and links the renderer's program, with the attribute locations fixed before linking.
 *
 * @param gl The WebGL2 context.
 * @returns The linked program.
 */
function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	const program = gl.createProgram();
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.bindAttribLocation(program, POSITION_LOCATION, "a_position");
	gl.bindAttribLocation(program, UV_LOCATION, "a_uv");
	gl.bindAttribLocation(program, COLOR_LOCATION, "a_color");
	gl.linkProgram(program);
	// The shaders are no longer needed once linked. Deleting them now frees them with the program.
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link failed: ${log}`);
	}
	return program;
}

/**
 * Builds the column-major 3x3 matrix that maps a view rectangle to clip space, with world y up.
 *
 * @param view The world rectangle to show.
 * @returns The matrix, ready for `uniformMatrix3fv`.
 */
function projection(view: View): Float32Array {
	const sx = 2 / (view.maxX - view.minX);
	const sy = 2 / (view.maxY - view.minY);
	return new Float32Array([sx, 0, 0, 0, sy, 0, -1 - view.minX * sx, -1 - view.minY * sy, 1]);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Renderer

/** A WebGL2 renderer for triangle lists, with one program, one dynamic vertex buffer and one dynamic index buffer. */
export class SpineRenderer {
	/** The context everything is drawn with. The caller owns it. */
	private readonly gl: WebGL2RenderingContext;
	/** The one program. */
	private readonly program: WebGLProgram;
	/** The vertex array holding the attribute layout. */
	private readonly vao: WebGLVertexArrayObject;
	/** The dynamic vertex buffer, refilled every frame. */
	private readonly vertexBuffer: WebGLBuffer;
	/** The dynamic index buffer, refilled every frame. */
	private readonly indexBuffer: WebGLBuffer;
	/** Location of the projection matrix uniform. */
	private readonly projectionLocation: WebGLUniformLocation | null;
	/** Every texture `upload` made and `release` has not freed yet, so `dispose` can free the rest. */
	private readonly textures = new Set<WebGLTexture>();
	/** Scratch vertex data, grown as needed and reused across frames. */
	private vertices = new Float32Array(0);
	/** Scratch index data, grown as needed and reused across frames. */
	private indices = new Uint32Array(0);

	/**
	 * Builds the program, buffers and vertex layout.
	 *
	 * @param gl The WebGL2 context to draw with.
	 */
	constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.program = createProgram(gl);
		this.projectionLocation = gl.getUniformLocation(this.program, "u_projection");
		this.vao = gl.createVertexArray();
		this.vertexBuffer = gl.createBuffer();
		this.indexBuffer = gl.createBuffer();

		gl.bindVertexArray(this.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		const stride = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;
		gl.enableVertexAttribArray(POSITION_LOCATION);
		gl.vertexAttribPointer(POSITION_LOCATION, 2, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(UV_LOCATION);
		gl.vertexAttribPointer(UV_LOCATION, 2, gl.FLOAT, false, stride, 2 * BYTES_PER_FLOAT);
		gl.enableVertexAttribArray(COLOR_LOCATION);
		gl.vertexAttribPointer(COLOR_LOCATION, 4, gl.FLOAT, false, stride, 4 * BYTES_PER_FLOAT);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		gl.bindVertexArray(null);

		gl.useProgram(this.program);
		gl.uniform1i(gl.getUniformLocation(this.program, "u_texture"), 0);
	}

	/**
	 * Uploads a page image as a texture with LINEAR filtering, CLAMP_TO_EDGE and no mipmaps. The image must already be premultiplied, and
	 * its first row becomes v = 0, matching the page UVs.
	 *
	 * @param image The page image.
	 * @returns The texture.
	 */
	upload(image: ImageBitmap): WebGLTexture {
		const gl = this.gl;
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.textures.add(texture);
		return texture;
	}

	/**
	 * Frees a texture `upload` made.
	 *
	 * @param texture The texture to free.
	 */
	release(texture: WebGLTexture): void {
		if (this.textures.delete(texture)) {
			this.gl.deleteTexture(texture);
		}
	}

	/**
	 * Clears the viewport and draws the lists in order, back to front. Every list uses the normal premultiplied blend, whatever its
	 * `blendMode`. A list whose page has no texture is skipped.
	 *
	 * @param lists The triangle lists, in draw order.
	 * @param textures Each atlas page's texture, by page index.
	 * @param view The world rectangle mapped onto the whole viewport.
	 * @param width Viewport width in device pixels.
	 * @param height Viewport height in device pixels.
	 */
	draw(lists: TriangleList[], textures: WebGLTexture[], view: View, width: number, height: number): void {
		const gl = this.gl;
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		let vertexCount = 0;
		let indexCount = 0;
		for (const list of lists) {
			vertexCount += list.positions.length / 2;
			indexCount += list.indices.length;
		}
		if (indexCount === 0) {
			return;
		}
		if (this.vertices.length < vertexCount * FLOATS_PER_VERTEX) {
			this.vertices = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
		}
		if (this.indices.length < indexCount) {
			this.indices = new Uint32Array(indexCount);
		}

		// Fill both buffers in one pass, opening a new batch only when the texture changes.
		const vertices = this.vertices;
		const indices = this.indices;
		const batches: Batch[] = [];
		let vertex = 0;
		let index = 0;
		for (const list of lists) {
			const texture = textures[list.page];
			if (!texture) {
				continue;
			}
			const { r, g, b, a } = list.color;
			const first = vertex;
			for (let i = 0; i < list.positions.length; i += 2) {
				let o = vertex * FLOATS_PER_VERTEX;
				vertices[o++] = list.positions[i]!;
				vertices[o++] = list.positions[i + 1]!;
				vertices[o++] = list.uvs[i]!;
				vertices[o++] = list.uvs[i + 1]!;
				vertices[o++] = r * a;
				vertices[o++] = g * a;
				vertices[o++] = b * a;
				vertices[o] = a;
				vertex++;
			}
			const start = index;
			for (const k of list.indices) {
				indices[index++] = first + k;
			}
			const last = batches[batches.length - 1];
			if (last && last.texture === texture) {
				last.count += index - start;
			} else {
				batches.push({ texture, start, count: index - start });
			}
		}

		gl.useProgram(this.program);
		gl.uniformMatrix3fv(this.projectionLocation, false, projection(view));
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.bindVertexArray(this.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, vertex * FLOATS_PER_VERTEX), gl.DYNAMIC_DRAW);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, index), gl.DYNAMIC_DRAW);
		gl.activeTexture(gl.TEXTURE0);
		for (const batch of batches) {
			gl.bindTexture(gl.TEXTURE_2D, batch.texture);
			gl.drawElements(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, batch.start * BYTES_PER_INDEX);
		}
		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/** Frees the program, buffers, vertex array and every texture still held. The context itself is left to its owner. */
	dispose(): void {
		const gl = this.gl;
		for (const texture of this.textures) {
			gl.deleteTexture(texture);
		}
		this.textures.clear();
		gl.deleteBuffer(this.vertexBuffer);
		gl.deleteBuffer(this.indexBuffer);
		gl.deleteVertexArray(this.vao);
		gl.deleteProgram(this.program);
	}
}
