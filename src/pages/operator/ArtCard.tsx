import { Box, Fab } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { Link } from "react-router-dom";

import { ART_TOP_ANCHOR, ArtPlaceholder, CARD_ASPECT, FAB_EXPAND_SX } from "archive-kit";

import { TIGHT_RADIUS } from "../../lib/layout.js";

/**
 * The card's width. The portrait file is 180x360 and nothing larger exists upstream, so any wider card upscales it. At the target DPR of 1.76
 * even this is painted across 317 device pixels.
 */
const CARD_WIDTH = 180;

/** The card: a fixed column that never stretches with its row. */
const ROOT_SX: SxProps<Theme> = { position: "relative", width: CARD_WIDTH, flexShrink: 0, alignSelf: "start", justifySelf: { xs: "center", md: "start" } };

/** The art inside it, cropped from the top so a face stays in frame when a skin has only a square illustration. */
const IMAGE_SX: SxProps<Theme> = {
	display: "block",
	width: CARD_WIDTH,
	aspectRatio: CARD_ASPECT,
	objectFit: "cover",
	objectPosition: ART_TOP_ANCHOR,
	border: 1,
	borderColor: "divider",
	borderRadius: TIGHT_RADIUS
};

/** Props for ArtCard. */
interface ArtCardProps {
	/** The operator's name, for the image's alt text and the placeholder. */
	name: string;
	/** The selected form's portrait, or null when that form has none published. */
	portrait: string | null;
	/** The selected form's illustration, used cropped when there is no portrait, or null when the operator has no art at all. */
	illustration: string | null;
	/** Where the expand button leads: the art viewer, carrying the selected form. */
	artLink: string;
}

/**
 * The operator page's art card, with the expand control in its bottom-right corner as gfl's doll page has it.
 *
 * Falls back to the form's illustration when the form has no portrait, rather than to a placeholder - 100 skins and the 21 portrait-less
 * operators still have sharp art to show that way.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function ArtCard({ name, portrait, illustration, artLink }: ArtCardProps) {
	const source = portrait ?? illustration;
	return (
		<Box sx={ROOT_SX}>
			{source ? <Box component="img" src={source} alt={name} sx={IMAGE_SX} /> : <ArtPlaceholder name={name} aspect={CARD_ASPECT} sx={{ width: CARD_WIDTH }} />}
			{illustration ? (
				<Fab color="primary" component={Link} to={artLink} sx={FAB_EXPAND_SX} aria-label="View full art">
					<OpenInFullIcon fontSize="small" />
				</Fab>
			) : null}
		</Box>
	);
}
