// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Forms

/**
 * The costumes each operator can be shown in, from `skin_table`.
 *
 * Each outfit carries the portrait id the art pipeline files it under, so a form's key is derived the way the published file names are: strip
 * the operator id, turn `#` into `_` and `+` into `plus`. That keeps the key equal to what `tools/assets/build_manifest.py` records, apart from
 * letter case, which the site matches loosely because upstream is not consistent about it.
 *
 * Outfits are grouped by `tmplId` when it is set. Amiya's Guard and Medic forms are templates of base Amiya, so their outfits sit under
 * `char_002_amiya` in `charId`, and only `tmplId` says they belong to `char_1001_amiya2` and `char_1037_amiya3`.
 */

import { dayOfUnix } from "./dates.mjs";

/**
 * Chip labels for default outfits, which carry no skin name upstream. Keyed by normalised variant key. `1plus` is Amiya's Elite 1 art - she is
 * the only operator whose art changes at Elite 1 - and upstream's `sortId` puts it between Base and Elite 2.
 */
const DEFAULT_LABELS = new Map([
	["1", "Base"],
	["1plus", "Elite 1"],
	["2", "Elite 2"]
]);

/**
 * Turn a skin table variant into the spelling the art pipeline publishes under.
 *
 * @param {string} key The variant as `skin_table` writes it, such as `summer#4` or `1+`.
 * @returns {string} The published spelling, such as `summer_4` or `1plus`.
 */
export function normaliseFormKey(key) {
	return key.replaceAll("#", "_").replaceAll("+", "plus");
}

/**
 * Order two forms: default art first, then outfits by release day, with `sortId` breaking every tie.
 *
 * @param {{releaseDate: string | null, sortId: number}} a One form.
 * @param {{releaseDate: string | null, sortId: number}} b The other form.
 * @returns {number} Negative, zero or positive, as `Array.prototype.sort` expects.
 */
function compareForms(a, b) {
	if (a.releaseDate !== b.releaseDate) {
		if (a.releaseDate === null) {
			return -1;
		}
		if (b.releaseDate === null) {
			return 1;
		}
		return a.releaseDate < b.releaseDate ? -1 : 1;
	}
	return a.sortId - b.sortId;
}

/**
 * Group the skin table's outfits into each operator's forms.
 *
 * An outfit with no name is kept only when it is a known default outfit, since anything else would need a label invented for it. Default art
 * comes first in upstream's `sortId` order, then outfits oldest to newest by Global release, with outfits released the same day kept in `sortId`
 * order.
 *
 * @param {Record<string, any>} charSkins The skin table's `charSkins` map.
 * @returns {Map<string, {key: string, name: string, releaseDate: string | null}[]>} Forms keyed by operator id, each list in display order. An
 * outfit's `releaseDate` is its Global day from `displaySkin.getTime`. Default art has none, since it arrives with the operator.
 */
export function buildForms(charSkins) {
	const grouped = new Map();
	for (const skin of Object.values(charSkins)) {
		// The portrait id is namespaced by the owner, which is the tmplId for a templated form and the charId otherwise - never the raw charId
		// on its own, so a templated form's own outfits would be dropped if the prefix check used charId unconditionally.
		const owner = skin.tmplId ?? skin.charId;
		const prefix = `${owner}_`;
		if (typeof skin.portraitId !== "string" || !skin.portraitId.startsWith(prefix)) {
			continue;
		}
		const key = normaliseFormKey(skin.portraitId.slice(prefix.length));
		const name = skin.displaySkin?.skinName || DEFAULT_LABELS.get(key) || null;
		if (name === null) {
			continue;
		}
		const list = grouped.get(owner) ?? [];
		const releaseDate = skin.displaySkin?.skinName && skin.displaySkin.getTime > 0 ? dayOfUnix(skin.displaySkin.getTime) : null;
		list.push({ key, name, releaseDate, sortId: skin.displaySkin?.sortId ?? 0 });
		grouped.set(owner, list);
	}

	const forms = new Map();
	for (const [owner, list] of grouped) {
		list.sort(compareForms);
		forms.set(
			owner,
			list.map(({ key, name, releaseDate }) => ({ key, name, releaseDate }))
		);
	}
	return forms;
}
