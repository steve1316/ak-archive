// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Byte reader

/**
 * Reads Spine's binary `.skel` format one field at a time.
 *
 * Implements the data types from Esoteric Software's public binary format page: boolean, short, int, the two varint encodings, float, string
 * and color. See `SOURCES.md` for exactly what was read and `FORMAT-3.8.md` for where the staged 3.8 files disagree with that page.
 */

import type { Color } from "./types.js";

/** Decodes the UTF-8 bytes a Spine string carries. Shared across every `string()` call so it is only created once. */
const textDecoder = new TextDecoder("utf-8");

/** Thrown for any format error in a `.skel` file, such as a read past the end or a value out of range. Carries the offset of the bad value. */
export class SpineFormatError extends Error {
	/** Byte offset into the buffer where the failing read began. */
	readonly offset: number;

	/**
	 * @param message What went wrong.
	 * @param offset Byte offset into the buffer where the failing read began.
	 */
	constructor(message: string, offset: number) {
		super(message);
		this.name = "SpineFormatError";
		this.offset = offset;
	}
}

/**
 * A forward-only cursor over a `.skel` file's bytes.
 *
 * Every method reads one field and advances past it. A read that would run past the end of the buffer throws `SpineFormatError` instead of
 * returning a wrong value.
 */
export class ByteReader {
	private readonly bytes: Uint8Array;
	private readonly view: DataView;
	private pos: number;
	private strings: string[];

	/** @param bytes The whole `.skel` file. */
	constructor(bytes: Uint8Array) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.pos = 0;
		this.strings = [];
	}

	/** How many bytes have been read so far. */
	get offset(): number {
		return this.pos;
	}

	/** The total size of the buffer in bytes. */
	get length(): number {
		return this.bytes.length;
	}

	/**
	 * Checks that `count` more bytes remain, and throws `SpineFormatError` if not.
	 *
	 * @param count How many bytes the next read needs.
	 */
	private ensure(count: number): void {
		if (this.pos + count > this.bytes.length) {
			throw new SpineFormatError(`Read past end of buffer at offset ${this.pos}: need ${count} byte(s), ${this.bytes.length - this.pos} remaining`, this.pos);
		}
	}

	/** @returns The next byte, unsigned, 0 to 255. */
	byte(): number {
		this.ensure(1);
		const value = this.view.getUint8(this.pos);
		this.pos += 1;
		return value;
	}

	/** @returns The next byte, signed, -128 to 127. */
	signedByte(): number {
		this.ensure(1);
		const value = this.view.getInt8(this.pos);
		this.pos += 1;
		return value;
	}

	/** @returns The next byte as a boolean: 1 for true, 0 for false. */
	boolean(): boolean {
		return this.byte() !== 0;
	}

	/** @returns The next 2 bytes, big-endian, unsigned. */
	short(): number {
		this.ensure(2);
		const value = this.view.getUint16(this.pos, false);
		this.pos += 2;
		return value;
	}

	/** @returns The next 4 bytes, big-endian, signed 32-bit. */
	int(): number {
		this.ensure(4);
		const value = this.view.getInt32(this.pos, false);
		this.pos += 4;
		return value;
	}

	/**
	 * Reads a variable-length integer of 1 to 5 bytes. Each byte's high bit marks whether another byte follows.
	 *
	 * @param optimizePositive When true, the bits are read as-is (varint+), which favors small positive values. When false, the result is
	 *   zig-zag decoded (varint-), which favors small positive and negative values equally.
	 * @returns The decoded integer.
	 */
	varint(optimizePositive: boolean): number {
		let b = this.byte();
		let value = b & 0x7f;
		if (b & 0x80) {
			b = this.byte();
			value |= (b & 0x7f) << 7;
			if (b & 0x80) {
				b = this.byte();
				value |= (b & 0x7f) << 14;
				if (b & 0x80) {
					b = this.byte();
					value |= (b & 0x7f) << 21;
					if (b & 0x80) {
						b = this.byte();
						value |= (b & 0x7f) << 28;
					}
				}
			}
		}
		if (!optimizePositive) {
			value = (value >>> 1) ^ -(value & 1);
		}
		return value;
	}

	/** @returns The next 4 bytes, big-endian, as a 32-bit IEEE float. */
	float(): number {
		this.ensure(4);
		const value = this.view.getFloat32(this.pos, false);
		this.pos += 4;
		return value;
	}

	/**
	 * Reads `count` raw bytes and advances past them.
	 *
	 * @param count How many bytes to read.
	 * @returns A view over those bytes, backed by the same buffer rather than a copy.
	 */
	private raw(count: number): Uint8Array {
		this.ensure(count);
		const value = this.bytes.subarray(this.pos, this.pos + count);
		this.pos += count;
		return value;
	}

	/**
	 * Reads a string: a varint+ byte count, then that many UTF-8 bytes. A count of 0 means the string is null, 1 means it is empty, and any
	 * higher count is followed by `count - 1` bytes.
	 *
	 * @returns The decoded string, or null.
	 */
	string(): string | null {
		let count = this.varint(true);
		if (count === 0) {
			return null;
		}
		count -= 1;
		if (count === 0) {
			return "";
		}
		return textDecoder.decode(this.raw(count));
	}

	/**
	 * Reads a shared-string reference: a varint+ index into the table `setStrings` loaded. An index of 0 means null, and `n` means the string
	 * at position `n - 1` in that table.
	 *
	 * @returns The referenced string, or null.
	 */
	stringRef(): string | null {
		const start = this.pos;
		const index = this.varint(true);
		if (index === 0) {
			return null;
		}
		const value = this.strings[index - 1];
		if (value === undefined) {
			throw new SpineFormatError(`String ref index ${index} is out of range: ${this.strings.length} shared string(s) loaded`, start);
		}
		return value;
	}

	/** @returns The next 4 bytes as an RGBA color, each channel normalized from a byte to 0-1. */
	color(): Color {
		const rgba = this.int();
		return {
			r: ((rgba >>> 24) & 0xff) / 255,
			g: ((rgba >>> 16) & 0xff) / 255,
			b: ((rgba >>> 8) & 0xff) / 255,
			a: (rgba & 0xff) / 255
		};
	}

	/**
	 * Sets the shared-string table that `stringRef()` reads from.
	 *
	 * @param strings The shared strings, in file order.
	 */
	setStrings(strings: string[]): void {
		this.strings = strings;
	}
}
