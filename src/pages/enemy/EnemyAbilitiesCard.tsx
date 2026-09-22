import { Box, Paper, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { SECTION_HEADING_SX, SECTION_SX } from "../../lib/layout.js";
import type { EnemyAbilityLine } from "../../types/enemy.js";

/** A stance heading, such as Patriot's "Marching Stance". */
const TITLE_SX: SxProps<Theme> = { fontWeight: 700, fontSize: 14.5 };

/** Space between one group and the next. */
const GROUP_GAP = 1.5;

/** The bulleted lines under a heading. */
const LIST_SX: SxProps<Theme> = { m: 0, mt: 0.5, pl: 2.5, fontSize: 14, lineHeight: 1.55 };

/** A dimmed note, which the game prints in grey. */
const NOTE_SX: SxProps<Theme> = { color: "text.secondary" };

/** One heading and the lines under it. The first group has no heading when the list does not open with one. */
interface AbilityGroup {
	/** The heading's text, or null for the lines before the first heading. */
	title: string | null;
	/** The lines under it. */
	lines: EnemyAbilityLine[];
}

/** Props for EnemyAbilitiesCard. */
interface EnemyAbilitiesCardProps {
	/** The selected variant's ability list. */
	abilities: EnemyAbilityLine[];
}

/**
 * Split the flat ability list into groups at each heading.
 *
 * @param abilities The ability list, in order.
 * @returns The groups, in order. Empty groups are dropped.
 */
function groupAbilities(abilities: EnemyAbilityLine[]): AbilityGroup[] {
	const groups: AbilityGroup[] = [{ title: null, lines: [] }];
	for (const line of abilities) {
		if (line.format === "title") {
			groups.push({ title: line.text, lines: [] });
		} else {
			groups[groups.length - 1]?.lines.push(line);
		}
	}
	return groups.filter((group) => group.title !== null || group.lines.length > 0);
}

/**
 * The enemy page's Abilities card: the handbook's ability list, with each stance heading over its own bullets.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function EnemyAbilitiesCard({ abilities }: EnemyAbilitiesCardProps) {
	const groups = groupAbilities(abilities);
	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
				Abilities
			</Typography>
			{groups.length === 0 ? (
				<Typography variant="body2" color="text.secondary">
					No special abilities.
				</Typography>
			) : (
				groups.map((group, index) => (
					<Box key={index} sx={{ mt: index > 0 ? GROUP_GAP : 0 }}>
						{group.title ? (
							<Typography component="h3" sx={TITLE_SX}>
								{group.title}
							</Typography>
						) : null}
						{group.lines.length > 0 ? (
							<Box component="ul" sx={LIST_SX}>
								{group.lines.map((line, lineIndex) => (
									<Box component="li" key={lineIndex} sx={line.format === "note" ? NOTE_SX : undefined}>
										{line.text}
									</Box>
								))}
							</Box>
						) : null}
					</Box>
				))
			)}
		</Paper>
	);
}
