import { useEffect, useState } from "react";

import { Container, Grid } from "@mui/material";
import { useParams } from "react-router-dom";

import { LazySection, LoadError } from "archive-kit";

import { loadOperatorWithProfile } from "../../lib/data.js";
import type { Operator as OperatorRecord, Profile } from "../../types/operator.js";
import LorePanel from "./LorePanel.js";
import NotFound404 from "../../not_found_404.js";
import OperatorHero from "./OperatorHero.js";
import SkinsPanel from "./SkinsPanel.js";
import StatsPanel from "./StatsPanel.js";
import TalentsPanel from "./TalentsPanel.js";

/** The operator and its profile, loaded together for the page. */
type OperatorData = { operator: OperatorRecord; profile: Profile };

/**
 * The page's four control values. The stats, talents and skins panels (Tasks 12 to 14) all read the same four, so this page owns them in one
 * place and passes them down, rather than each panel keeping its own copy.
 */
export interface Controls {
	/** 0-based elite phase index. */
	phase: number;
	/** Selected level within `phase`. */
	level: number;
	/** Whether full trust bonuses are applied. */
	trust: boolean;
	/** Selected potential rank, 1 to 6. */
	potential: number;
}

/** Controls held before any operator has loaded. Never rendered, since the grid does not appear until `data` is set. */
const INITIAL_CONTROLS: Controls = { phase: 0, level: 1, trust: true, potential: 1 };

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
 * The operator detail page: loads the operator and its profile, owns the shared phase/level/trust/potential controls, and lays out the hero
 * beside the room Tasks 12 to 14 fill with the stats, talents, skins and lore panels.
 *
 * @returns The page.
 */
export default function Operator() {
	const { id } = useParams();

	const [data, setData] = useState<OperatorData | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [attempt, setAttempt] = useState(0);
	const [controls, setControls] = useState<Controls>(INITIAL_CONTROLS);

	// Keyed on `id` so navigating between operators re-runs the load and, on success below, resets every control rather than carrying the
	// previous operator's phase and level onto one that may not reach them.
	useEffect(() => {
		if (!id) {
			setMissing(true);
			return;
		}
		let active = true;
		setData(null);
		setMissing(false);
		setError(false);
		loadOperatorWithProfile(id).then(
			(loaded) => {
				if (!active) {
					return;
				}
				if (!loaded) {
					setMissing(true);
					return;
				}
				setData(loaded);
				setControls(defaultControls(loaded.operator));
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

	const handleRetry = () => setAttempt((current) => current + 1);

	// Applies a control change from the stats panel. A phase change clamps `level` into the new phase's max in this same update, rather than a
	// separate effect that runs after paint, so a render can never show a level or a stat computed from a level the new phase does not reach.
	const handleControlsChange = (patch: Partial<Controls>) => {
		setControls((current) => {
			const next = { ...current, ...patch };
			if (patch.phase !== undefined) {
				const maxLevel = data?.operator.stats.phases[next.phase]?.maxLevel;
				if (maxLevel !== undefined) {
					next.level = Math.min(next.level, maxLevel);
				}
			}
			return next;
		});
	};

	if (missing) {
		return <NotFound404 />;
	}

	return (
		<Container component="main" maxWidth="lg" sx={{ py: 3 }}>
			{error ? (
				<LoadError what="this operator" onRetry={handleRetry} titleComponent="h1" />
			) : data ? (
				<Grid container spacing={3}>
					<Grid size={{ xs: 12, md: 4, lg: 3 }}>
						<OperatorHero operator={data.operator} />
					</Grid>
					<Grid size={{ xs: 12, md: 8, lg: 9 }}>
						<StatsPanel operator={data.operator} controls={controls} onChange={handleControlsChange} />
					</Grid>
					<Grid size={{ xs: 12 }}>
						<TalentsPanel operator={data.operator} controls={controls} />
					</Grid>
					<Grid size={{ xs: 12 }}>
						<SkinsPanel operator={data.operator} />
					</Grid>
					<Grid size={{ xs: 12 }}>
						<LazySection minHeight={320}>
							<LorePanel profile={data.profile} />
						</LazySection>
					</Grid>
				</Grid>
			) : null}
		</Container>
	);
}
