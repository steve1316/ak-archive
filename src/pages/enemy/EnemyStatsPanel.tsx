import type { MouseEvent } from "react";

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { RankBar } from "archive-kit";

import { SECTION_HEADING_SX, SECTION_SX, STAT_ROW_SX } from "../../lib/layout.js";
import type { EnemyGrades, EnemyLevel } from "../../types/enemy.js";

/** The handbook's grade scale, worst first, so a grade's position is how many bar segments it fills. */
const GRADE_SCALE = ["E", "D", "C", "B", "B+", "A", "A+", "S", "S+", "SS"];

/** One graded row: its label, the stat it reads and how the value prints. */
const GRADED_ROWS: ReadonlyArray<{ label: string; key: keyof EnemyGrades; format?: (value: number) => string }> = [
	{ label: "HP", key: "maxHp" },
	{ label: "ATK", key: "atk" },
	{ label: "DEF", key: "def" },
	{ label: "Arts resist", key: "magicResistance" },
	{ label: "Attack interval", key: "attackTime", format: (value) => `${value}s` },
	{ label: "Move speed", key: "moveSpeed" },
	{ label: "Elem. resist", key: "epResistance" },
	{ label: "Elem. dmg resist", key: "epDamageResistance" }
];

/** The grade bar's width. `RankBar` segments have no width of their own, so the column must set one. */
const BAR_WIDTH = 100;

/** One row: label on the left, then the grade bar, grade and value. */
const ROW_SX: SxProps<Theme> = {
	display: "grid",
	gridTemplateColumns: `minmax(0, 1fr) ${BAR_WIDTH}px 2.2em 4.5em`,
	alignItems: "center",
	columnGap: 1,
	...STAT_ROW_SX
};

/** A plain row with no grade: label on the left, value on the right. */
const PLAIN_ROW_SX: SxProps<Theme> = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, ...STAT_ROW_SX };

/** The level switch under the rows. */
const CONTROLS_SX: SxProps<Theme> = { flex: "none", mt: 1.25 };

/** Props for EnemyStatsPanel. */
interface EnemyStatsPanelProps {
	/** Every level of the selected variant, level 0 first. */
	levels: EnemyLevel[];
	/** The index of the level on screen, already within `levels`. */
	level: number;
	/** Called with a level's index when its button is picked. */
	onLevelChange: (level: number) => void;
}

/**
 * The ungraded rows under the graded ones.
 *
 * @param level The level on screen.
 * @returns Weight, life point cost, range and immunities as label and value pairs. Range is left out when the enemy has none.
 */
function plainRows({ stats, immunities }: EnemyLevel): Array<[string, string]> {
	return [
		["Weight", String(stats.weight)],
		["Life points", String(stats.lifePoints)],
		...(stats.range === null ? [] : [["Range", `${stats.range} tiles`] as [string, string]]),
		["Immune to", immunities.length > 0 ? immunities.join(", ") : "None"]
	];
}

/**
 * The enemy page's stats card: each stat beside the handbook's letter grade, then the plain stats and immunities, and a level switch when the
 * variant has more than one level. Higher levels are what harder stages field.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function EnemyStatsPanel({ levels, level, onLevelChange }: EnemyStatsPanelProps) {
	const current = levels[level];

	const handleLevelChange = (_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			onLevelChange(value);
		}
	};

	if (!current) {
		return null;
	}
	const { stats, grades } = current;

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
				Stats
			</Typography>
			<Box sx={{ flex: "none" }}>
				{GRADED_ROWS.map((row) => {
					const grade = grades[row.key];
					const value = stats[row.key];
					return (
						<Box key={row.key} sx={ROW_SX}>
							<Typography variant="body2" color="text.secondary" noWrap>
								{row.label}
							</Typography>
							<RankBar value={GRADE_SCALE.indexOf(grade) + 1} max={GRADE_SCALE.length} label={`${row.label} grade ${grade}`} />
							<Typography variant="body2" sx={{ fontWeight: 600 }}>
								{grade}
							</Typography>
							<Typography variant="body2" sx={{ textAlign: "right" }}>
								{row.format ? row.format(value) : value}
							</Typography>
						</Box>
					);
				})}
				{plainRows(current).map(([label, value]) => (
					<Box key={label} sx={PLAIN_ROW_SX}>
						<Typography variant="body2" color="text.secondary">
							{label}
						</Typography>
						<Typography variant="body2" sx={{ textAlign: "right" }}>
							{value}
						</Typography>
					</Box>
				))}
			</Box>
			{levels.length > 1 ? (
				<Box sx={CONTROLS_SX}>
					<ToggleButtonGroup value={level} exclusive size="small" onChange={handleLevelChange} aria-label="Enemy level">
						{levels.map((_entry, index) => (
							<ToggleButton key={index} value={index}>
								{`Lv ${index}`}
							</ToggleButton>
						))}
					</ToggleButtonGroup>
				</Box>
			) : null}
		</Paper>
	);
}
