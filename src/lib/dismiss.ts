import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Close a panel on any click outside it. A click that `swallow` accepts does only that, so closing the panel never also presses what sits under
 * it. Any other outside click closes the panel and still does its own job, such as a navbar link.
 *
 * @param panel The panel's element.
 * @param onClose Called to close the panel.
 * @param swallow Whether an outside click is spent on closing alone.
 */
export function useCloseOnOutsideClick(panel: RefObject<HTMLElement | null>, onClose: () => void, swallow: (target: Element) => boolean) {
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element) || panel.current?.contains(event.target)) {
				return;
			}
			if (swallow(event.target)) {
				event.stopPropagation();
				event.preventDefault();
			}
			onClose();
		};
		window.addEventListener("click", onClick, true);
		return () => window.removeEventListener("click", onClick, true);
	}, [panel, onClose, swallow]);
}
