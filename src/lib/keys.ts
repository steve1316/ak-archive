/** Elements that take typing, where arrow keys move the caret. */
const TEXT_SELECTOR = "input, textarea, select, [contenteditable='true']";

/** Elements that keep their own keys: fields, buttons, links and editable text. */
const CONTROL_SELECTOR = `${TEXT_SELECTOR}, button, a`;

/**
 * Whether a key press landed on a control that keeps the key for itself, such as a text field, a focused button or a link. Page-wide key
 * handlers check this so Space and Enter still type, press and follow.
 *
 * @param target The key event's target.
 * @returns True when the target is, or sits inside, such a control.
 */
export function isControlTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;
}

/**
 * Whether a key press landed on a field that takes typing, where the arrow keys belong to the field. A focused button does not count, so arrow
 * keys still work after the reader clicks one.
 *
 * @param target The key event's target.
 * @returns True when the target is, or sits inside, such a field.
 */
export function isTextTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TEXT_SELECTOR) !== null;
}
