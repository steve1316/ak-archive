import { useCallback, useEffect, useRef, useState } from "react";

import { Box, Skeleton } from "@mui/material";

import { LoadError } from "archive-kit";

import { loadProfile } from "../../lib/data.js";
import type { LoreSection } from "../../types/operator.js";
import LorePanel from "./LorePanel.js";

/**
 * The observer's root margin. A bare `0px` is not enough: the fold is deliberately at least one screen tall, so on most operators the handbook
 * sits flush against the initial viewport's bottom edge, and Chromium reports a target whose edge exactly touches the root's edge as
 * intersecting even at a zero overlap ratio. Insetting the root's bottom edge by 1px means the target has to actually cross into the viewport.
 */
const ROOT_MARGIN = "0px 0px -1px 0px";

/** Props for HandbookSection. */
interface HandbookSectionProps {
	/** The operator whose handbook to load. */
	id: string;
}

/**
 * Loads an operator's handbook prose and renders it, but only once the section is actually on screen. It watches its own placeholder with an
 * `IntersectionObserver` rather than the kit's `LazySection`, which pre-loads 300px early - on this page the handbook sits right at the fold, so
 * that margin fires before the reader has really scrolled to it. The class's lore file is the heaviest thing an operator page can pull, so
 * waiting for a real intersection is what keeps it off the page's initial load.
 *
 * @param props Component props.
 * @returns A placeholder until the section is on screen, then the handbook, its loading skeleton, or a retry notice.
 */
export default function HandbookSection({ id }: HandbookSectionProps) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [near, setNear] = useState(false);
	const [lore, setLore] = useState<LoreSection[] | null>(null);
	const [failed, setFailed] = useState(false);
	// Bumped by the retry button to run the load again. The data store drops a failed file, so a retry really refetches.
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		const element = ref.current;
		// No IntersectionObserver means no way to tell, so show the content rather than hide it forever.
		if (!element || typeof IntersectionObserver === "undefined") {
			setNear(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setNear(true);
					observer.disconnect();
				}
			},
			{ rootMargin: ROOT_MARGIN }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!near) {
			return;
		}
		let active = true;
		setLore(null);
		setFailed(false);
		loadProfile(id).then(
			(profile) => {
				if (active) {
					setLore(profile?.lore ?? []);
				}
			},
			() => {
				if (active) {
					setFailed(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [id, near, attempt]);

	const handleRetry = useCallback(() => setAttempt((current) => current + 1), []);

	if (!near) {
		return <Box ref={ref} sx={{ minHeight: 320 }} />;
	}
	if (failed) {
		return <LoadError what="the handbook" onRetry={handleRetry} />;
	}
	if (lore === null) {
		return <Skeleton variant="rounded" height={320} />;
	}
	return <LorePanel lore={lore} />;
}
