import type { ReactNode } from "react";

import { Box, Card, CardActionArea } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { ART_TOP_ANCHOR, ArtPlaceholder, CARD_ASPECT, cardArtSx } from "archive-kit";

import { hasPortrait, portraitUrl } from "../lib/assets.js";

/** The portrait at the card art's shape, anchored to the top so a portrait that is not exactly 1:2 keeps its face rather than its feet. */
const PORTRAIT_SX: SxProps<Theme> = { ...cardArtSx, objectPosition: ART_TOP_ANCHOR };

/** Props for OperatorArtCard. */
interface OperatorArtCardProps {
	/** Upstream operator id. Both the portrait's URL and the check for whether one is hosted are built from it. */
	id: string;
	/** Display name, used as the portrait's alt text and as the placeholder's label. */
	name: string;
	/** Star count, 1 to 6, which picks the stripe's colour out of the theme's rarity palette. */
	rarity: number;
	/** Route the card opens, or undefined for a card that is not a link, which is how the page hero shows its own portrait. */
	to?: string;
	/** Whether the portrait waits until it is scrolled near. On for the index grid and the carousel, off for the single portrait on a page. */
	lazy?: boolean;
	/** Styles laid over the card, such as the carousel's fixed width. */
	sx?: SxProps<Theme>;
	/** What sits under the art inside the card, such as the index card's name and archetype. The hero passes nothing and shows art alone. */
	children?: ReactNode;
}

/**
 * An operator's portrait as a card, with the rarity stripe along its bottom edge.
 *
 * The index grid, the home carousel and the operator page hero all draw the same thing here: the same portrait-or-placeholder choice, the same
 * top anchor and the same tinted stripe. It lives in the app rather than in the kit because both halves of it are Arknights' own - the
 * manifest-backed `hasPortrait` check and the `rarity.<n>` palette key. No art is published yet, so every card renders `ArtPlaceholder` until
 * the asset pipeline lands.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function OperatorArtCard({ id, name, rarity, to, lazy, sx, children }: OperatorArtCardProps) {
	const art = hasPortrait(id) ? <Box component="img" src={portraitUrl(id)} alt={name} loading={lazy ? "lazy" : undefined} sx={PORTRAIT_SX} /> : <ArtPlaceholder name={name} aspect={CARD_ASPECT} />;

	const contents = (
		<>
			{art}
			{children}
		</>
	);

	return (
		<Card sx={[{ position: "relative", overflow: "hidden" }, ...(Array.isArray(sx) ? sx : [sx])]}>
			{to === undefined ? (
				contents
			) : (
				<CardActionArea component={Link} to={to}>
					{contents}
				</CardActionArea>
			)}
			<Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, bgcolor: `rarity.${rarity}` }} />
		</Card>
	);
}
