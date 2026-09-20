import { useMemo } from "react";
import type { MouseEvent } from "react";

import { Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { LevelSlider } from "archive-kit";

import { statsAt } from "../../lib/stats.js";
import type { Operator, StatValues } from "../../types/operator.js";
import type { Controls } from "./operator.js";

/** One stat row: the label the panel shows and the `StatValues` field it reads, in display order. */
const STAT_ROWS: ReadonlyArray<{ label: string; key: keyof StatValues }> = [
	{ label: "Max HP", key: "maxHp" },
	{ label: "ATK", key: "atk" },
	{ label: "DEF", key: "def" },
	{ label: "Arts Resist", key: "magicResistance" },
	{ label: "DP Cost", key: "cost" },
	{ label: "Block", key: "blockCnt" },
	{ label: "Attack Interval", key: "baseAttackTime" },
	{ label: "Redeploy", key: "respawnTime" }
];

/** The potential ranks offered, 1 through 6. Rank 1 is the operator as recruited and never carries a `potentials` entry. */
const POTENTIAL_RANKS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6];

/** Styles shared by the panel's three button rows: full width, with every button given an equal share. */
const TOGGLE_ROW_SX: SxProps<Theme> = { width: "100%", "& .MuiToggleButton-root": { flex: 1 } };

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
 * The operator page's stats panel: elite phase, level, trust and potential controls, plus the eight stats those controls resolve to.
 *
 * The panel owns no state. Every control reads its value from `controls` and reports a change through `onChange`, so the page stays the single
 * source of truth for the controls that the talents and skins panels will also read.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function StatsPanel({ operator, controls, onChange }: StatsPanelProps) {
	const { phase, level, trust, potential } = controls;

	const maxLevel = operator.stats.phases[phase]?.maxLevel ?? 1;
	const stats = useMemo(() => statsAt(operator, phase, level, { trust, potential }), [operator, phase, level, trust, potential]);
	// The exact rank the potential picker has selected, not every rank up to it, since this is only for the CUSTOM-rank description below.
	const potentialEntry = operator.potentials.find((entry) => entry.rank === potential);

	const handlePhaseChange = (_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			onChange({ phase: value });
		}
	};

	const handleTrustChange = (_event: MouseEvent<HTMLElement>, value: boolean | null) => {
		if (value !== null) {
			onChange({ trust: value });
		}
	};

	const handlePotentialChange = (_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			onChange({ potential: value });
		}
	};

	return (
		<Card>
			<CardContent>
				<Typography variant="caption" color="text.secondary">
					Elite phase
				</Typography>
				<ToggleButtonGroup value={phase} exclusive onChange={handlePhaseChange} sx={TOGGLE_ROW_SX} aria-label="Elite phase">
					{operator.stats.phases.map((_phaseEntry, index) => (
						<ToggleButton key={index} value={index}>
							{`E${index}`}
						</ToggleButton>
					))}
				</ToggleButtonGroup>

				<LevelSlider id="stats-level-label" label="Level" value={level} max={maxLevel} onChange={(newLevel) => onChange({ level: newLevel })} sx={{ mt: 2 }} />

				<Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
					Trust
				</Typography>
				<ToggleButtonGroup value={trust} exclusive onChange={handleTrustChange} sx={TOGGLE_ROW_SX} aria-label="Trust">
					<ToggleButton value={false}>None</ToggleButton>
					<ToggleButton value={true}>Full</ToggleButton>
				</ToggleButtonGroup>

				<Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
					Potential
				</Typography>
				<ToggleButtonGroup value={potential} exclusive onChange={handlePotentialChange} sx={TOGGLE_ROW_SX} aria-label="Potential">
					{POTENTIAL_RANKS.map((rank) => (
						<ToggleButton key={rank} value={rank}>
							{`P${rank}`}
						</ToggleButton>
					))}
				</ToggleButtonGroup>
				{potentialEntry?.type === "CUSTOM" ? (
					<Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
						{potentialEntry.description}
					</Typography>
				) : null}

				<TableContainer sx={{ mt: 2 }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>Stat</TableCell>
								<TableCell align="right">Value</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{STAT_ROWS.map((row) => (
								<TableRow key={row.key}>
									<TableCell component="th" scope="row">
										{row.label}
									</TableCell>
									<TableCell align="right">{stats[row.key]}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableContainer>
			</CardContent>
		</Card>
	);
}
