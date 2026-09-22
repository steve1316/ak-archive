import { useCallback, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Box, Divider, FormControl, InputLabel, MenuItem, Select, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SelectChangeEvent, SxProps, Theme } from "@mui/material";

import RangeGrid from "../../components/RangeGrid.js";
import { skillIconUrl } from "../../lib/icons.js";
import type { OperatorSkill, SkillLevel, SkillRun } from "../../types/operator.js";
import { RAISED_TILE_SX, TIGHT_RADIUS } from "../../lib/layout.js";

/**
 * Opens the level menu to the right of its field, as gfl's skills panel does.
 * A module constant, so the Select is not handed a new object each render.
 */
const LEVEL_MENU_PROPS = {
	anchorOrigin: { vertical: "top", horizontal: "right" },
	transformOrigin: { vertical: "top", horizontal: "left" }
} as const;

/** The trigger badge's words. */
const TRIGGER_LABEL: Record<SkillLevel["trigger"], string> = { auto: "Auto trigger", manual: "Manual trigger", passive: "Passive" };

/** The recovery badge's words. */
const RECOVERY_LABEL: Record<NonNullable<SkillLevel["recovery"]>, string> = { auto: "Auto recovery", offensive: "Offensive recovery", defensive: "Defensive recovery" };

/** The skill switcher, full width with equal buttons. */
const SWITCH_SX: SxProps<Theme> = { width: "100%", mb: 1.25, "& .MuiToggleButton-root": { flex: 1, gap: 1, textTransform: "none", fontWeight: 600 } };

/** A skill icon inside the switcher. */
const SWITCH_ICON_SX: SxProps<Theme> = { width: 26, height: 26, borderRadius: TIGHT_RADIUS };

/** The skill card. */
const CARD_SX: SxProps<Theme> = { ...RAISED_TILE_SX, p: 1.5 };

/** The card's header row: icon, name and badges, then the level field at the right. */
const HEAD_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1.5 };

/** The skill icon in the header. */
const HEAD_ICON_SX: SxProps<Theme> = { width: 52, height: 52, flex: "none", borderRadius: TIGHT_RADIUS };

/** A badge under the name. */
const BADGE_SX: SxProps<Theme> = { fontSize: 11, px: 0.75, border: 1, borderColor: "divider", borderRadius: TIGHT_RADIUS, color: "text.secondary" };

/** The SP and duration line. */
const SP_LINE_SX: SxProps<Theme> = { display: "flex", gap: 2.25, color: "text.secondary", fontSize: 13, mb: 1 };

/** A raised value. */
const UP_SX: SxProps<Theme> = { color: "primary.main", fontWeight: 600 };

/** A lowered value. */
const DOWN_SX: SxProps<Theme> = { color: "secondary.main", fontWeight: 600 };

/**
 * The label for a level index, as the game prints it: 1 to 7, then M1 to M3.
 *
 * @param index The 0-based level index.
 * @returns The label.
 */
function levelLabel(index: number): string {
	return index < 7 ? String(index + 1) : `M${index - 6}`;
}

/**
 * The caption for a skill that keeps the operator's normal range, saying how far it stretches or shortens it forward.
 *
 * @param extend The level's `rangeExtend`, or undefined when the skill does not change the range.
 * @returns The caption.
 */
function normalRangeLabel(extend: number | undefined): string {
	if (!extend) {
		return "Uses normal range";
	}
	const tiles = Math.abs(extend) === 1 ? "tile" : "tiles";
	return extend > 0 ? `Normal range, extended ${extend} ${tiles} forward` : `Normal range, ${-extend} ${tiles} shorter`;
}

/**
 * Render a description's runs, colouring raised and lowered values.
 *
 * @param runs The description runs.
 * @returns The nodes to place inside a text block.
 */
function renderRuns(runs: SkillRun[]): ReactNode[] {
	return runs.map((run, index) =>
		run.emphasis === null ? (
			run.text
		) : (
			<Box key={index} component="span" sx={run.emphasis === "up" ? UP_SX : DOWN_SX}>
				{run.text}
			</Box>
		)
	);
}

/** Props for SkillsPanel. */
interface SkillsPanelProps {
	/** The operator's skills, at least one. */
	skills: OperatorSkill[];
	/** The page's elite phase, which decides which skills are still locked. */
	phase: number;
	/** The operator's trait area, shaded inside a skill's range. */
	traitRangeId: string | null;
}

/**
 * The Skills tab, in gfl's shape: a switcher with each skill's icon, then one skill card with a Level drop-down at its top right. The level is
 * shared across the skills and starts at the highest the operator has, as the stats start at max level. A skill the page's elite phase has not
 * reached stays viewable, dimmed in the switcher, with its unlock phase under the name. A skill that replaces the range draws it under the description.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function SkillsPanel({ skills, phase, traitRangeId }: SkillsPanelProps) {
	const levelCount = useMemo(() => Math.max(...skills.map((skill) => skill.levels.length)), [skills]);
	const [selected, setSelected] = useState(0);
	const [level, setLevel] = useState(levelCount - 1);

	const skill = skills[Math.min(selected, skills.length - 1)];
	const shownLevel = skill ? Math.min(level, skill.levels.length - 1) : 0;
	const entry = skill?.levels[shownLevel];

	const handleSkill = useCallback((_event: MouseEvent<HTMLElement>, value: number | null) => {
		if (value !== null) {
			setSelected(value);
		}
	}, []);
	const handleLevel = useCallback((event: SelectChangeEvent<number>) => setLevel(Number(event.target.value)), []);

	if (!skill || !entry) {
		return null;
	}
	const locked = skill.unlockPhase > phase;

	return (
		<Box>
			<ToggleButtonGroup value={Math.min(selected, skills.length - 1)} exclusive size="small" onChange={handleSkill} aria-label="Skill" sx={SWITCH_SX}>
				{skills.map((item, index) => (
					<ToggleButton key={item.id} value={index} sx={item.unlockPhase > phase ? { opacity: 0.45 } : undefined}>
						<Box component="img" src={skillIconUrl(item.icon)} alt="" sx={SWITCH_ICON_SX} />
						{`Skill ${index + 1}`}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			<Box sx={CARD_SX}>
				<Box sx={HEAD_SX}>
					<Box component="img" src={skillIconUrl(skill.icon)} alt={entry.name} sx={HEAD_ICON_SX} />
					<Box sx={{ flex: 1, minWidth: 0 }}>
						<Typography sx={{ fontWeight: 700, fontSize: 16 }}>{entry.name}</Typography>
						<Box sx={{ display: "flex", gap: 0.75, mt: 0.375, flexWrap: "wrap" }}>
							<Box component="span" sx={BADGE_SX}>
								{TRIGGER_LABEL[entry.trigger]}
							</Box>
							{entry.recovery ? (
								<Box component="span" sx={BADGE_SX}>
									{RECOVERY_LABEL[entry.recovery]}
								</Box>
							) : null}
						</Box>
						{locked ? <Typography variant="caption" color="text.secondary">{`Unlocks at E${skill.unlockPhase}`}</Typography> : null}
					</Box>
					<FormControl size="small">
						<InputLabel id="skill-level-label">Level</InputLabel>
						<Select labelId="skill-level-label" label="Level" value={shownLevel} onChange={handleLevel} MenuProps={LEVEL_MENU_PROPS}>
							{skill.levels.map((_item, index) => (
								<MenuItem key={index} value={index}>
									{levelLabel(index)}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				</Box>
				<Divider sx={{ my: 1.25 }} />
				<Box sx={SP_LINE_SX}>
					<span>
						Initial SP <b>{entry.initialSp}</b>
					</span>
					<span>
						SP cost <b>{entry.spCost}</b>
					</span>
					<span>
						Duration <b>{entry.duration > 0 ? `${entry.duration}s` : "—"}</b>
					</span>
				</Box>
				<Typography sx={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-line" }}>{renderRuns(entry.description)}</Typography>
				<Divider sx={{ my: 1.25 }} />
				{entry.rangeId ? (
					<RangeGrid rangeId={entry.rangeId} traitRangeId={traitRangeId} label="Range while active" />
				) : (
					<Typography variant="body2" color="text.secondary">
						{normalRangeLabel(entry.rangeExtend)}
					</Typography>
				)}
			</Box>
		</Box>
	);
}
