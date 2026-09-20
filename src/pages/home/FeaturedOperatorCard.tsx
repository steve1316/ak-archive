import { memo } from "react";

import { Box, Card, CardActionArea, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { ART_TOP_ANCHOR, ArtPlaceholder, CARD_ASPECT, cardArtSx } from "archive-kit";

import { hasPortrait, portraitUrl } from "../../lib/assets.js";
import type { SearchEntry } from "../../types/operator.js";

/** The portrait at the card art's shape, anchored to the top so a portrait that is not exactly 1:2 keeps its face rather than its feet. */
const PORTRAIT_SX: SxProps<Theme> = { ...cardArtSx, objectPosition: ART_TOP_ANCHOR };

/** Fixed card width at each breakpoint, so the carousel row scrolls at a steady card size instead of reflowing like a grid. */
const CARD_WIDTH: SxProps<Theme> = { width: { xs: 132, sm: 152 } };

/** Props for FeaturedOperatorCard. */
interface FeaturedOperatorCardProps {
	/** The search index entry to show. Carries only id, name, rarity and class, which is all the home page's carousel ever loads. */
	entry: SearchEntry;
}

/**
 * One operator in the home page's featured carousel: portrait, name and rarity, at a fixed width so the row scrolls evenly.
 *
 * Reads only a `SearchEntry`, the same 31 KB index the navbar search already has, so the carousel never pulls in a class shard just to show a
 * handful of highlights. The placeholder and rarity tint match the index card exactly, so the strip reads as the same site rather than a
 * bolted-on extra. No art is published yet, so every card renders `ArtPlaceholder` until the asset pipeline lands.
 *
 * @param props Component props.
 * @returns The card.
 */
export default memo(function FeaturedOperatorCard({ entry }: FeaturedOperatorCardProps) {
	const rarityColour = `rarity.${entry.rarity}`;
	return (
		<Card sx={{ ...CARD_WIDTH, flexShrink: 0, position: "relative", overflow: "hidden", scrollSnapAlign: "start" }}>
			<CardActionArea component={Link} to={`/operator/${entry.id}`}>
				{hasPortrait(entry.id) ? (
					<Box component="img" src={portraitUrl(entry.id)} alt={entry.name} loading="lazy" sx={PORTRAIT_SX} />
				) : (
					<ArtPlaceholder name={entry.name} aspect={CARD_ASPECT} />
				)}
				<Box sx={{ p: 1 }}>
					<Typography variant="subtitle2" noWrap>
						{entry.name}
					</Typography>
					<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
						{entry.profession}
					</Typography>
					<Typography variant="caption" sx={{ color: rarityColour }}>
						{"★".repeat(entry.rarity)}
					</Typography>
				</Box>
				<Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, bgcolor: rarityColour }} />
			</CardActionArea>
		</Card>
	);
});
