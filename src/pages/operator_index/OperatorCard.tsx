import { memo, useMemo } from "react";

import { Box, Typography } from "@mui/material";

import { HighlightedName, findNameMatch } from "archive-kit";

import OperatorArtCard from "../../components/OperatorArtCard.js";
import RarityStars from "../../components/RarityStars.js";
import type { Operator } from "../../types/operator.js";

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
