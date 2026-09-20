import { memo } from "react";

import { Box, Typography } from "@mui/material";

import { HighlightedName } from "archive-kit";

import OperatorArtCard from "../../components/OperatorArtCard.js";
import RarityStars from "../../components/RarityStars.js";
import type { Operator } from "../../types/operator.js";

/** Props for OperatorCard. */
interface OperatorCardProps {
	/** The operator to show. */
	operator: Operator;
	/** Where the current name search matched inside the operator's name, from `findNameMatch`, or null when nothing matched or is typed. */
	match: [number, number] | null;
}

/**
 * One operator in the index grid: portrait, name, archetype and rarity.
 *
 * Arknights portraits are 180x360, which is the kit's `CARD_ASPECT` exactly, so the art primitives need no reshaping. 21 of the 412 operators
 * have no portrait upstream and render the placeholder permanently.
 *
 * Memoised because the index draws every match at once. Both props are stable across a re-render the card has no part in - the operator object
 * comes straight out of the loaded array and the match is resolved once by the index's filter pass - so changing the sort or a filter re-renders
 * only the cards that changed.
 *
 * @param props Component props.
 * @returns The card.
 */
export default memo(function OperatorCard({ operator, match }: OperatorCardProps) {
	return (
		<OperatorArtCard id={operator.id} name={operator.name} rarity={operator.rarity} to={`/operator/${operator.id}`} lazy>
			<Box sx={{ p: 1 }}>
				<Typography variant="subtitle2" noWrap>
					<HighlightedName name={operator.name} match={match} />
				</Typography>
				<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
					{operator.subProfession}
				</Typography>
				<RarityStars rarity={operator.rarity} variant="caption" />
			</Box>
		</OperatorArtCard>
	);
});
