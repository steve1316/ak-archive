import { Box, Chip, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { BADGE_SX, CHIP_SELECTED_SX, CHIP_UNSELECTED_SX, HERO_CHIPS_SX, HERO_NAME_SX, HERO_DEBUT_SX, HERO_RELEASE_SX, HERO_SUBTITLE_SX } from "../../lib/layout.js";
import { ENEMY_LEVEL_COLOURS } from "../../theme.js";
import type { EnemyVariantRef } from "../../types/enemy.js";

/** The coloured dot in the level badge, the same colour as the index card's stripe. */
const LEVEL_DOT_SX = { width: 9, height: 9, borderRadius: "50%", flex: "none" } satisfies SxProps<Theme>;

/** Props for EnemyIdentityBlock. */
interface EnemyIdentityBlockProps {
	/** The selected variant's name. */
	name: string;
	/** The selected variant's handbook index, such as `B2`. */
	index: string;
	/** The selected variant's level: `Normal`, `Elite` or `Leader`. */
	level: string;
	/** The selected variant's races, shown beside the name. */
	races: string[];
	/** The selected variant's Global release day, or null when unknown. */
	releaseDate: string | null;
	/** Where the selected variant first appeared, or null when unknown. */
	debut: string | null;
	/** Every variant in the group, head first. */
	variants: EnemyVariantRef[];
	/** The selected variant's id. */
	variantId: string;
	/** Called with a variant's id when its chip is picked. */
	onVariantChange: (id: string) => void;
}

/**
 * Level badge, name with races, then the variant chips - the same order and styles as the operator page's identity block. The chip row is
 * left out when the group has only one variant.
 *
 * @param props Component props.
 * @returns The block.
 */
export default function EnemyIdentityBlock({ name, index, level, races, releaseDate, debut, variants, variantId, onVariantChange }: EnemyIdentityBlockProps) {
	return (
		<Box sx={{ minWidth: 0 }}>
			<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
				<Box sx={BADGE_SX}>
					<Box sx={{ ...LEVEL_DOT_SX, bgcolor: ENEMY_LEVEL_COLOURS[level] }} />
					{level}
				</Box>
				<Typography variant="body1" color="text.secondary">
					{index}
				</Typography>
			</Stack>
			<Typography variant="h3" component="h1" sx={HERO_NAME_SX}>
				{name}{" "}
				{races.length > 0 ? (
					<Box component="span" sx={HERO_SUBTITLE_SX}>
						{races.join(", ")}
					</Box>
				) : null}
			</Typography>
			<Box component="p" sx={HERO_RELEASE_SX}>{`Global release: ${releaseDate ?? "Unknown"}`}</Box>
			{debut ? <Box component="p" sx={HERO_DEBUT_SX}>{`First appeared: ${debut}`}</Box> : null}
			{variants.length > 1 ? (
				<Stack direction="row" useFlexGap sx={HERO_CHIPS_SX} role="group" aria-label="Variants">
					{variants.map((variant) => {
						const selected = variant.id === variantId;
						return (
							<Chip
								key={variant.id}
								label={variant.name}
								size="small"
								clickable
								aria-pressed={selected}
								onClick={() => onVariantChange(variant.id)}
								sx={selected ? CHIP_SELECTED_SX : CHIP_UNSELECTED_SX}
							/>
						);
					})}
				</Stack>
			) : null}
		</Box>
	);
}
