import { memo, useMemo } from "react";

import { Box, Card, CardActionArea, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { ART_TOP_ANCHOR, ArtPlaceholder, CARD_ASPECT, HighlightedName, cardArtSx, findNameMatch } from "archive-kit";

import { hasPortrait, portraitUrl } from "../../lib/assets.js";
import type { Operator } from "../../types/operator.js";

/** The portrait at the card art's shape, anchored to the top so a portrait that is not exactly 1:2 keeps its face rather than its feet. */
const PORTRAIT_SX: SxProps<Theme> = { ...cardArtSx, objectPosition: ART_TOP_ANCHOR };

/** Props for OperatorCard. */
interface OperatorCardProps {
	/** The operator to show. */
	operator: Operator;
	/** The current name search, so the matching run can be highlighted. Empty when nothing is typed. */
	query: string;
}

/**
 * One operator in the index grid: portrait, name, archetype and rarity.
 *
 * Arknights portraits are 180x360, which is the kit's `CARD_ASPECT` exactly, so the art primitives need no reshaping. 21 of the 412 operators
 * have no portrait upstream and render the placeholder permanently.
 *
 * Memoised because the index draws every match at once. Both props are stable across a re-render the card has no part in - the operator object
 * comes straight out of the loaded array and the query is a string - so changing the sort or a filter re-renders only the cards that changed.
 *
 * @param props Component props.
 * @returns The card.
 */
export default memo(function OperatorCard({ operator, query }: OperatorCardProps) {
	const match = useMemo(() => findNameMatch(operator.name, query), [operator.name, query]);

	const rarityColour = `rarity.${operator.rarity}`;
	return (
		<Card sx={{ position: "relative", overflow: "hidden" }}>
			<CardActionArea component={Link} to={`/operator/${operator.id}`}>
				{hasPortrait(operator.id) ? (
					<Box component="img" src={portraitUrl(operator.id)} alt={operator.name} loading="lazy" sx={PORTRAIT_SX} />
				) : (
					<ArtPlaceholder name={operator.name} aspect={CARD_ASPECT} />
				)}
				<Box sx={{ p: 1 }}>
					<Typography variant="subtitle2" noWrap>
						<HighlightedName name={operator.name} match={match} />
					</Typography>
					<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
						{operator.subProfession}
					</Typography>
					<Typography variant="caption" sx={{ color: rarityColour }}>
						{"★".repeat(operator.rarity)}
					</Typography>
				</Box>
				<Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, bgcolor: rarityColour }} />
			</CardActionArea>
		</Card>
	);
});
