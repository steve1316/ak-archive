// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Atlas reader

/**
 * Reads a Spine texture atlas `.atlas` file: a line-based text format listing one or more pages, each with the regions packed into it.
 *
 * Implements the "Atlas export format" section of Esoteric Software's public atlas format page, adjusted where the staged corpus disagrees
 * with it. See `SOURCES.md` for the page and `FORMAT-3.8.md` for the differences found in the staged corpus.
 */

import type { Atlas, AtlasFilter, AtlasFormat, AtlasPage, AtlasRegion, AtlasRepeat } from "./types.js";

/** Page property keys this reader handles. Any other key on a page header line throws. */
const PAGE_KEYS = new Set(["size", "format", "filter", "repeat", "pma"]);

/** Region property keys this reader handles. Any other key on a region property line throws. */
const REGION_KEYS = new Set(["rotate", "xy", "size", "orig", "offset", "index"]);

/** Valid `format` values. `RGBA8888` is used when the field is omitted. */
const FORMATS = new Set<string>(["Alpha", "Intensity", "LuminanceAlpha", "RGB565", "RGBA4444", "RGB888", "RGBA8888"]);

/** Valid `filter` values. `Nearest` is used when the field is omitted. */
const FILTERS = new Set<string>(["Nearest", "Linear", "MipMap", "MipMapNearestNearest", "MipMapLinearNearest", "MipMapNearestLinear", "MipMapLinearLinear"]);

/** Valid `repeat` values. `none` is used when the field is omitted. */
const REPEATS = new Set<string>(["none", "x", "y", "xy"]);

/** The only `rotate` degree values the corpus uses, once `true`/`false` are resolved to 90/0. A rotated region is packed axis-aligned. */
const ROTATE_DEGREES = new Set([0, 90, 180, 270]);

/** Thrown when an atlas file's text does not match the format. Carries the 1-based line number the failing read started at. */
export class AtlasFormatError extends Error {
	/** 1-based line number in the atlas text where the problem was found. */
	readonly line: number;

	/**
	 * @param message What went wrong.
	 * @param line 1-based line number in the atlas text where the problem was found.
	 */
	constructor(message: string, line: number) {
		super(`line ${line}: ${message}`);
		this.name = "AtlasFormatError";
		this.line = line;
	}
}

/**
 * Reads a whole `.atlas` file's text.
 *
 * @param text The atlas file's text.
 * @returns The parsed pages and their regions.
 */
export function readAtlas(text: string): Atlas {
	const lines = text.split(/\r\n|\r|\n/);
	// A trailing newline produces one trailing empty line: drop it so it is not mistaken for the doc's page-separator blank line.
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	const pages: AtlasPage[] = [];
	let i = 0;
	while (i < lines.length) {
		if (lines[i]!.trim() === "") {
			i++;
			continue;
		}
		const { page, next } = readPage(lines, i);
		pages.push(page);
		i = next;
	}

	if (pages.length === 0) {
		throw new AtlasFormatError("no pages found", 1);
	}
	return { pages };
}

/**
 * Reads one page section: the page name line, its header properties, and every region until a blank line or the end of the file.
 *
 * Page header lines and region name lines are both unindented. A region name is always followed by an indented property line, and a page
 * header line never is. So the header ends at the first line whose next line is indented, and every header line before it must be a known
 * page property or it throws. See `FORMAT-3.8.md`.
 *
 * @param lines The atlas file split into lines.
 * @param start Index of the page name line.
 * @returns The parsed page and the index of the line after it.
 */
function readPage(lines: string[], start: number): { page: AtlasPage; next: number } {
	const name = lines[start]!.trim();
	let i = start + 1;

	let width = 0;
	let height = 0;
	let format: AtlasFormat = "RGBA8888";
	let filter: [AtlasFilter, AtlasFilter] = ["Nearest", "Nearest"];
	let repeat: AtlasRepeat = "none";
	let pma = false;

	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim() === "") {
			break;
		}
		if (isIndented(lines[i + 1])) {
			// The next line is indented, so this line is a region's own name, not a page header key: the header ends here.
			break;
		}
		const field = parseField(line);
		if (field === null || !PAGE_KEYS.has(field.key)) {
			throw new AtlasFormatError(`unknown page property "${field ? field.key : line.trim()}"`, i + 1);
		}
		switch (field.key) {
			case "size": {
				const [w, h] = parseInts(field.value, 2, i + 1);
				width = w!;
				height = h!;
				break;
			}
			case "format":
				format = parseEnum(FORMATS, field.value, "format", i + 1) as AtlasFormat;
				break;
			case "filter": {
				const parts = field.value.split(",").map((part) => part.trim());
				if (parts.length !== 2) {
					throw new AtlasFormatError(`filter needs 2 comma-separated values, got "${field.value}"`, i + 1);
				}
				filter = [parseEnum(FILTERS, parts[0]!, "filter", i + 1) as AtlasFilter, parseEnum(FILTERS, parts[1]!, "filter", i + 1) as AtlasFilter];
				break;
			}
			case "repeat":
				repeat = parseEnum(REPEATS, field.value, "repeat", i + 1) as AtlasRepeat;
				break;
			case "pma":
				pma = parseBoolean(field.value, i + 1);
				break;
		}
		i++;
	}

	// A blank line, per the doc, ends this page's regions. The doc also ends them at a new page's header, but the staged corpus never
	// separates pages without a blank line, so a page's regions here just run to the next blank line or the end of the file.
	const regions: AtlasRegion[] = [];
	while (i < lines.length && lines[i]!.trim() !== "") {
		const { region, next } = readRegion(lines, i);
		regions.push(region);
		i = next;
	}

	return { page: { name, width, height, format, filter, repeat, pma, regions }, next: i };
}

/**
 * Reads one region: its name line and the following indented property lines, stopping at the next line with no leading whitespace.
 *
 * @param lines The atlas file split into lines.
 * @param start Index of the region name line.
 * @returns The parsed region and the index of the line after it.
 */
function readRegion(lines: string[], start: number): { region: AtlasRegion; next: number } {
	// Not trimmed: a region name is a lookup key a skeleton attachment must match exactly, and at least one staged region is genuinely
	// named with a trailing space (see FORMAT-3.8.md). A region name line never has leading whitespace, so there is nothing to strip there.
	const name = lines[start]!;
	let i = start + 1;

	let x = 0;
	let y = 0;
	let width = 0;
	let height = 0;
	let offsetX = 0;
	let offsetY = 0;
	let originalWidth = 0;
	let originalHeight = 0;
	let rotate = 0;
	let index = -1;
	let sawOrig = false;

	while (i < lines.length && isIndented(lines[i])) {
		const field = parseField(lines[i]!);
		if (field === null) {
			throw new AtlasFormatError(`expected a "key: value" region property, got "${lines[i]}"`, i + 1);
		}
		if (!REGION_KEYS.has(field.key)) {
			throw new AtlasFormatError(`unknown region property "${field.key}"`, i + 1);
		}
		switch (field.key) {
			case "rotate":
				rotate = parseRotate(field.value, i + 1);
				break;
			case "xy": {
				const [px, py] = parseInts(field.value, 2, i + 1);
				x = px!;
				y = py!;
				break;
			}
			case "size": {
				const [w, h] = parseInts(field.value, 2, i + 1);
				width = w!;
				height = h!;
				break;
			}
			case "orig": {
				const [ow, oh] = parseInts(field.value, 2, i + 1);
				originalWidth = ow!;
				originalHeight = oh!;
				sawOrig = true;
				break;
			}
			case "offset": {
				const [ox, oy] = parseInts(field.value, 2, i + 1);
				offsetX = ox!;
				offsetY = oy!;
				break;
			}
			case "index":
				index = parseNumber(field.value, i + 1);
				break;
		}
		i++;
	}

	if (!sawOrig) {
		originalWidth = width;
		originalHeight = height;
	}

	return { region: { name, x, y, width, height, offsetX, offsetY, originalWidth, originalHeight, rotate, index }, next: i };
}

/**
 * Checks whether a line starts with a space or a tab. Region property lines are indented, and page header and region name lines are not.
 *
 * @param line The line to check, or undefined when there is no next line.
 * @returns True when the line exists and starts with leading whitespace.
 */
function isIndented(line: string | undefined): boolean {
	return line !== undefined && /^[ \t]/.test(line);
}

/**
 * Parses a `key: value` line, ignoring leading indentation.
 *
 * @param line The raw line.
 * @returns The key and value, or null when the line has no colon.
 */
function parseField(line: string): { key: string; value: string } | null {
	const trimmed = line.trim();
	const colon = trimmed.indexOf(":");
	if (colon === -1) {
		return null;
	}
	return { key: trimmed.slice(0, colon).trim(), value: trimmed.slice(colon + 1).trim() };
}

/**
 * Parses a single number. Rejects an empty value: `Number("")` is 0 in JavaScript, which would otherwise silently turn a missing value
 * (e.g. `xy: ,`) into a real coordinate instead of a parse error.
 *
 * @param value The raw field value.
 * @param lineNumber 1-based line number, used in the error message.
 * @returns The parsed number.
 */
function parseNumber(value: string, lineNumber: number): number {
	if (value.trim() === "") {
		throw new AtlasFormatError("expected a number, got an empty value", lineNumber);
	}
	const n = Number(value);
	if (!Number.isFinite(n)) {
		throw new AtlasFormatError(`bad number "${value}"`, lineNumber);
	}
	return n;
}

/**
 * Parses a `true`/`false` field value strictly, throwing on anything else rather than treating an unrecognized value as `false`.
 *
 * @param value The raw field value.
 * @param lineNumber 1-based line number, used in the error message.
 * @returns The parsed boolean.
 */
function parseBoolean(value: string, lineNumber: number): boolean {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	throw new AtlasFormatError(`expected true or false, got "${value}"`, lineNumber);
}

/**
 * Parses a comma-separated list of numbers.
 *
 * @param value The raw field value, e.g. "403, 468".
 * @param count How many numbers are expected.
 * @param lineNumber 1-based line number, used in the error message.
 * @returns The parsed numbers.
 */
function parseInts(value: string, count: number, lineNumber: number): number[] {
	const parts = value.split(",").map((part) => part.trim());
	if (parts.length !== count) {
		throw new AtlasFormatError(`expected ${count} comma-separated numbers, got "${value}"`, lineNumber);
	}
	return parts.map((part) => parseNumber(part, lineNumber));
}

/**
 * Parses a region's `rotate` value: `true` is 90 degrees, `false` is 0, or the value is itself a degree number. Only 0, 90, 180 and 270
 * are accepted, since a region can only be packed axis-aligned. Any other degree value throws.
 *
 * @param value The raw field value.
 * @param lineNumber 1-based line number, used in the error message.
 * @returns The rotation in degrees.
 */
function parseRotate(value: string, lineNumber: number): number {
	if (value === "true") {
		return 90;
	}
	if (value === "false") {
		return 0;
	}
	const degrees = parseNumber(value, lineNumber);
	if (!ROTATE_DEGREES.has(degrees)) {
		throw new AtlasFormatError(`rotate must be true, false, 0, 90, 180 or 270, got "${value}"`, lineNumber);
	}
	return degrees;
}

/**
 * Looks up a field value in a set of valid values.
 *
 * @param values The valid values for this field.
 * @param value The raw field value.
 * @param label What this field is, used in the error message.
 * @param lineNumber 1-based line number, used in the error message.
 * @returns The matching value.
 */
function parseEnum(values: ReadonlySet<string>, value: string, label: string, lineNumber: number): string {
	if (!values.has(value)) {
		throw new AtlasFormatError(`unknown ${label} value "${value}"`, lineNumber);
	}
	return value;
}
