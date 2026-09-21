/**
 * The operator's handbook, parsed once and split into what the shard carries and what loads on scroll.
 *
 * The lore is the only part still split out. It is most of the weight and only the operator page reads it, so it stays a side file.
 */

import { asArray } from "./json.mjs";
import { phaseOf } from "./operators.mjs";
import { splitRecord } from "./record.mjs";
import { isPlaceholder, stripMarkup } from "./text.mjs";

/**
 * One operator's lore sections, handbook record and base skills, split into a shard half and a side half.
 *
 * @param {string} id The operator id.
 * @param {object} context Lookups: `handbookDict` from `handbook_info_table`, and `chars`, `buffs` plus `rooms` from `building_data`.
 * @returns {{shard: {record: object, baseSkills: Array<object>}, side: {lore: Array<{title: string, text: string}>}}} The record and base
 *   skills sit above the fold, so they ride in the shard the page already loads, and the lore alone stays in the side file.
 */
export function buildHandbook(id, { handbookDict, buildingChars, buildingBuffs, buildingRooms }) {
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
		// Amiya carries the only locked entry at the pinned sha, a section titled full-width question marks with a body of the same. The text
		// field is the section's actual content, so it is what gets tested - a section keeps its place if its body has anything real in it,
		// no matter how the title reads.
		.filter((section) => !isPlaceholder(section.text));

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
				// `buff.roomType` is the raw enum, such as `TRADING`. `building_data`'s own `rooms` dict has the display name the game shows,
				// the same way `operators.mjs` resolves class and position - falling back to the enum only if a room is ever missing there.
				room: buildingRooms[buff.roomType]?.name ?? buff.roomType,
				description: stripMarkup(buff.description),
				// The unlock condition is an elite phase plus a level, which is what a page shows beside the skill. `phaseOf` throws on anything
				// the enum does not cover, rather than quietly calling it E0.
				phase: phaseOf(entry.cond?.phase),
				level: entry.cond?.level ?? 1
			});
		}
	}
	const { record, lore: prose } = splitRecord(lore);
	return { shard: { record, baseSkills }, side: { lore: prose } };
}
