import { Box, Button, Card, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { ART_TOP_ANCHOR, ArtPlaceholder, CARD_ASPECT, cardArtSx } from "archive-kit";

import { hasIllustration, hasPortrait, portraitUrl } from "../../lib/assets.js";
import type { Operator } from "../../types/operator.js";

/** The portrait at the card art's shape, anchored to the top so a portrait that is not exactly 1:2 keeps its face rather than its feet. */
const PORTRAIT_SX: SxProps<Theme> = { ...cardArtSx, objectPosition: ART_TOP_ANCHOR };

/** Props for OperatorHero. */
interface OperatorHeroProps {
	/** The operator the hero introduces. */
	operator: Operator;
}

/**
 * The operator page's hero: the portrait, the name, the rarity stars, the class line, the affiliations and the trait.
 *
 * The placeholder-or-portrait choice and the rarity tint match the index card exactly, so the page reads as the same site rather than a
 * bolted-on detail view. No art is published yet, so every portrait renders `ArtPlaceholder` until the A3 asset pipeline lands.
 *
 * @param props Component props.
 * @returns The hero block.
 */
export default function OperatorHero({ operator }: OperatorHeroProps) {
	const rarityColour = `rarity.${operator.rarity}`;
	const affiliations = [operator.nation, operator.group, operator.team].filter((value): value is string => value !== null);

	return (
		<Box>
			<Card sx={{ position: "relative", overflow: "hidden" }}>
				{hasPortrait(operator.id) ? <Box component="img" src={portraitUrl(operator.id)} alt={operator.name} sx={PORTRAIT_SX} /> : <ArtPlaceholder name={operator.name} aspect={CARD_ASPECT} />}
				<Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, bgcolor: rarityColour }} />
			</Card>
			<Box sx={{ mt: 2 }}>
				<Typography variant="h4" component="h1">
					{operator.name}
				</Typography>
				<Typography variant="h6" sx={{ color: rarityColour, lineHeight: 1 }}>
					{"★".repeat(operator.rarity)}
				</Typography>
				<Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
					{operator.profession} / {operator.subProfession} / {operator.position}
				</Typography>
				{affiliations.length > 0 ? (
					<Typography variant="body2" color="text.secondary">
						{affiliations.join(" · ")}
					</Typography>
				) : null}
				{operator.description ? (
					<Typography variant="body2" sx={{ mt: 1.5 }}>
						{operator.description}
					</Typography>
				) : null}
				{hasIllustration(operator.id) ? (
					<Button component={Link} to={`/operator/${operator.id}/art`} variant="outlined" sx={{ mt: 2 }}>
						View full art
					</Button>
				) : null}
			</Box>
		</Box>
	);
}
