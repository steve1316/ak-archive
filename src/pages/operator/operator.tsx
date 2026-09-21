import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useParams, useSearchParams } from "react-router-dom";

import { LazySection, LoadError, PageBackdrop, ScrollToTop } from "archive-kit";

import { loadOperator } from "../../lib/data.js";
import { formsOf, readFormKey, writeFormKey } from "../../lib/forms.js";
import NotFound404 from "../../not_found_404.js";
import type { Controls, Operator as OperatorRecord } from "../../types/operator.js";
import ArtCard from "./ArtCard.js";
import IdentityBlock from "./IdentityBlock.js";
import { NAVBAR_HEIGHT } from "./layout.js";
import LorePanel from "./LorePanel.js";
import StatsPanel from "./StatsPanel.js";
import TalentsPanel from "./TalentsPanel.js";

/** Controls held before any operator has loaded. Never rendered, since the grid does not appear until the operator is set. */
const INITIAL_CONTROLS: Controls = { phase: 0, level: 1, trust: true, potential: 1 };

/** The page body: above the fixed backdrop, with the locked design's 14px top and 20px side padding. */
const PAGE_SX: SxProps<Theme> = { position: "relative", zIndex: 1, px: { xs: 2, md: 2.5 }, pt: 1.75, pb: 3 };

/**
 * Everything above the fold. From `md` up it is at least one screen tall, and the first row takes whatever the second leaves, so slack goes to
 * the Animations stage rather than hollowing out a card. `1fr` is `minmax(auto, 1fr)`, so a row can grow but never shrink below its content.
 */
const FOLD_SX: SxProps<Theme> = { display: "grid", gap: 1.75, gridTemplateRows: { md: "1fr auto" }, minHeight: { md: `calc(100dvh - ${NAVBAR_HEIGHT}px - 14px)` } };

/** Row 1: art card, identity and record, Animations. Stacked on a narrow screen. */
const ROW1_SX: SxProps<Theme> = { display: "grid", gap: { xs: 2, md: 2.75 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "180px minmax(0, 1fr) 330px" } };

/** Row 2: stats beside the abilities. Content height - nothing here stretches. */
const ROW2_SX: SxProps<Theme> = { display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "360px minmax(0, 1fr)" } };

/**
 * The default controls for a freshly loaded operator: the last elite phase, that phase's max level, full trust and potential 1.
 *
 * This is the combination a wiki prints, and for Amiya it is the hand-verified 1680 HP / 682 ATK / 121 DEF fixture.
 *
 * @param operator The loaded operator.
 * @returns The default control values.
 */
function defaultControls(operator: OperatorRecord): Controls {
	const phase = Math.max(0, operator.stats.phases.length - 1);
	const maxLevel = operator.stats.phases[phase]?.maxLevel ?? 1;
	return { phase, level: maxLevel, trust: true, potential: 1 };
}

/**
 * The operator detail page, laid out to the locked design: a backdrop of the selected form's art, then everything a reader needs above the fold.
 *
 * The selected form lives in the query string as `?skin=`, as gfl's doll page keeps its selection, so a form can be linked to and the art viewer
 * can open on it. Switching replaces the history entry rather than pushing one, so Back leaves the page instead of stepping through every chip.
 *
 * @returns The page.
 */
export default function Operator() {
	const { id } = useParams();
	const [searchParams, setSearchParams] = useSearchParams();

	const [operator, setOperator] = useState<OperatorRecord | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [attempt, setAttempt] = useState(0);
	const [controls, setControls] = useState<Controls>(INITIAL_CONTROLS);

	const forms = useMemo(() => (operator ? formsOf(operator) : []), [operator]);
	const formKey = readFormKey(searchParams, forms);
	const form = forms.find((entry) => entry.key === formKey) ?? null;

	// Keyed on `id` so navigating between operators re-runs the load and, on success below, resets every control rather than carrying the
	// previous operator's phase and level onto one that may not reach them.
	useEffect(() => {
		if (!id) {
			setMissing(true);
			return;
		}
		let active = true;
		setOperator(null);
		setMissing(false);
		setError(false);
		loadOperator(id).then(
			(loaded) => {
				if (!active) {
					return;
				}
				if (!loaded) {
					setMissing(true);
					return;
				}
				setOperator(loaded);
				setControls(defaultControls(loaded));
			},
			() => {
				if (active) {
					setError(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [id, attempt]);

	const handleRetry = useCallback(() => setAttempt((current) => current + 1), []);

	// Applies a control change from the stats panel. A phase change clamps `level` into the new phase's max in this same update, rather than a
	// separate effect that runs after paint, so a render can never show a level or a stat computed from a level the new phase does not reach.
	const handleControlsChange = useCallback(
		(patch: Partial<Controls>) => {
			setControls((current) => {
				const next = { ...current, ...patch };
				if (patch.phase !== undefined) {
					const maxLevel = operator?.stats.phases[next.phase]?.maxLevel;
					if (maxLevel !== undefined) {
						next.level = Math.min(next.level, maxLevel);
					}
				}
				return next;
			});
		},
		[operator]
	);

	const handleFormChange = useCallback(
		(key: string) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					writeFormKey(next, key, forms);
					return next;
				},
				{ replace: true }
			);
		},
		[forms, setSearchParams]
	);

	if (missing) {
		return <NotFound404 />;
	}

	const artParams = new URLSearchParams();
	if (formKey !== null) {
		writeFormKey(artParams, formKey, forms);
	}
	const artQuery = artParams.toString();
	const artLink = `/operator/${id ?? ""}/art${artQuery ? `?${artQuery}` : ""}`;

	return (
		<Box component="main">
			<PageBackdrop artUrl={form?.illustration} />
			<ScrollToTop />
			<Box sx={PAGE_SX}>
				{error ? (
					<LoadError what="this operator" onRetry={handleRetry} titleComponent="h1" />
				) : operator ? (
					<>
						{/* `data-region` is what the layout gate in Task 9 measures - the fold's bottom edge against the viewport. */}
						<Box sx={FOLD_SX} data-region="fold">
							<Box sx={ROW1_SX}>
								<ArtCard name={operator.name} portrait={form?.portrait ?? null} illustration={form?.illustration ?? null} artLink={artLink} />
								<IdentityBlock operator={operator} forms={forms} formKey={formKey} onFormChange={handleFormChange} />
							</Box>
							<Box sx={ROW2_SX}>
								<StatsPanel operator={operator} controls={controls} onChange={handleControlsChange} />
								<TalentsPanel operator={operator} controls={controls} />
							</Box>
						</Box>
						<LazySection minHeight={320}>
							<LorePanel operatorId={operator.id} />
						</LazySection>
					</>
				) : (
					<Typography variant="body1" color="text.secondary" role="status">
						Loading...
					</Typography>
				)}
			</Box>
		</Box>
	);
}
