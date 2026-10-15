// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Sprite layout

/**
 * Where story sprites stand and how big they are drawn. The game sizes each character on its own, so a teenager stands shorter than a grown
 * man, and the image files do not record it. The sizes here were measured by matching each sprite's head against in-game captures. Every
 * other sprite takes the default, the middle of the measured sizes.
 */

import type { Slot } from "./engine.js";

/** How a sprite's square image is drawn, as % of the stage height: its height, and where its top edge sits. */
export interface SpriteSize {
	/** The image's drawn height, as % of the stage height. */
	height: number;
	/** The image's top edge, as % of the stage height from the top. Negative is above the stage. */
	top: number;
}

/** Each slot's horizontal centre, as % of the stage width. The same for every character measured. */
export const SLOT_CENTRES: Record<Slot, number> = { l: 33.5, m: 50, r: 65.6 };

/** The size of a sprite with no measurement: the middle of the measured sizes. */
const DEFAULT_SIZE: SpriteSize = { height: 140, top: 4 };

/**
 * Measured sizes by character: the sprite name without its expression or variant, lowercased. Each was fitted against an in-game capture:
 * Amiya, Dobermann and Riop from the chapter 0 captures, and the Tired Wounded and Tough Infected from a capture of 15-1.
 */
const MEASURED: Record<string, SpriteSize> = {
	char_002_amiya_1: { height: 152, top: -4.1 },
	char_130_doberm_ex: { height: 139, top: 5 },
	char_013_riop: { height: 134, top: 0.7 },
	avg_npc_423_1: { height: 140, top: 8.9 },
	avg_npc_1729_1: { height: 118, top: 24.1 }
};

/**
 * How big a sprite is drawn and where its top sits.
 *
 * @param name The upstream sprite name, such as `avg_npc_1729_1#2$1`.
 * @returns The size.
 */
export function spriteSize(name: string): SpriteSize {
	return MEASURED[(name.split(/[#$]/)[0] ?? name).toLowerCase()] ?? DEFAULT_SIZE;
}
