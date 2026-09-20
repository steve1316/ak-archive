import { Typography } from "@mui/material";
import type { SxProps, Theme, TypographyProps } from "@mui/material";

/** Props for RarityStars. */
interface RarityStarsProps {
	/** Star count, 1 to 6. It decides both how many stars are drawn and which rarity colour they take. */
	rarity: number;
	/** The size to draw at, such as `caption` on a card or `h6` in the page hero. */
	variant: TypographyProps["variant"];
	/** Styles laid over the run, such as the hero's tighter line height. */
	sx?: SxProps<Theme>;
}

/**
 * An operator's rarity, drawn as a run of stars.
 *
 * Always a `<p>`, never a heading. The hero used to draw the stars as an `h6` directly under the page's `h1`, which is both a skipped heading
 * level and a heading that a screen reader announces as a string of star characters. `role="img"` with a label is what replaces those characters
 * with "6 stars".
 *
 * @param props Component props.
 * @returns The star run.
 */
export default function RarityStars({ rarity, variant, sx }: RarityStarsProps) {
	return (
		<Typography variant={variant} component="p" role="img" aria-label={`${rarity} ${rarity === 1 ? "star" : "stars"}`} sx={[{ color: `rarity.${rarity}` }, ...(Array.isArray(sx) ? sx : [sx])]}>
			{"★".repeat(rarity)}
		</Typography>
	);
}
