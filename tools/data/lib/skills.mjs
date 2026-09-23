/**
 * Combat skills: the per-level data the operator page's Skills tab draws.
 *
 * Descriptions are resolved here rather than on the page. The importer already owns the game's templates and markup, and `check.mjs` fails the
 * build if any markup survives, so the page receives plain runs of text, each marked as a raised value, a lowered value, or neither. Only `@`-
 * and `$`-prefixed tags are markup - an un-prefixed tag such as `<Substitute>` is content and its name is kept as plain text. A run never starts
 * with a space that its previous run's text already ends with, which is what an empty emphasis pair such as `<@ba.vup></>` would otherwise leave
 * behind as a doubled space.
 */

import { asArray } from "./json.mjs";
import { phaseOf } from "./operators.mjs";
import { CONTENT_TAG, resolveTemplate } from "./text.mjs";

/** The two value tags a skill description keeps as emphasis. Every other prefixed tag is dropped and its text kept. */
const EMPHASIS = { "@ba.vup": "up", "@ba.vdown": "down" };

/** An opening markup tag (`@` or `$`-prefixed) or the `</>` closer. Anything else in angle brackets is content, not markup. */
const TAG = /<([@$][^>]*|\/)>/g;

/** Skill trigger by upstream `skillType`. */
const TRIGGER = { AUTO: "auto", MANUAL: "manual", PASSIVE: "passive" };

/** The blackboard key a skill uses to stretch the normal range forward instead of swapping in a new range id. */
const RANGE_EXTEND_KEY = "ability_range_forward_extend";

/** SP recovery by upstream `spData.spType`. Anything else, such as the numeric type a few passives carry, has no recovery to show. */
const RECOVERY = { INCREASE_WITH_TIME: "auto", INCREASE_WHEN_ATTACK: "offensive", INCREASE_WHEN_TAKEN_DAMAGE: "defensive" };

/**
 * The published file key for a skill icon. Upstream icon ids carry brackets and `#`, which a raw GitHub URL cannot hold unescaped, so every run of
 * characters outside `[a-z0-9_]` becomes one `_`, and a trailing `_` is dropped. `tools/assets/encode.py` applies the same rule to file names.
 *
 * @param {string} id The upstream `iconId`, or the skill id when it has none.
 * @returns {string} The key, such as `skcom_powerstrike_3` for `skcom_powerstrike[3]`.
 */
export function iconKey(id) {
	return id
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+$/, "");
}

/**
 * Resolve one skill level's description into runs of plain text.
 *
 * Tags nest, so a stack tracks the emphasis in force: `@ba.vup` and `@ba.vdown` set it, any other markup tag inherits the one around it, and
 * `</>` pops. Adjacent runs with the same emphasis merge, and spaces and tabs squeeze to one while line breaks are kept. A chunk's leading space
 * is dropped when the previous run's text already ends with one, so an empty tag pair such as `<@ba.vup></>` cannot leave behind a doubled space.
 *
 * @param {string} text The templated description.
 * @param {Array<{key: string, value: number}>} blackboard The level's values.
 * @returns {Array<{text: string, emphasis: "up" | "down" | null}>} The runs, in order.
 */
export function describeRuns(text, blackboard) {
	const resolved = resolveTemplate(text, blackboard).replace(/\r\n/g, "\n").replace(CONTENT_TAG, "$1").trim();
	const runs = [];
	const stack = [];
	const push = (chunk) => {
		let tidy = chunk.replace(/[^\S\n]+/g, " ");
		const last = runs.at(-1);
		if (last && last.text.endsWith(" ") && tidy.startsWith(" ")) {
			tidy = tidy.slice(1);
		}
		if (!tidy) {
			return;
		}
		const emphasis = stack.at(-1) ?? null;
		if (last && last.emphasis === emphasis) {
			last.text += tidy;
		} else {
			runs.push({ text: tidy, emphasis });
		}
	};
	let cursor = 0;
	for (const match of resolved.matchAll(TAG)) {
		push(resolved.slice(cursor, match.index));
		if (match[1] === "/") {
			stack.pop();
		} else {
			stack.push(EMPHASIS[match[1]] ?? stack.at(-1) ?? null);
		}
		cursor = match.index + match[0].length;
	}
	push(resolved.slice(cursor));
	return runs;
}

/**
 * Build one operator's skills from its character-table row.
 *
 * @param {object} row The operator's `character_table` row.
 * @param {object} skillTable `skill_table`, keyed by skill id.
 * @returns {Array<object>} One entry per skill slot that `skill_table` knows, in slot order.
 */
export function buildSkills(row, skillTable) {
	return asArray(row.skills)
		.filter((slot) => slot.skillId && skillTable[slot.skillId])
		.map((slot) => {
			const skill = skillTable[slot.skillId];
			return {
				id: slot.skillId,
				icon: iconKey(skill.iconId ?? slot.skillId),
				unlockPhase: phaseOf(slot.unlockCond?.phase),
				levels: asArray(skill.levels).map((level) => {
					const trigger = TRIGGER[level.skillType];
					if (!trigger) {
						throw new Error(`${slot.skillId} has an unknown skillType ${JSON.stringify(level.skillType)}`);
					}
					const extend = asArray(level.blackboard).find((entry) => entry.key === RANGE_EXTEND_KEY)?.value;
					// A few templates name the level's own duration field, not a blackboard key, so it is seeded first and a real blackboard entry
					// named "duration" still wins.
					return {
						name: level.name,
						description: describeRuns(level.description, [{ key: "duration", value: level.duration ?? 0 }, ...asArray(level.blackboard)]),
						trigger,
						recovery: RECOVERY[level.spData?.spType] ?? null,
						spCost: level.spData?.spCost ?? 0,
						initialSp: level.spData?.initSp ?? 0,
						duration: level.duration ?? 0,
						// The range while the skill is active. Null means the operator's normal range.
						rangeId: level.rangeId ?? null,
						// Tiles the skill stretches the normal range forward, or takes away when negative. Left out when it does not change it.
						...(extend ? { rangeExtend: extend } : {})
					};
				})
			};
		});
}
