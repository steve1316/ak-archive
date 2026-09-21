// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Handbook record

/**
 * Physical exam grades, weakest first. Read from the data rather than assumed: these are every single-word grade the pinned tables use.
 *
 * The order is the game's. `src/pages/operator/RecordBlock.tsx` draws a bar of `GRADES.length` segments - change one, update the other.
 */
export const GRADES = ["Feeble", "Flawed", "Normal", "Standard", "Excellent", "Outstanding", "Exceptional"];

/** The handbook sections that are a record of fields rather than prose, and where each lands in the parsed record. */
const RECORD_SECTIONS = new Map([
	["Basic Info", "basic"],
	["Physical Exam", "exam"]
]);

/** One `[Label] value` line. The value may be empty, when upstream puts it on the lines that follow. */
const FIELD_LINE = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * Parse one bracketed handbook section into fields.
 *
 * Each `[Label] value` line starts a field. A line with no bracket continues the field before it, which is how `[Infection Status]` carries its
 * sentence. Text before the first bracket is dropped, since it belongs to no field.
 *
 * @param {string} text The section body.
 * @returns {{label: string, value: string, grade: number | null}[]} The fields in upstream order. `grade` is 1 to `GRADES.length`, or null.
 */
export function parseRecord(text) {
	const fields = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line === "") {
			continue;
		}
		const match = FIELD_LINE.exec(line);
		if (match) {
			fields.push({ label: match[1].trim(), value: match[2].trim() });
		} else if (fields.length > 0) {
			const last = fields[fields.length - 1];
			last.value = last.value === "" ? line : `${last.value} ${line}`;
		}
	}
	return fields.map((field) => {
		const index = GRADES.indexOf(field.value);
		return { label: field.label, value: field.value, grade: index === -1 ? null : index + 1 };
	});
}

/**
 * Move the record sections out of an operator's lore.
 *
 * Only the first Basic Info and the first Physical Exam become the record. Amiya's handbook holds two full dossiers, one per class
 * conversion, each starting its own section titled Basic Info and Physical Exam - taking every same-titled section would let the second
 * dossier silently overwrite the first. Keeping only the first still loses nothing: the second dossier stays in the lore as prose, in its
 * original position next to its own "Class Conversion Record" heading, rather than replacing the one already captured.
 *
 * A first occurrence that yields no fields still stays as prose, as before, and no later section of the same title is ever parsed - it
 * stays as prose too, even if it would have parsed cleanly on its own.
 *
 * @param {{title: string, text: string}[]} lore The operator's handbook sections.
 * @returns {{record: {basic: object[], exam: object[]}, lore: {title: string, text: string}[]}} The parsed record and the sections left over.
 */
export function splitRecord(lore) {
	const record = { basic: [], exam: [] };
	const seen = new Set();
	const remaining = [];
	for (const section of lore) {
		const slot = RECORD_SECTIONS.get(section.title);
		if (slot === undefined || seen.has(slot)) {
			remaining.push(section);
			continue;
		}
		seen.add(slot);
		const fields = parseRecord(section.text);
		if (fields.length === 0) {
			remaining.push(section);
		} else {
			record[slot] = fields;
		}
	}
	return { record, lore: remaining };
}
