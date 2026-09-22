import { assets } from "./assets.js";

/**
 * A skill's icon.
 *
 * @param key The skill's published icon key, `OperatorSkill.icon`.
 * @returns The icon's URL on the asset host.
 */
export function skillIconUrl(key: string): string {
	return assets.url(`skills/${key}.webp`);
}

/**
 * The game's icon for a potential rank: the star filling up from P1 to P6.
 *
 * @param rank The 1-based rank, 1 to 6.
 * @returns The icon's URL on the asset host.
 */
export function potentialIconUrl(rank: number): string {
	return assets.url(`potentials/${rank - 1}.webp`);
}

/**
 * The game's badge for an elite phase.
 *
 * @param phase The 0-based phase, 0 to 2.
 * @returns The badge's URL on the asset host.
 */
export function eliteIconUrl(phase: number): string {
	return assets.url(`elites/${phase}.webp`);
}

/**
 * A single-colour 24x24 SVG path as an image URL, for the navbar drawer, whose items take an image URL rather than a React icon. Inline, so
 * it needs nothing from the asset host.
 *
 * @param path The SVG path data, drawn in a 24x24 view box.
 * @param fill The fill colour.
 * @returns A `data:` URL of the SVG.
 */
export function glyphIconUrl(path: string, fill: string): string {
	return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${path}"/></svg>`)}`;
}
