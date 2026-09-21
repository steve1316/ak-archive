// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Forms

/**
 * The costumes an operator page can switch between, and the exact file each art kind publishes a costume under.
 *
 * A form is the base art, a promotion's art, or a skin. The importer lists them from `skin_table`, and this module keeps only those with a
 * published illustration, since the backdrop and the art viewer both need one.
 *
 * File keys are matched case-insensitively. Upstream spells some keys differently per directory - SilverAsh's skin is `ambiencesynesthesia_4`
 * under `charpor/` but `ambienceSynesthesia_4` under `charpack/` - and the asset host is case-sensitive, so each file name comes from the
 * manifest's record of that kind rather than from the form's own key.
 */

import { assets, hasIllustration, hasPortrait, illustrationUrl, portraitUrl } from "./assets.js";
import type { Operator, OperatorFormEntry } from "../types/operator.js";

/** The slice of `assets-manifest.json` this module reads. */
type VariantManifest = {
	/** Variant keys per art kind, written by `tools/assets/build_manifest.py`, each list in that kind's own upstream spelling. */
	variants?: {
		/** Portrait variant keys, keyed by operator id. */
		portraits?: Record<string, string[]>;
		/** Illustration variant keys, keyed by operator id. */
		illustrations?: Record<string, string[]>;
	};
};

/**
 * Variant keys per kind. Read here rather than exported from `assets.ts`, which the Spine pipeline is extending in parallel - A6b's last task
 * folds this back in. Both globs resolve to the same module, so the manifest is still bundled once.
 */
const VARIANTS = (Object.values(import.meta.glob<VariantManifest>("../data/assets-manifest.json", { import: "default", eager: true }))[0] ?? {}).variants ?? {};

/** The key a synthesised base form falls back to when an operator has no plain numeric form at all. Matches the pipeline's own default. */
const FALLBACK_BASE_KEY = "1";

/** The chip label a synthesised base form gets, when no importer form resolved to the operator's bare-published art. */
const BASE_LABEL = "Base";

/** The query parameter that carries the selected form, matching gfl's. */
const FORM_PARAM = "skin";

/** A form the page can show, resolved to the file each art kind publishes it under. */
export interface OperatorForm {
	/** The form's key, which is what `?skin=` carries. */
	key: string;
	/** The chip label. */
	name: string;
	/** The form's portrait, or null when this form has none published - 100 skins have an illustration only. */
	portrait: string | null;
	/** The form's illustration. Every listed form has one. */
	illustration: string;
}

/**
 * The importer form whose art publishes without a suffix, mirroring `canonical_key` in `tools/assets/names.py` exactly: `1` wins when a form
 * has that key, otherwise the lowest plain-numeric key wins, and `+` variants never count. Our keys spell `+` as `plus` (`1plus`), which the
 * plain-numeric test already excludes, so no separate exclusion is needed here. If that rule ever changes, this one must change with it.
 *
 * @param forms The operator's importer forms.
 * @returns The canonical key, or null when no form has a plain numeric key.
 */
function canonicalFormKey(forms: readonly OperatorFormEntry[]): string | null {
	if (forms.some((form) => form.key === "1")) {
		return "1";
	}
	const numbers = forms.map((form) => form.key).filter((key) => /^\d+$/.test(key));
	return numbers.length === 0 ? null : numbers.reduce((lowest, key) => (Number(key) < Number(lowest) ? key : lowest));
}

/**
 * Find a key in one kind's variant list, ignoring case.
 *
 * @param keys That kind's variant keys for the operator, or undefined when it has none.
 * @param key The form key to look for.
 * @returns The key as that kind spells it, or null when the kind has no such file.
 */
function matchKey(keys: string[] | undefined, key: string): string | null {
	const wanted = key.toLowerCase();
	return keys?.find((candidate) => candidate.toLowerCase() === wanted) ?? null;
}

/**
 * URL of a portrait variant. `portraitUrl` takes no variant yet, and `assets.ts` is off-limits while the Spine pipeline edits it, so the one
 * builder lives here until A6b's last task gives `portraitUrl` a variant parameter.
 *
 * @param id The operator id.
 * @param key The variant key in the portrait directory's own spelling.
 * @returns The absolute URL.
 */
function variantPortraitUrl(id: string, key: string): string {
	return assets.url(`portraits/${id}_${key}.webp`);
}

/**
 * Every form an operator page can switch to, in upstream's display order.
 *
 * @param operator The loaded operator.
 * @returns The forms with a published illustration. Empty only when the operator has no art at all.
 */
export function formsOf(operator: Operator): OperatorForm[] {
	const { id } = operator;
	const portraitKeys = VARIANTS.portraits?.[id];
	const illustrationKeys = VARIANTS.illustrations?.[id];
	const canonical = canonicalFormKey(operator.forms);
	const bareForm = (key: string, name: string): OperatorForm | null =>
		hasIllustration(id) ? { key, name, portrait: hasPortrait(id) ? portraitUrl(id) : null, illustration: illustrationUrl(id) } : null;

	const forms: OperatorForm[] = [];
	for (const entry of operator.forms) {
		if (canonical !== null && entry.key === canonical) {
			const form = bareForm(canonical, entry.name);
			if (form) {
				forms.push(form);
			}
			continue;
		}
		const illustrationKey = matchKey(illustrationKeys, entry.key);
		if (illustrationKey === null) {
			continue;
		}
		const portraitKey = matchKey(portraitKeys, entry.key);
		forms.push({ key: entry.key, name: entry.name, portrait: portraitKey === null ? null : variantPortraitUrl(id, portraitKey), illustration: illustrationUrl(id, illustrationKey) });
	}

	// A form at the canonical key can be missing above - some operators (Amiya's Guard and Medic forms) have no base outfit in skin_table at
	// all, yet their canonical art still publishes bare. Synthesise it so the page always has something to open on.
	const bareKey = canonical ?? FALLBACK_BASE_KEY;
	if (!forms.some((form) => form.key === bareKey)) {
		const form = bareForm(bareKey, BASE_LABEL);
		if (form) {
			forms.unshift(form);
		}
	}
	return forms;
}

/**
 * Read the selected form from the query string, falling back to the first form for anything the operator does not have.
 *
 * @param params The page's query string.
 * @param forms The operator's forms.
 * @returns The selected form's key, or null when the operator has no forms.
 */
export function readFormKey(params: URLSearchParams, forms: OperatorForm[]): string | null {
	const wanted = params.get(FORM_PARAM);
	return forms.find((form) => form.key === wanted)?.key ?? forms[0]?.key ?? null;
}

/**
 * Write the selected form into a query string, leaving other parameters alone. The default form is removed rather than written, so the plain
 * operator URL stays the canonical link.
 *
 * @param params The query string to update in place.
 * @param key The form to select.
 * @param forms The operator's forms.
 */
export function writeFormKey(params: URLSearchParams, key: string, forms: OperatorForm[]): void {
	if (key === forms[0]?.key) {
		params.delete(FORM_PARAM);
	} else {
		params.set(FORM_PARAM, key);
	}
}
