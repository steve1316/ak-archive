import { useMemo } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { baseCandidate, candidateFor } from "../../lib/talents.js";
import type { Operator } from "../../types/operator.js";
import type { Controls } from "./operator.js";

/** One talent resolved for display at the page's current controls: either its unlocked candidate, or its locked name and unlock condition. */
type ResolvedTalent = { key: number; locked: false; name: string; description: string } | { key: number; locked: true; name: string; unlockText: string };

/** Layout for one talent row: a bottom border between talents, none on the last so the panel does not end on a stray line. */
const TALENT_ROW_SX: SxProps<Theme> = { py: 1.5, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0, pb: 0 } };

/** Talent name style when its candidate is unlocked. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700 };

/** Talent name style when every candidate is still locked - dimmed so the entry still reads as present but unavailable. */
const LOCKED_NAME_SX: SxProps<Theme> = { fontWeight: 700, color: "text.disabled" };

/** Props for TalentsPanel. */
interface TalentsPanelProps {
	/** The operator whose talents the panel shows. */
	operator: Operator;
	/** The page's shared phase, level, trust and potential controls. Trust is not read here, since it does not affect talents. */
	controls: Controls;
}

/**
 * Resolves every one of an operator's talents against the current phase, level and potential.
 *
 * An unlocked talent carries the name and description of its winning candidate. A talent with no unlocked candidate still shows its base
 * name and the unlock condition, rather than disappearing, so a reader at a low elite phase can see what is still ahead. A talent with no
 * candidates at all - which `baseCandidate` reports as null - contributes nothing, since there is no name to show either way.
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
		const candidate = candidateFor(talent, phase, level, potential);
		if (candidate) {
			resolved.push({ key: index, locked: false, name: candidate.name, description: candidate.description });
			return;
		}
		const base = baseCandidate(talent);
		if (!base) {
			return;
		}
		resolved.push({ key: index, locked: true, name: base.name, unlockText: `Unlocks at E${base.unlockPhase} Lv${base.unlockLevel}` });
	});
	return resolved;
}

/**
 * The operator page's talents panel: every talent at the page's shared controls, each either showing its unlocked name and description or,
 * while still locked, its base name greyed out with the elite phase and level that unlocks it.
 *
 * The panel owns no state. It only reads `operator`, `phase`, `level` and `potential` from the shared controls and has no `onChange`, since a
 * reader cannot edit a talent - only the phase, level and potential controls that `StatsPanel` owns can change which candidate shows.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function TalentsPanel({ operator, controls }: TalentsPanelProps) {
	const { phase, level, potential } = controls;

	const talents = useMemo(() => resolveTalents(operator, phase, level, potential), [operator, phase, level, potential]);

	return (
		<Card>
			<CardContent>
				<Typography variant="h6" component="h2" gutterBottom>
					Talents
				</Typography>
				{talents.map((talent) => (
					<Box key={talent.key} sx={TALENT_ROW_SX}>
						<Typography component="h3" variant="subtitle1" sx={talent.locked ? LOCKED_NAME_SX : NAME_SX}>
							{talent.name}
						</Typography>
						{talent.locked ? (
							<Typography variant="body2" color="text.secondary">
								{talent.unlockText}
							</Typography>
						) : (
							<Typography variant="body2">{talent.description}</Typography>
						)}
					</Box>
				))}
			</CardContent>
		</Card>
	);
}
