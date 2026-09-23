import { useCallback, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";

import { Box, Paper, Tab, Tabs, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { eliteIconUrl, potentialIconUrl } from "../../lib/icons.js";
import { baseCandidate, candidateFor, changedValueSegments } from "../../lib/talents.js";
import type { Controls, OperatorFull, Talent } from "../../types/operator.js";
import { GROUP_HEADING_SX, RAISED_TILE_SX, SECTION_SX, TAB_STRIP_SX } from "../../lib/layout.js";
import ModulesPanel from "./ModulesPanel.js";
import SkillsPanel from "./SkillsPanel.js";

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
const TILE_SX: SxProps<Theme> = { ...RAISED_TILE_SX, p: 1.25, mb: TILES_GAP, breakInside: "avoid" };

/** A tile's title row. */
const TILE_TITLE_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1, fontWeight: 600, fontSize: 14.5 };

/** A talent's elite badge: the phase its first version unlocks at. The game has no talent icons, so this is the mark it carries. */
const ELITE_BADGE_SX: SxProps<Theme> = { height: 24, width: "auto", flex: "none" };

/** A tile's body text. */
const BODY_SX: SxProps<Theme> = { mt: 0.875, fontSize: 13.5, lineHeight: 1.55 };

/** A value the controls changed. */
const CHANGED_SX: SxProps<Theme> = { color: "primary.main", fontWeight: 600 };

/** The note naming the module stage that changed a talent, pushed to the tile's right edge. */
const MODULE_NOTE_SX: SxProps<Theme> = { ml: "auto", fontSize: 11.5, fontWeight: 600, color: "primary.main", whiteSpace: "nowrap" };

/** Talent name style when its candidate is unlocked. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700 };

/** Talent name style when every candidate is still locked - dimmed so the entry still reads as present but unavailable. */
const LOCKED_NAME_SX: SxProps<Theme> = { fontWeight: 700, color: "text.disabled" };

/** The tab strip: compact, scrolling sideways on a narrow screen rather than wrapping. */
const TABS_SX: SxProps<Theme> = {
	...TAB_STRIP_SX,
	flex: "none",
	minHeight: 40,
	mb: 1.5,
	"& .MuiTab-root": { ...TAB_STRIP_SX["& .MuiTab-root"], minHeight: 40, py: 1 }
};

/** The Potentials heading, set apart from the talent tiles above it. */
const POTENTIALS_HEADING_SX: SxProps<Theme> = { ...GROUP_HEADING_SX, mt: 1.75 };

/** The potentials strip: one small tile per rank, five across from `md` up, wrapping on a narrower card. */
const POTENTIAL_STRIP_SX: SxProps<Theme> = { display: "grid", gap: 1, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", md: "repeat(5, minmax(0, 1fr))" } };

/** One potential tile: its rank, its icon, then what it does, centred. */
const POTENTIAL_TILE_SX: SxProps<Theme> = { ...RAISED_TILE_SX, p: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75, textAlign: "center" };

/** The potential tile's rank label, such as `P2`. */
const POTENTIAL_RANK_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 700, color: "text.secondary", lineHeight: 1 };

/** The potential tile's description. */
const POTENTIAL_TEXT_SX: SxProps<Theme> = { fontSize: 13, lineHeight: 1.4 };

/** The potential icon. */
const POTENTIAL_ICON_SX: SxProps<Theme> = { width: 30, height: 30, flex: "none" };

/** Which tab of the Abilities card is open. */
type AbilityTab = "skills" | "talents" | "modules";

/**
 * One talent resolved for display at the page's current controls: either its unlocked candidate - with the base candidate's description kept
 * alongside for highlighting - or its locked name and unlock condition. Either way it carries `unlockPhase`, the elite phase its first version
 *unlocks at, since that is what the talent's badge shows regardless of which candidate is on screen. An unlocked talent also carries the
 * module note of the candidate on screen, which is null unless a module's version won.
 */
type ResolvedTalent =
	| { key: number; locked: false; name: string; description: string; baseline: string | null; unlockPhase: number; moduleNote: string | null }
	| { key: number; locked: true; name: string; unlockText: string; unlockPhase: number };

/** Props for AbilitiesCard. */
interface AbilitiesCardProps {
	/** The loaded operator. */
	operator: OperatorFull;
	/** The page's controls, which pick each talent's candidate. */
	controls: Controls;
	/** Every talent to show, from the page's module effect. */
	talents: Talent[];
	/** Called when a module is picked in the Modules tab. */
	onChange: (patch: Partial<Controls>) => void;
}

/**
 * Resolves every one of an operator's talents against the current phase, level and potential.
 *
 * An unlocked talent carries the name and description of its winning candidate, plus the base candidate's description as `baseline` so the
 * card can highlight what changed. A talent with no unlocked candidate still shows its base name and the unlock condition, rather than
 * disappearing, so a reader at a low elite phase can see what is still ahead. A talent with no candidates at all - which `baseCandidate`
 * reports as null - contributes nothing, since there is no name to show either way.
 *
 * @param talents The talents to resolve, with any module changes already merged in.
 * @param phase The 0-based elite phase on screen.
 * @param level The level on screen.
 * @param potential The 1-based potential rank on screen.
 * @returns One resolved entry per talent that has at least one candidate.
 */
function resolveTalents(talents: Talent[], phase: number, level: number, potential: number): ResolvedTalent[] {
	const resolved: ResolvedTalent[] = [];
	talents.forEach((talent, index) => {
		const base = baseCandidate(talent);
		const candidate = candidateFor(talent, phase, level, potential);
		if (candidate) {
			resolved.push({
				key: index,
				locked: false,
				name: candidate.name,
				description: candidate.description,
				baseline: base?.description ?? null,
				unlockPhase: base?.unlockPhase ?? 0,
				moduleNote: candidate.moduleNote ?? null
			});
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
 * The operator page's Abilities card: a Skills tab, then one tab with the talents over a strip of potentials, then a Modules tab for operators
 * that have modules. A talent a module changed carries a note naming the module stage. A talent value is highlighted when
 * it differs from the talent's base candidate, and a parenthesised potential delta - such as `(+2%)` in `ATK +7% (+2%)` - is always highlighted,
 * since it is upstream's own mark for what the current potential adds.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function AbilitiesCard({ operator, controls, talents, onChange }: AbilitiesCardProps) {
	const { phase, level, potential } = controls;

	const resolved = useMemo(() => resolveTalents(talents, phase, level, potential), [talents, phase, level, potential]);
	const tabs = useMemo(() => {
		const list: { key: AbilityTab; label: string }[] = [];
		if (operator.skills.length > 0) {
			list.push({ key: "skills", label: "Skills" });
		}
		list.push({ key: "talents", label: operator.potentials.length > 0 ? "Talents & Potentials" : "Talents" });
		if (operator.modules.length > 0) {
			list.push({ key: "modules", label: "Modules" });
		}
		return list;
	}, [operator]);
	const [tab, setTab] = useState<AbilityTab>("skills");
	// A tab the new operator lacks falls back to the first, without an effect or a frame of the wrong tab.
	const shown = tabs.some((entry) => entry.key === tab) ? tab : (tabs[0]?.key ?? "talents");
	const handleTab = useCallback((_event: SyntheticEvent, value: AbilityTab) => setTab(value), []);

	const talentTiles = resolved.map((talent) => (
		<Box key={talent.key} sx={TILE_SX}>
			<Box sx={TILE_TITLE_SX}>
				<Box component="img" src={eliteIconUrl(talent.unlockPhase)} alt={`Elite ${talent.unlockPhase}`} title={`Unlocks at Elite ${talent.unlockPhase}`} sx={ELITE_BADGE_SX} />
				<Typography component="h3" sx={talent.locked ? LOCKED_NAME_SX : NAME_SX}>
					{talent.name}
				</Typography>
				{!talent.locked && talent.moduleNote ? (
					<Box component="span" sx={MODULE_NOTE_SX}>
						{talent.moduleNote}
					</Box>
				) : null}
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

	const talentsAndPotentials = (
		<Box>
			{operator.potentials.length > 0 ? (
				<Box component="h3" sx={GROUP_HEADING_SX}>
					Talents
				</Box>
			) : null}
			<Box sx={TILES_SX}>{talentTiles}</Box>
			{operator.potentials.length > 0 ? (
				<>
					<Box component="h3" sx={POTENTIALS_HEADING_SX}>
						Potentials
					</Box>
					<Box sx={POTENTIAL_STRIP_SX}>
						{operator.potentials.map((entry) => (
							<Box key={entry.rank} sx={POTENTIAL_TILE_SX}>
								<Box component="span" sx={POTENTIAL_RANK_SX}>{`P${entry.rank}`}</Box>
								<Box component="img" src={potentialIconUrl(entry.rank)} alt="" sx={POTENTIAL_ICON_SX} />
								<Box sx={POTENTIAL_TEXT_SX}>{entry.description}</Box>
							</Box>
						))}
					</Box>
				</>
			) : null}
		</Box>
	);

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Tabs value={shown} onChange={handleTab} variant="scrollable" allowScrollButtonsMobile aria-label="Abilities" sx={TABS_SX}>
				{tabs.map((entry) => (
					<Tab key={entry.key} value={entry.key} label={entry.label} />
				))}
			</Tabs>
			{shown === "skills" ? <SkillsPanel key={operator.id} skills={operator.skills} phase={controls.phase} traitRangeId={operator.traitRangeId} /> : null}
			{shown === "talents" ? talentsAndPotentials : null}
			{shown === "modules" ? <ModulesPanel key={operator.id} operator={operator} controls={controls} onChange={onChange} /> : null}
		</Paper>
	);
}
