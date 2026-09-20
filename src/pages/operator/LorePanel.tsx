import { useCallback, useEffect, useState } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { LoadError } from "archive-kit";

import { loadProfile } from "../../lib/data.js";
import type { BaseSkill, Profile } from "../../types/operator.js";

/** Layout for one lore section or base skill row: a bottom border between entries, none on the last so the list does not end on a stray line. */
const ENTRY_SX: SxProps<Theme> = { py: 1.5, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0, pb: 0 } };

/**
 * Handbook body text, rendered `pre-line` because sections such as Basic Info are newline-separated
 * field lists whose line breaks are content, not filler.
 */
const BODY_SX: SxProps<Theme> = { whiteSpace: "pre-line" };

/** What an operator with no side-file entry reads as. A missing profile is not a failure, so it lands in the same empty branch as an empty one. */
const EMPTY_PROFILE: Profile = { lore: [], baseSkills: [] };

/** Props for LorePanel. */
interface LorePanelProps {
	/** The operator whose handbook to show. The panel fetches the profile side file for it itself. */
	operatorId: string;
}

/**
 * The room and unlock condition shown under a base skill's name, such as "Trading - Unlocks at E0 Lv1".
 *
 * @param skill The base skill to describe.
 * @returns The formatted room and unlock text.
 */
function baseSkillMeta(skill: BaseSkill): string {
	const room = skill.room.charAt(0) + skill.room.slice(1).toLowerCase();
	return `${room} - Unlocks at E${skill.phase} Lv${skill.level}`;
}

/**
 * The operator page's lore panel: handbook sections such as Basic Info and Physical Exam, followed by RIIC base skills.
 *
 * The panel loads the profile side file itself rather than taking it as a prop, because it is the only thing on the page that reads it and it
 * sits inside a `LazySection`. Loading it here is what makes that section defer the bytes and not just the render: the profile file is the
 * heaviest thing the page can pull, and a reader who never scrolls past the stats never pays for it.
 *
 * Two operators - Amiya's Guard and Medic alternate forms - live in the patch table rather than the main character table and carry an empty
 * profile on both sides, no lore and no base skills. Rather than a bare "Handbook" heading with nothing under it, or the whole card vanishing
 * from the page, that case shows one explanatory line instead, so a reader who scrolls down sees why the section is short rather than
 * wondering if the page is broken.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function LorePanel({ operatorId }: LorePanelProps) {
	// Null until the side file has arrived, which is what tells the loading line apart from an operator whose handbook is genuinely empty.
	const [profile, setProfile] = useState<Profile | null>(null);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let active = true;
		setProfile(null);
		setError(false);
		loadProfile(operatorId).then(
			(loaded) => {
				if (active) {
					setProfile(loaded ?? EMPTY_PROFILE);
				}
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
	}, [operatorId, attempt]);

	const isEmpty = profile !== null && profile.lore.length === 0 && profile.baseSkills.length === 0;

	const handleRetry = useCallback(() => setAttempt((current) => current + 1), []);

	return (
		<Card>
			<CardContent>
				<Typography variant="h6" component="h2" gutterBottom>
					Handbook
				</Typography>
				{error ? (
					<LoadError what="this operator's handbook" onRetry={handleRetry} />
				) : profile === null ? (
					<Typography variant="body2" color="text.secondary" role="status">
						Loading...
					</Typography>
				) : isEmpty ? (
					<Typography variant="body2" color="text.secondary">
						No handbook entry for this form.
					</Typography>
				) : (
					<>
						{profile.lore.length > 0 ? (
							<Box>
								{profile.lore.map((section, index) => (
									<Box key={`${index}-${section.title}`} sx={ENTRY_SX}>
										<Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
											{section.title}
										</Typography>
										<Typography variant="body2" sx={BODY_SX}>
											{section.text}
										</Typography>
									</Box>
								))}
							</Box>
						) : null}
						{profile.baseSkills.length > 0 ? (
							<Box sx={{ mt: profile.lore.length > 0 ? 2 : 0 }}>
								<Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
									Base Skills
								</Typography>
								<Box>
									{profile.baseSkills.map((skill) => (
										<Box key={skill.id} sx={ENTRY_SX}>
											<Typography component="h4" variant="subtitle2" sx={{ fontWeight: 700 }}>
												{skill.name}
											</Typography>
											<Typography variant="caption" color="text.secondary">
												{baseSkillMeta(skill)}
											</Typography>
											<Typography variant="body2">{skill.description}</Typography>
										</Box>
									))}
								</Box>
							</Box>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
