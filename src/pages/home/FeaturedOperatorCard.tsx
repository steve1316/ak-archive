import { memo } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import OperatorArtCard from "../../components/OperatorArtCard.js";
import RarityStars from "../../components/RarityStars.js";
import type { SearchEntry } from "../../types/operator.js";

/** Fixed card width at each breakpoint, so the carousel row scrolls at a steady card size instead of reflowing like a grid. */
const CARD_SX: SxProps<Theme> = { width: { xs: 132, sm: 152 }, flexShrink: 0, scrollSnapAlign: "start" };

/** Props for FeaturedOperatorCard. */
interface FeaturedOperatorCardProps {
	/** The search index entry to show. Carries only id, name, rarity and class, which is all the home page's carousel ever loads. */
	entry: SearchEntry;
}

/**
 * One operator in the home page's featured carousel: portrait, name and rarity, at a fixed width so the row scrolls evenly.
 *
 * Reads only a `SearchEntry`, the same 31 KB index the navbar search already has, so the carousel never pulls in a class shard just to show a
 * handful of highlights.
 *
 * @param props Component props.
 * @returns The card.
 */
export default memo(function FeaturedOperatorCard({ entry }: FeaturedOperatorCardProps) {
	return (
		<OperatorArtCard id={entry.id} name={entry.name} rarity={entry.rarity} to={`/operator/${entry.id}`} lazy sx={CARD_SX}>
			<Box sx={{ p: 1 }}>
				<Typography variant="subtitle2" noWrap>
					{entry.name}
				</Typography>
				<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
					{entry.profession}
				</Typography>
				<RarityStars rarity={entry.rarity} variant="caption" />
			</Box>
		</OperatorArtCard>
	);
});
