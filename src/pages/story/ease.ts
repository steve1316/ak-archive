// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Easing

/** The easing curves as CSS timing functions, in the order the game's tween library numbers them. */
const CURVES: [string, string][] = [
	["unset", "linear"],
	["linear", "linear"],
	["insine", "cubic-bezier(0.12, 0, 0.39, 0)"],
	["outsine", "cubic-bezier(0.61, 1, 0.88, 1)"],
	["inoutsine", "cubic-bezier(0.37, 0, 0.63, 1)"],
	["inquad", "cubic-bezier(0.11, 0, 0.5, 0)"],
	["outquad", "cubic-bezier(0.5, 1, 0.89, 1)"],
	["inoutquad", "cubic-bezier(0.45, 0, 0.55, 1)"],
	["incubic", "cubic-bezier(0.32, 0, 0.67, 0)"],
	["outcubic", "cubic-bezier(0.33, 1, 0.68, 1)"],
	["inoutcubic", "cubic-bezier(0.65, 0, 0.35, 1)"],
	["inquart", "cubic-bezier(0.5, 0, 0.75, 0)"],
	["outquart", "cubic-bezier(0.25, 1, 0.5, 1)"],
	["inoutquart", "cubic-bezier(0.76, 0, 0.24, 1)"],
	["inquint", "cubic-bezier(0.64, 0, 0.78, 0)"],
	["outquint", "cubic-bezier(0.22, 1, 0.36, 1)"],
	["inoutquint", "cubic-bezier(0.83, 0, 0.17, 1)"],
	["inexpo", "cubic-bezier(0.7, 0, 0.84, 0)"],
	["outexpo", "cubic-bezier(0.16, 1, 0.3, 1)"],
	["inoutexpo", "cubic-bezier(0.87, 0, 0.13, 1)"],
	["incirc", "cubic-bezier(0.55, 0, 1, 0.45)"],
	["outcirc", "cubic-bezier(0, 0.55, 0.45, 1)"],
	["inoutcirc", "cubic-bezier(0.85, 0, 0.15, 1)"]
];

/** Curves with a name but no number in the data, drawn as the nearest plain curve. */
const NAMED: Record<string, string> = { outback: "cubic-bezier(0.34, 1.56, 0.64, 1)", outbounce: "ease-out", inoutbounce: "ease-in-out", outflash: "ease-out" };

/**
 * A tween's easing as a CSS timing function.
 *
 * @param value The script's `ease`, a curve name such as `OutQuad` or the curve's number.
 * @returns The timing function, which is `linear` when the script names none or one that is not known.
 */
export function easeOf(value: unknown): string {
	const key = String(value ?? "").toLowerCase();
	const numbered = /^\d+$/.test(key) ? CURVES[Number(key)]?.[1] : undefined;
	return numbered ?? CURVES.find(([name]) => name === key)?.[1] ?? NAMED[key] ?? "linear";
}
