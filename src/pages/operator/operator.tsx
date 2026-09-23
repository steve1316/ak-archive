import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useParams, useSearchParams } from "react-router-dom";

import { LoadError, PageBackdrop, ScrollToTop } from "archive-kit";

import { loadOperator, loadOperatorDetails } from "../../lib/data.js";
import { formsOf, readFormKey, writeFormKey } from "../../lib/forms.js";
import { applyControlsPatch, applyModule } from "../../lib/modules.js";
import { operatorPath, resolveOperatorParam } from "../../lib/routes.js";
import NotFound404 from "../../not_found_404.js";
import type { Controls, OperatorFull } from "../../types/operator.js";
import AbilitiesCard from "./AbilitiesCard.js";
import AnimationsCard from "../../components/AnimationsCard.js";
import type { StageRequest } from "../../components/AnimationsCard.js";
import ArtCard from "./ArtCard.js";
import HandbookSection from "./HandbookSection.js";
import RecordsSection from "./RecordsSection.js";
import IdentityBlock from "./IdentityBlock.js";
import { HERO_ROW_SX, NAVBAR_HEIGHT, PAGE_SX, PAGE_TOP_PADDING, STATS_ROW_STRETCH_SX } from "../../lib/layout.js";
import RecordBlock from "../../components/RecordBlock.js";
import SpineStage from "./SpineStage.js";
import StatsPanel from "./StatsPanel.js";

/** Controls held before any operator has loaded. Never rendered, since the grid does not appear until the operator is set. */
const INITIAL_CONTROLS: Controls = { phase: 0, level: 1, trust: true, potential: 1, module: null, moduleStage: 3 };

/**
 * Everything above the fold. From `md` up it is at least one screen tall, and the first row takes whatever the second leaves, so slack goes to
 * the Animations stage rather than hollowing out a card. `1fr` is `minmax(auto, 1fr)`, so a row can grow but never shrink below its content.
 */
const FOLD_SX: SxProps<Theme> = (theme) => ({
	display: "grid",
	gap: 2,
	gridTemplateRows: { md: "1fr auto" },
	minHeight: { md: `calc(100dvh - ${NAVBAR_HEIGHT}px - ${theme.spacing(PAGE_TOP_PADDING)})` }
});

/** Space between the fold and the handbook below it, the same as between the two rows above. */
const HANDBOOK_SX: SxProps<Theme> = { mt: 2 };

/**
 * The default controls for a freshly loaded operator: the last elite phase, that phase's max level, full trust and potential 1.
 *
 * This is the combination a wiki prints, and for Amiya it is the hand-verified 1680 HP / 682 ATK / 121 DEF fixture.
 *
 * @param operator The loaded operator.
 * @returns The default control values.
 */
function defaultControls(operator: OperatorFull): Controls {
	const phase = Math.max(0, operator.stats.phases.length - 1);
	const maxLevel = operator.stats.phases[phase]?.maxLevel ?? 1;
	return { ...INITIAL_CONTROLS, phase, level: maxLevel };
}

/**
 * The operator's affiliations for the record, most specific first.
 *
 * @param operator The loaded operator.
 * @returns The team, group and nation that upstream names, joined, or null when it names none.
 */
function affiliationOf(operator: OperatorFull): string | null {
	const names = [operator.team, operator.group, operator.nation].filter((name): name is string => name !== null);
	return names.length > 0 ? names.join(", ") : null;
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
	const id = resolveOperatorParam(useParams().id);
	const [searchParams, setSearchParams] = useSearchParams();

	const [operator, setOperator] = useState<OperatorFull | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [attempt, setAttempt] = useState(0);
	const [controls, setControls] = useState<Controls>(INITIAL_CONTROLS);

	const forms = useMemo(() => (operator ? formsOf(operator) : []), [operator]);
	const formKey = readFormKey(searchParams, forms);
	const form = forms.find((entry) => entry.key === formKey) ?? null;
	const effect = useMemo(() => (operator ? applyModule(operator, controls) : null), [operator, controls]);

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
		// Fetched together so the two requests start at once - the shard the index also loads, and the details file only this page needs.
		Promise.all([loadOperator(id), loadOperatorDetails(id)]).then(
			([loadedOperator, loadedDetails]) => {
				if (!active) {
					return;
				}
				if (!loadedOperator) {
					setMissing(true);
					return;
				}
				// A real operator with no details entry is a broken import rather than a 404, so it takes the same retry path as a network failure.
				if (!loadedDetails) {
					setError(true);
					return;
				}
				const loaded: OperatorFull = { ...loadedOperator, ...loadedDetails };
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

	// Applies a control change from the Stats or Abilities card. `applyControlsPatch` settles the level and the module in this same update rather
	// than in a separate effect that runs after paint, so a render never shows a level or module the new controls do not allow.
	const handleControlsChange = useCallback(
		(patch: Partial<Controls>) => {
			setControls((current) => (operator ? applyControlsPatch(operator, current, patch) : { ...current, ...patch }));
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

	/**
	 * Draws the Animations card's stage: the live chibi for the selected form.
	 *
	 * @param request The card's selected kind and facing, and its status callback.
	 * @returns The stage, or nothing before the operator loads.
	 */
	const renderStage = useCallback(
		({ kind, facing, onStatus }: StageRequest) =>
			operator ? <SpineStage operatorId={operator.id} formKey={formKey} kind={kind} facing={facing} profession={operator.profession} onStatus={onStatus} /> : null,
		[operator, formKey]
	);

	if (missing) {
		return <NotFound404 />;
	}

	const artParams = new URLSearchParams();
	if (formKey !== null) {
		writeFormKey(artParams, formKey, forms);
	}
	const artQuery = artParams.toString();
	const artLink = `${operatorPath(id ?? "", "/art")}${artQuery ? `?${artQuery}` : ""}`;

	return (
		<Box component="main">
			{/* The portrait, not the illustration: under this much blur they look alike, and the portrait is already loaded for the art card. */}
			<PageBackdrop artUrl={form?.portrait ?? form?.illustration} />
			<ScrollToTop />
			<Box sx={PAGE_SX}>
				{error ? (
					<LoadError what="this operator" onRetry={handleRetry} titleComponent="h1" />
				) : operator ? (
					<>
						{/* `data-region` marks the fold so its bottom edge can be measured against the viewport when checking the above-the-fold layout. */}
						<Box sx={FOLD_SX} data-region="fold">
							<Box sx={HERO_ROW_SX}>
								<ArtCard name={operator.name} portrait={form?.portrait ?? null} illustration={form?.illustration ?? null} artLink={artLink} />
								<Box sx={{ minWidth: 0 }}>
									<IdentityBlock operator={operator} forms={forms} formKey={formKey} onFormChange={handleFormChange} />
									<RecordBlock record={operator.record} affiliation={affiliationOf(operator)} trait={effect?.trait.base ?? null} traitExtra={effect?.trait.extra ?? null} />
								</Box>
								<AnimationsCard key={operator.id} interactive renderStage={renderStage} />
							</Box>
							<Box sx={STATS_ROW_STRETCH_SX}>
								<StatsPanel operator={operator} stage={effect?.stage ?? null} controls={controls} onChange={handleControlsChange} />
								<AbilitiesCard operator={operator} controls={controls} talents={effect?.talents ?? []} onChange={handleControlsChange} />
							</Box>
						</Box>
						<Box sx={HANDBOOK_SX}>
							<HandbookSection id={operator.id} artUrl={form?.illustration ?? null} />
							<RecordsSection records={operator.records ?? []} />
						</Box>
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
