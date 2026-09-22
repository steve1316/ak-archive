// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// WebGL2 renderer

/**
 * Draws `TriangleList`s with one WebGL2 program. Each frame fills one vertex buffer and one index buffer, and starts a new draw call only
 * when the page texture or the blend mode changes. Colour is premultiplied throughout: the page textures are uploaded premultiplied, the
 * shader's output is premultiplied, and each blend mode's factors are written for premultiplied colour. Every slot goes through the
 * two-color tint, which is the plain tint when the dark color is black. `MATH.md` ("Drawing") records the formulas.
 */

import type { TriangleList } from "./geometry.js";
import type { BlendMode, Color } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Floats per vertex: position x, y, then uv u, v, then the straight light color r, g, b, a, then the dark color r, g, b. */
const FLOATS_PER_VERTEX = 11;

/** Bytes per float in the vertex buffer. */
const BYTES_PER_FLOAT = 4;

/** Bytes per index in the index buffer, which holds 32-bit indices. */
const BYTES_PER_INDEX = 4;

/** Location of the position attribute, bound before the program links so the vertex array layout is fixed. */
const POSITION_LOCATION = 0;

/** Location of the uv attribute. */
const UV_LOCATION = 1;

/** Location of the straight light color attribute. */
const LIGHT_LOCATION = 2;

/** Location of the dark color attribute. */
const DARK_LOCATION = 3;

/** The dark color a slot without one draws with. Black makes the two-color tint the plain tint. */
const NO_DARK: Color = { r: 0, g: 0, b: 0, a: 1 };

/** Vertex shader: maps world positions through the projection and passes the uv and both colors on. */
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_light;
in vec3 a_dark;
uniform mat3 u_projection;
out vec2 v_uv;
out vec4 v_light;
out vec3 v_dark;
void main() {
	v_uv = a_uv;
	v_light = a_light;
	v_dark = a_dark;
	gl_Position = vec4((u_projection * vec3(a_position, 1.0)).xy, 0.0, 1.0);
}
`;

/** Fragment shader: the two-color tint of the premultiplied texel, as `tintTexel` works it on the CPU. */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_light;
in vec3 v_dark;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
	vec4 texel = texture(u_texture, v_uv);
	fragColor = vec4((texel.a * v_dark + (v_light.rgb - v_dark) * texel.rgb) * v_light.a, texel.a * v_light.a);
}
`;

/** The source and destination factors each blend mode draws with, for premultiplied colour. `MATH.md` records where each comes from. */
export const BLEND_FACTORS: Readonly<Record<BlendMode, readonly [BlendFactor, BlendFactor]>> = {
	normal: ["ONE", "ONE_MINUS_SRC_ALPHA"],
	additive: ["ONE", "ONE"],
	multiply: ["DST_COLOR", "ONE_MINUS_SRC_ALPHA"],
	screen: ["ONE", "ONE_MINUS_SRC_COLOR"]
};

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** A WebGL blend factor this renderer uses, named as the context's constant. */
export type BlendFactor = "ONE" | "ONE_MINUS_SRC_ALPHA" | "DST_COLOR" | "ONE_MINUS_SRC_COLOR";

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

/** One draw call: a run of indices that all sample the same texture and blend the same way. */
interface Batch {
	/** The page texture the run samples. */
	texture: WebGLTexture;
	/** How the run blends with what is under it. */
	blendMode: BlendMode;
	/** Index of the run's first entry in the index buffer. */
	start: number;
	/** Number of indices in the run. */
	count: number;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Works out the two-color tint of one premultiplied texel, as the fragment shader does. The dark color maps the texel's black and the light
 * color its white, in straight colour. The result is premultiplied by the output alpha, the texel's alpha times the light alpha. A null dark
 * color is black, which gives the plain tint: the texel times the premultiplied light color.
 *
 * @param light The straight light color: the slot's live color times the attachment's color.
 * @param dark The slot's dark color, or null when the slot has none. Its alpha is unused.
 * @param texel The premultiplied texel as `[r, g, b, a]`, each 0-1.
 * @returns The premultiplied output as `[r, g, b, a]`.
 */
export function tintTexel(light: Color, dark: Color | null, texel: readonly number[]): [number, number, number, number] {
	const d = dark ?? NO_DARK;
	const a = texel[3]!;
	return [(a * d.r + (light.r - d.r) * texel[0]!) * light.a, (a * d.g + (light.g - d.g) * texel[1]!) * light.a, (a * d.b + (light.b - d.b) * texel[2]!) * light.a, a * light.a];
}

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
	gl.bindAttribLocation(program, LIGHT_LOCATION, "a_light");
	gl.bindAttribLocation(program, DARK_LOCATION, "a_dark");
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
 * Writes the column-major 3x3 matrix that maps a view rectangle to clip space, with world y up.
 *
 * @param out The 9-float array to write, ready for `uniformMatrix3fv`.
 * @param view The world rectangle to show.
 */
function writeProjection(out: Float32Array, view: View): void {
	const sx = 2 / (view.maxX - view.minX);
	const sy = 2 / (view.maxY - view.minY);
	out[0] = sx;
	out[4] = sy;
	out[6] = -1 - view.minX * sx;
	out[7] = -1 - view.minY * sy;
	out[8] = 1;
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
	/** Each blend mode's factors, resolved to the context's constants. */
	private readonly blendFactors: Record<BlendMode, [number, number]>;
	/** The projection matrix, rewritten every frame. */
	private readonly projection = new Float32Array(9);
	/** The draw calls, reused across frames. Only the first `batchCount` are this frame's. */
	private readonly batches: Batch[] = [];
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
		const factors = (mode: BlendMode): [number, number] => [gl[BLEND_FACTORS[mode][0]], gl[BLEND_FACTORS[mode][1]]];
		this.blendFactors = { normal: factors("normal"), additive: factors("additive"), multiply: factors("multiply"), screen: factors("screen") };
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
		gl.enableVertexAttribArray(LIGHT_LOCATION);
		gl.vertexAttribPointer(LIGHT_LOCATION, 4, gl.FLOAT, false, stride, 4 * BYTES_PER_FLOAT);
		gl.enableVertexAttribArray(DARK_LOCATION);
		gl.vertexAttribPointer(DARK_LOCATION, 3, gl.FLOAT, false, stride, 8 * BYTES_PER_FLOAT);
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
	 * Clears the viewport and draws the lists in order, back to front, each with its own blend mode and two-color tint. A list whose page has
	 * no texture is skipped. The lists are read once, during the call, so pooled lists are fine. Allocates nothing once the buffers have grown.
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

		// Fill both buffers in one pass, opening a new batch only when the texture or the blend mode changes.
		const vertices = this.vertices;
		const indices = this.indices;
		const batches = this.batches;
		let batchCount = 0;
		let vertex = 0;
		let index = 0;
		for (let l = 0; l < lists.length; l++) {
			const list = lists[l]!;
			const texture = textures[list.page];
			if (!texture) {
				continue;
			}
			const { r, g, b, a } = list.color;
			const dark = list.darkColor ?? NO_DARK;
			const positions = list.positions;
			const uvs = list.uvs;
			const first = vertex;
			for (let i = 0; i < positions.length; i += 2) {
				let o = vertex * FLOATS_PER_VERTEX;
				vertices[o++] = positions[i]!;
				vertices[o++] = positions[i + 1]!;
				vertices[o++] = uvs[i]!;
				vertices[o++] = uvs[i + 1]!;
				vertices[o++] = r;
				vertices[o++] = g;
				vertices[o++] = b;
				vertices[o++] = a;
				vertices[o++] = dark.r;
				vertices[o++] = dark.g;
				vertices[o] = dark.b;
				vertex++;
			}
			const start = index;
			const listIndices = list.indices;
			for (let i = 0; i < listIndices.length; i++) {
				indices[index++] = first + listIndices[i]!;
			}
			const last = batchCount > 0 ? batches[batchCount - 1]! : null;
			if (last && last.texture === texture && last.blendMode === list.blendMode) {
				last.count += index - start;
			} else {
				let batch = batches[batchCount];
				if (!batch) {
					batch = { texture, blendMode: list.blendMode, start, count: 0 };
					batches.push(batch);
				}
				batch.texture = texture;
				batch.blendMode = list.blendMode;
				batch.start = start;
				batch.count = index - start;
				batchCount++;
			}
		}

		gl.useProgram(this.program);
		writeProjection(this.projection, view);
		gl.uniformMatrix3fv(this.projectionLocation, false, this.projection);
		gl.enable(gl.BLEND);
		gl.bindVertexArray(this.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW, 0, vertex * FLOATS_PER_VERTEX);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW, 0, index);
		gl.activeTexture(gl.TEXTURE0);
		for (let i = 0; i < batchCount; i++) {
			const batch = batches[i]!;
			const [source, destination] = this.blendFactors[batch.blendMode];
			gl.blendFunc(source, destination);
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
