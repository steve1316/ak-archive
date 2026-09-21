import { useCallback, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";

import { Box, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { eliteIconUrl, potentialIconUrl } from "../../lib/icons.js";
import { baseCandidate, candidateFor, changedValueSegments } from "../../lib/talents.js";
import type { BaseSkill, Controls, Operator } from "../../types/operator.js";
import { RAISED_BG, SECTION_SX } from "./layout.js";

/** The gap between tiles, both across columns and from one tile to the next down a column. */
const TILES_GAP = 1.5;

/**
 * The tile container: two independently-balanced CSS columns from `sm` up, one column at `xs`. The browser packs tiles top to bottom into one
 * column before starting the next, which - unlike a CSS grid's row-based placement - never leaves a hole under a short tile beside a tall one.
 * `mb` cancels the trailing copy of `TILE_SX`'s own bottom margin that whichever tile lands last in each column would otherwise leave behind.
 */
const TILES_SX: SxProps<Theme> = { columnCount: { xs: 1, sm: 2 }, columnGap: TILES_GAP, mb: -TILES_GAP };

/**
 * One tile, on the kit's raised surface. `breakInside: "avoid"` keeps a tile's border and background from splitting across the two columns.
 */
const TILE_SX: SxProps<Theme> = {
	border: 1,
	borderColor: "divider",
	borderRadius: 1,
	p: 1.25,
	mb: TILES_GAP,
	breakInside: "avoid",
	backgroundColor: RAISED_BG
};

/** A tile's title row. */
const TILE_TITLE_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1, fontWeight: 600, fontSize: 14.5 };

/** A talent's elite badge: the phase its first version unlocks at. The game has no talent icons, so this is the mark it carries. */
const ELITE_BADGE_SX: SxProps<Theme> = { height: 24, width: "auto", flex: "none" };

/** A tile's body text. */
const BODY_SX: SxProps<Theme> = { mt: 0.875, fontSize: 13.5, lineHeight: 1.55 };

/** A value the controls changed. */
const CHANGED_SX: SxProps<Theme> = { color: "primary.main", fontWeight: 600 };

/** Talent name style when its candidate is unlocked. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700 };

/** Talent name style when every candidate is still locked - dimmed so the entry still reads as present but unavailable. */
const LOCKED_NAME_SX: SxProps<Theme> = { fontWeight: 700, color: "text.disabled" };

/** The tab strip: compact, scrolling sideways on a narrow screen rather than wrapping. */
const TABS_SX: SxProps<Theme> = { flex: "none", minHeight: 40, mb: 1.5, borderBottom: 1, borderColor: "divider", "& .MuiTab-root": { minHeight: 40, py: 1, textTransform: "none", fontWeight: 600 } };

/** One potential row: the rank's icon, then what it does. */
const POTENTIAL_ROW_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1.25, py: 0.75, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } };

/** The potential icon. */
const POTENTIAL_ICON_SX: SxProps<Theme> = { width: 34, height: 34, flex: "none" };

/** Which tab of the Abilities card is open. */
type AbilityTab = "skills" | "talents" | "potentials" | "base";

/**
 * One talent resolved for display at the page's current controls: either its unlocked candidate - with the base candidate's description kept
 * alongside for highlighting - or its locked name and unlock condition. Either way it carries `unlockPhase`, the elite phase its first version
 * unlocks at, since that is what the talent's badge shows regardless of which candidate is on screen.
 */
type ResolvedTalent =
	| { key: number; locked: false; name: string; description: string; baseline: string | null; unlockPhase: number }
	| { key: number; locked: true; name: string; unlockText: string; unlockPhase: number };

/** Props for AbilitiesCard. */
interface AbilitiesCardProps {
	/** The loaded operator. */
	operator: Operator;
	/** The page's controls, which pick each talent's candidate. */
	controls: Controls;
}

/**
 * The room and unlock condition shown under a base skill's name, such as "Trading - Unlocks at E0 Lv1".
 *
 * @param skill The base skill to describe.
 * @returns The formatted room and unlock text.
 */
function baseSkillMeta(skill: BaseSkill): string {
	return `${skill.room} - Unlocks at E${skill.phase} Lv${skill.level}`;
}

/**
 * Resolves every one of an operator's talents against the current phase, level and potential.
 *
 * An unlocked talent carries the name and description of its winning candidate, plus the base candidate's description as `baseline` so the
 * card can highlight what changed. A talent with no unlocked candidate still shows its base name and the unlock condition, rather than
 * disappearing, so a reader at a low elite phase can see what is still ahead. A talent with no candidates at all - which `baseCandidate`
 * reports as null - contributes nothing, since there is no name to show either way.
 *
 * @param operator The operator whose talents are being resolved.
 * @param phase The 0-based elite phase on screen.
 * @param level The level on screen.
 * @param potential The 1-based potential rank on screen.
 * @returns One resolved entry per talent that has at least one candidate.
 */
function resolveTalents(operator: Operator, phase: number, level: number, potential: number): ResolvedTalent[] {
	const resolved: ResolvedTalent[] = [];
	operator.talents.forEach((talent, index) => {
		const base = baseCandidate(talent);
		const candidate = candidateFor(talent, phase, level, potential);
		if (candidate) {
			resolved.push({ key: index, locked: false, name: candidate.name, description: candidate.description, baseline: base?.description ?? null, unlockPhase: base?.unlockPhase ?? 0 });
			return;
		}
		if (!base) {
			return;
		}
		resolved.push({ key: index, locked: true, name: base.name, unlockText: `Unlocks at E${base.unlockPhase} Lv${base.unlockLevel}`, unlockPhase: base.unlockPhase });
	});
	return resolved;
}

/**
 * The operator page's Abilities card: talents, potentials and base skills in their own tabs, with a talent value highlighted when it differs
 * from the talent's base candidate and a parenthesised potential delta - such as `(+2%)` in `ATK +7% (+2%)` - always highlighted, since it is
 * upstream's own mark for what the current potential adds.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function AbilitiesCard({ operator, controls }: AbilitiesCardProps) {
	const { phase, level, potential } = controls;

	const talents = useMemo(() => resolveTalents(operator, phase, level, potential), [operator, phase, level, potential]);
	const tabs = useMemo(() => {
		const list: { key: AbilityTab; label: string }[] = [{ key: "talents", label: "Talents" }];
		if (operator.potentials.length > 0) {
			list.push({ key: "potentials", label: "Potentials" });
		}
		if (operator.baseSkills.length > 0) {
			list.push({ key: "base", label: "Base skills" });
		}
		return list;
	}, [operator]);
	const [tab, setTab] = useState<AbilityTab>("talents");
	// A tab the new operator lacks falls back to the first, without an effect or a frame of the wrong tab.
	const shown = tabs.some((entry) => entry.key === tab) ? tab : (tabs[0]?.key ?? "talents");
	const handleTab = useCallback((_event: SyntheticEvent, value: AbilityTab) => setTab(value), []);

	const talentTiles = talents.map((talent) => (
		<Box key={talent.key} sx={TILE_SX}>
			<Box sx={TILE_TITLE_SX}>
				<Box component="img" src={eliteIconUrl(talent.unlockPhase)} alt={`Elite ${talent.unlockPhase}`} title={`Unlocks at Elite ${talent.unlockPhase}`} sx={ELITE_BADGE_SX} />
				<Typography component="h3" sx={talent.locked ? LOCKED_NAME_SX : NAME_SX}>
					{talent.name}
				</Typography>
			</Box>
			{talent.locked ? (
				<Typography variant="body2" color="text.secondary" sx={BODY_SX}>
					{talent.unlockText}
				</Typography>
			) : (
				<Typography component="p" sx={BODY_SX}>
					{changedValueSegments(talent.description, talent.baseline).map((segment, index) =>
						segment.changed ? (
							<Box key={index} component="span" sx={CHANGED_SX}>
								{segment.text}
							</Box>
						) : (
							segment.text
						)
					)}
				</Typography>
			)}
		</Box>
	));

	const potentialRows = (
		<Box>
			{operator.potentials.map((entry) => (
				<Box key={entry.rank} sx={POTENTIAL_ROW_SX}>
					<Box component="img" src={potentialIconUrl(entry.rank)} alt={`Potential ${entry.rank}`} title={`Potential ${entry.rank}`} sx={POTENTIAL_ICON_SX} />
					<Typography sx={{ fontSize: 14 }}>{entry.description}</Typography>
				</Box>
			))}
		</Box>
	);

	const baseSkillRows = (
		<Stack spacing={0.875} sx={BODY_SX}>
			{operator.baseSkills.map((skill) => (
				<Box key={skill.id}>
					<Typography component="span" sx={{ fontWeight: 700 }}>
						{skill.name}
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
						{baseSkillMeta(skill)}
					</Typography>
				</Box>
			))}
		</Stack>
	);

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Tabs value={shown} onChange={handleTab} variant="scrollable" allowScrollButtonsMobile aria-label="Abilities" sx={TABS_SX}>
				{tabs.map((entry) => (
					<Tab key={entry.key} value={entry.key} label={entry.label} />
				))}
			</Tabs>
			{shown === "talents" ? <Box sx={TILES_SX}>{talentTiles}</Box> : null}
			{shown === "potentials" ? potentialRows : null}
			{shown === "base" ? baseSkillRows : null}
		</Paper>
	);
}
