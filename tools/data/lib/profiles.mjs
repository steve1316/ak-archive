/**
 * The operator page's side data: handbook lore and RIIC base skills.
 *
 * This is split out of the shard because only the operator page reads it. The index never does, and the lore alone is most of the weight.
 */

import { asArray } from "./json.mjs";
import { phaseOf } from "./operators.mjs";
import { stripMarkup } from "./text.mjs";

/**
 * The locked placeholder body the game ships for a handbook entry that has not unlocked yet. Amiya carries the only one at the pinned sha,
 * a section titled full-width question marks with a body of the same. The text field is the section's actual content, so it is what gets
 * tested - a section keeps its place if its body has anything real in it, no matter how the title reads.
 */
const PLACEHOLDER_TEXT = /^[？?\s]+$/;

/**
 * One operator's lore sections and base skills.
 *
 * @param {string} id The operator id.
 * @param {object} context Lookups: `handbookDict` from `handbook_info_table`, and `chars` plus `buffs` from `building_data`.
 * @returns {{lore: Array<{title: string, text: string}>, baseSkills: Array<object>}} The side record.
 */
export function buildProfile(id, { handbookDict, buildingChars, buildingBuffs }) {
	const sections = asArray(handbookDict[id]?.storyTextAudio);
	const lore = sections
		.map((section) => ({
			title: section.storyTitle ?? "",
			// A section can hold several story blocks. They read as one passage, so they are joined rather than surfaced separately.
			text: asArray(section.stories)
				.map((story) => stripMarkup(story.storyText))
				.filter(Boolean)
				.join("\n\n")
		}))
		.filter((section) => section.text !== "" && !PLACEHOLDER_TEXT.test(section.text));

	const baseSkills = [];
	for (const slot of asArray(buildingChars[id]?.buffChar)) {
		for (const entry of asArray(slot.buffData)) {
			const buff = buildingBuffs[entry.buffId];
			if (!buff) {
				continue;
			}
			baseSkills.push({
				id: entry.buffId,
				name: buff.buffName,
				room: buff.roomType,
				description: stripMarkup(buff.description),
				// The unlock condition is an elite phase plus a level, which is what a page shows beside the skill. `phaseOf` throws on anything
				// the enum does not cover, rather than quietly calling it E0.
				phase: phaseOf(entry.cond?.phase),
				level: entry.cond?.level ?? 1
			});
		}
	}
	return { lore, baseSkills };
}
