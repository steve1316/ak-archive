import { useMemo } from "react";
import type { MouseEvent } from "react";

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { LevelSlider } from "archive-kit";

import RangeGrid from "../../components/RangeGrid.js";
import { statsAt } from "../../lib/stats.js";
import type { Controls, Operator, StatValues, TrustBonus } from "../../types/operator.js";
import { SECTION_HEADING_SX, SECTION_SX, STAT_ROW_SX } from "../../lib/layout.js";

/** One single-stat row: its label, the `StatValues` field it reads, and the `TrustBonus` field that marks what full trust adds to it. */
const STAT_ROWS: ReadonlyArray<{ label: string; key: keyof StatValues; trustKey: keyof TrustBonus }> = [
	{ label: "HP", key: "maxHp", trustKey: "maxHp" },
	{ label: "ATK", key: "atk", trustKey: "atk" },
	{ label: "DEF", key: "def", trustKey: "def" },
	{ label: "Arts resist", key: "magicResistance", trustKey: "magicResistance" }
];

/** The potential ranks offered, 1 through 6. Rank 1 is the operator as recruited and never carries a `potentials` entry. */
const POTENTIAL_RANKS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6];

/** One row of the stat list: label on the left, value (and any trust badge) on the right. */
const ROW_SX: SxProps<Theme> = { display: "flex", alignItems: "baseline", justifyContent: "space-between", ...STAT_ROW_SX };

/** The stat list itself, above the controls. */
const ROWS_SX: SxProps<Theme> = { flex: "none" };

/** The trust bonus badge shown after a stat's value. */
const TRUST_BADGE_SX: SxProps<Theme> = { ml: 0.75, color: "primary.main" };

/** The controls block below the stat list. */
const CONTROLS_SX: SxProps<Theme> = { flex: "none", mt: 0.75, display: "flex", flexDirection: "column", gap: 1.25 };

/** The range grid block between the stat list and the controls. */
const RANGE_SX: SxProps<Theme> = { flex: "none", mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider" };

/** The trust and potential row: a single trust toggle beside the potential group. */
const TRUST_POTENTIAL_ROW_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1 };

/** Props for StatsPanel. */
interface StatsPanelProps {
	/** The operator whose stats the panel shows. */
	operator: Operator;
	/** The page's shared phase, level, trust and potential controls. */
	controls: Controls;
	/** Called with the changed fields whenever a control is used. The page owns `controls` and applies the change. */
	onChange: (patch: Partial<Controls>) => void;
}

/**
 * The operator page's stats card: the eight stats those controls resolve to, then the elite phase, level, trust and potential controls that pick
 * them, matching the locked design's order of value first, controls below.
 *
 * The card owns no state. Every control reads its value from `controls` and reports a change through `onChange`, so the page stays the single
 * source of truth for the controls that the Abilities card also reads.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function StatsPanel({ operator, controls, onChange }: StatsPanelProps) {
	const { phase, level, trust, potential } = controls;

	const maxLevel = operator.stats.phases[phase]?.maxLevel ?? 1;
	const rangeId = operator.stats.phases[phase]?.rangeId;
	const stats = useMemo(() => statsAt(operator, phase, level, { trust, potential }), [operator, phase, level, trust, potential]);

	const handlePhaseChange = (_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			onChange({ phase: value });
		}
	};

	const handleTrustToggle = () => {
		onChange({ trust: !trust });
	};

	const handlePotentialChange = (_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			onChange({ potential: value });
		}
	};

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
				Stats
			</Typography>
			<Box sx={ROWS_SX}>
				{STAT_ROWS.map((row) => {
					const bonus = operator.stats.trustBonus[row.trustKey];
					return (
						<Box key={row.key} sx={ROW_SX}>
							<Typography variant="body2" color="text.secondary">
								{row.label}
							</Typography>
							<Typography variant="body2">
								{stats[row.key]}
								{trust && bonus > 0 ? (
									<Box component="span" sx={TRUST_BADGE_SX}>
										<Typography component="span" variant="caption">{`+${bonus}`}</Typography>
									</Box>
								) : null}
							</Typography>
						</Box>
					);
				})}
				<Box sx={ROW_SX}>
					<Typography variant="body2" color="text.secondary">
						Cost / Block
					</Typography>
					<Typography variant="body2">{`${stats.cost} / ${stats.blockCnt}`}</Typography>
				</Box>
				<Box sx={ROW_SX}>
					<Typography variant="body2" color="text.secondary">
						Interval / Redeploy
					</Typography>
					<Typography variant="body2">{`${stats.baseAttackTime}s / ${stats.respawnTime}s`}</Typography>
				</Box>
			</Box>

			{rangeId ? (
				<Box sx={RANGE_SX}>
					<RangeGrid rangeId={rangeId} traitRangeId={operator.traitRangeId} />
				</Box>
			) : null}

			<Box sx={CONTROLS_SX}>
				<ToggleButtonGroup value={phase} exclusive size="small" onChange={handlePhaseChange} aria-label="Elite phase">
					{operator.stats.phases.map((_phaseEntry, index) => (
						<ToggleButton key={index} value={index}>
							{`E${index}`}
						</ToggleButton>
					))}
				</ToggleButtonGroup>

				<LevelSlider id="stats-level-label" label="Level" value={level} max={maxLevel} onChange={(newLevel) => onChange({ level: newLevel })} />

				<Box sx={TRUST_POTENTIAL_ROW_SX}>
					<ToggleButton value="trust" size="small" selected={trust} onChange={handleTrustToggle}>
						Full trust
					</ToggleButton>
					<ToggleButtonGroup value={potential} exclusive size="small" onChange={handlePotentialChange} aria-label="Potential">
						{POTENTIAL_RANKS.map((rank) => (
							<ToggleButton key={rank} value={rank}>
								{`P${rank}`}
							</ToggleButton>
						))}
					</ToggleButtonGroup>
				</Box>
			</Box>
		</Paper>
	);
}
