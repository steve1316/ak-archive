/**
 * The operator's handbook, parsed once and split into what the shard carries and what loads on scroll.
 *
 * The lore is the only part still split out. It is most of the weight and only the operator page reads it, so it stays a side file.
 */

import { asArray } from "./json.mjs";
import { splitRecord } from "./record.mjs";
import { isPlaceholder, stripMarkup } from "./text.mjs";

/**
 * Angle brackets left after `stripMarkup`. In the handbook these are glitch text in redacted fields, such as Ifrit's Basic Info, where a stray
 * `<` and `>` wrap noise rather than a term, so they are dropped here. Anywhere else a leftover bracket fails the gate instead.
 */
const REDACTION_NOISE = /<[^>]*>/g;

/**
 * One operator's lore sections and handbook record, split into a shard half and a side half.
 *
 * @param {string} id The operator id.
 * @param {object} context Lookups: `handbookDict` from `handbook_info_table`.
 * @returns {{shard: {record: object}, side: {lore: Array<{title: string, text: string}>}}} The record sits above the fold, so it rides in the
 *   shard the page already loads, and the lore alone stays in the side file.
 */
export function buildHandbook(id, { handbookDict }) {
	const sections = asArray(handbookDict[id]?.storyTextAudio);
	const lore = sections
		.map((section) => ({
			title: section.storyTitle ?? "",
			// A section can hold several story blocks. They read as one passage, so they are joined rather than surfaced separately.
			text: asArray(section.stories)
				.map((story) => stripMarkup(story.storyText).replace(REDACTION_NOISE, ""))
				.filter(Boolean)
				.join("\n\n")
		}))
		// Amiya carries the only locked entry at the pinned sha, a section titled full-width question marks with a body of the same. The text
		// field is the section's actual content, so it is what gets tested - a section keeps its place if its body has anything real in it,
		// no matter how the title reads.
		.filter((section) => !isPlaceholder(section.text));

	const { record, lore: prose } = splitRecord(lore);
	return { shard: { record }, side: { lore: prose } };
}
