import { Box, Card, CardContent, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import type { BaseSkill, LoreSection } from "../../types/operator.js";

/** Layout for one lore section or base skill row: a bottom border between entries, none on the last so the list does not end on a stray line. */
const ENTRY_SX: SxProps<Theme> = { py: 1.5, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0, pb: 0 } };

/** Handbook body text, rendered `pre-line` so a section's own line breaks are kept. */
const BODY_SX: SxProps<Theme> = { whiteSpace: "pre-line" };

/** Props for LorePanel. */
interface LorePanelProps {
	/** The handbook's prose sections, with the record already parsed out by the importer. */
	lore: LoreSection[];
	/** The operator's base skills. Leaves this panel for the Abilities card in Task 8. */
	baseSkills: BaseSkill[];
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
 * The operator page's lore panel: handbook sections such as Profile and Archive File, followed by RIIC base skills. The record - Basic Info
 * and Physical Exam - no longer lives here: the page loads the profile at mount and renders that half in `RecordBlock` above the fold instead.
 *
 * Two operators - Amiya's Guard and Medic alternate forms - live in the patch table rather than the main character table and carry an empty
 * profile on both sides, no lore and no base skills. Rather than a bare "Handbook" heading with nothing under it, or the whole card vanishing
 * from the page, that case shows one explanatory line instead, so a reader who scrolls down sees why the section is short rather than
 * wondering if the page is broken.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function LorePanel({ lore, baseSkills }: LorePanelProps) {
	const isEmpty = lore.length === 0 && baseSkills.length === 0;

	return (
		<Card>
			<CardContent>
				<Typography variant="h6" component="h2" gutterBottom>
					Handbook
				</Typography>
				{isEmpty ? (
					<Typography variant="body2" color="text.secondary">
						No handbook entry for this form.
					</Typography>
				) : (
					<>
						{lore.length > 0 ? (
							<Box>
								{lore.map((section, index) => (
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
						{baseSkills.length > 0 ? (
							<Box sx={{ mt: lore.length > 0 ? 2 : 0 }}>
								<Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
									Base Skills
								</Typography>
								<Box>
									{baseSkills.map((skill) => (
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
