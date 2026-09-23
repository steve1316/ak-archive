/** Elements that keep their own keys: fields, buttons, links and editable text. */
const CONTROL_SELECTOR = "input, textarea, select, button, a, [contenteditable='true']";

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
