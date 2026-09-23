/**
 * The asset gap ledger: which core assets the data points at but no mirror has published yet.
 *
 * A scheduled refresh ships new data before a slow mirror catches up, so a missing portrait or icon is expected for a while. The ledger records
 * when each gap was first seen, and `check.mjs` fails once one has stayed open past `GRACE_DAYS`, so a gap that never fills still gets noticed.
 * Gaps known to be permanent sit in `accepted` with a reason. The refresh prunes both lists on its own, so a stale entry only comes from a hand edit.
 */

/** How long a gap may stay pending before the check fails. */
export const GRACE_DAYS = 7;

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * Every core asset the data references, as `<kind>:<key>`.
 *
 * @param {{operators: Array<{id: string}>, details: Map<string, {skills?: Array<{icon: string}>, modules?: Array<{art: string, typeIcon: string}>}>, enemies: Array<{variants: Array<{id: string}>}>}} data
 *   The imported operators, their details by id, and the enemy groups.
 * @returns {Set<string>} The referenced keys.
 */
export function referencedAssets({ operators, details, enemies }) {
	const keys = new Set();
	for (const { id } of operators) {
		keys.add(`portrait:${id}`).add(`illustration:${id}`).add(`rig:${id}`);
		for (const skill of details.get(id)?.skills ?? []) {
			keys.add(`skill:${skill.icon}`);
		}
		for (const module of details.get(id)?.modules ?? []) {
			keys.add(`module:${module.art}`).add(`badge:${module.typeIcon}`);
		}
	}
	for (const group of enemies) {
		for (const variant of group.variants) {
			keys.add(`enemy:${variant.id}`).add(`enemy-rig:${variant.id}`);
		}
	}
	return keys;
}

/**
 * Every core asset the committed manifest and rig indexes say is published, as `<kind>:<key>`.
 *
 * @param {{manifest: object, spineIndex: object, enemySpineIndex: object}} state The committed files.
 * @returns {Set<string>} The published keys.
 */
export function publishedAssets({ manifest, spineIndex, enemySpineIndex }) {
	const keys = new Set();
	for (const [kind, section] of [
		["portrait", "portraits"],
		["illustration", "illustrations"],
		["enemy", "enemies"]
	]) {
		for (const [id, present] of Object.entries(manifest[section] ?? {})) {
			if (present === true) {
				keys.add(`${kind}:${id}`);
			}
		}
	}
	for (const [kind, section] of [
		["skill", "skillIcons"],
		["module", "moduleArt"],
		["badge", "moduleTypes"]
	]) {
		for (const key of manifest[section] ?? []) {
			keys.add(`${kind}:${key}`);
		}
	}
	for (const [id, forms] of Object.entries(spineIndex)) {
		if (forms.base?.battle) {
			keys.add(`rig:${id}`);
		}
	}
	for (const id of Object.keys(enemySpineIndex)) {
		keys.add(`enemy-rig:${id}`);
	}
	return keys;
}

/**
 * The referenced assets that are not published, sorted.
 *
 * @param {Set<string>} referenced From `referencedAssets`.
 * @param {Set<string>} published From `publishedAssets`.
 * @returns {string[]} The missing keys.
 */
export function missingAssets(referenced, published) {
	return [...referenced].filter((key) => !published.has(key)).sort();
}

/**
 * Copy a map with its keys sorted.
 *
 * @param {Record<string, string>} record The map.
 * @returns {Record<string, string>} The sorted copy.
 */
function sorted(record) {
	return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The ledger after one refresh: every missing key that is not accepted is pending, keeping the date it was first seen, and every entry that is no
 * longer missing is dropped from both lists.
 *
 * The `skip` list is kept as it is: it names rig folders a person has told the refresh never to fetch, such as a rig the Spine tools cannot
 * read yet, and only a person changes it.
 *
 * @param {{pending: Record<string, string>, accepted: Record<string, string>, skip?: Record<string, string>}} ledger The committed ledger.
 * @param {string[]} missing From `missingAssets`.
 * @param {string} today The UTC date, `YYYY-MM-DD`.
 * @returns {{pending: Record<string, string>, accepted: Record<string, string>, skip: Record<string, string>}} The new ledger, keys sorted.
 */
export function updateLedger(ledger, missing, today) {
	const open = new Set(missing);
	const accepted = Object.fromEntries(Object.entries(ledger.accepted ?? {}).filter(([key]) => open.has(key)));
	const pending = Object.fromEntries(missing.filter((key) => !(key in accepted)).map((key) => [key, ledger.pending?.[key] ?? today]));
	return { pending: sorted(pending), accepted: sorted(accepted), skip: sorted(ledger.skip ?? {}) };
}

/**
 * Everything wrong with the ledger against the data: an unlisted gap, a pending gap past the grace period, or an entry that is not missing.
 *
 * @param {{pending: Record<string, string>, accepted: Record<string, string>}} ledger The committed ledger.
 * @param {string[]} missing From `missingAssets`.
 * @param {string} today The UTC date, `YYYY-MM-DD`.
 * @param {{grace?: boolean}} [options] `grace: false` skips the age rule. The scheduled refresh checks that way before it commits, so an expired
 *   gap cannot hold back the rest of the data, and checks the age rule on its own after the deploy.
 * @returns {string[]} One message per problem.
 */
export function ledgerProblems(ledger, missing, today, { grace = true } = {}) {
	const problems = [];
	const open = new Set(missing);
	for (const key of missing) {
		if (!(key in (ledger.pending ?? {})) && !(key in (ledger.accepted ?? {}))) {
			problems.push(`${key} is missing and not in tools/data/asset-gaps.json - run node tools/data/gaps.mjs`);
		}
	}
	for (const [list, entries] of [
		["pending", ledger.pending ?? {}],
		["accepted", ledger.accepted ?? {}]
	]) {
		for (const key of Object.keys(entries)) {
			if (!open.has(key)) {
				problems.push(`${key} is listed in ${list} but is not missing - run node tools/data/gaps.mjs to prune it`);
			}
		}
	}
	for (const [key, since] of Object.entries(ledger.pending ?? {})) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
			problems.push(`${key} has a malformed first-seen date ${JSON.stringify(since)}`);
			continue;
		}
		const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / DAY_MS);
		if (grace && open.has(key) && age > GRACE_DAYS) {
			problems.push(`${key} has been pending since ${since}, ${age} days, past the ${GRACE_DAYS}-day grace - wait for the mirror or move it to accepted`);
		}
	}
	return problems;
}
