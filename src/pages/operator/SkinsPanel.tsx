import { Box, Card, CardContent, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { ArtPlaceholder, CARD_ASPECT } from "archive-kit";

import { hasIllustration, illustrationUrl } from "../../lib/assets.js";
import type { Operator } from "../../types/operator.js";

/** The maximum width of the illustration preview, in pixels. Kept small since this panel is a preview, not the full art viewer. */
const PREVIEW_MAX_WIDTH = 200;

/** The illustration image at the card art's 1:2 shape, capped to `PREVIEW_MAX_WIDTH` so the panel stays a small preview. */
const IMAGE_SX: SxProps<Theme> = { width: "100%", maxWidth: PREVIEW_MAX_WIDTH, aspectRatio: CARD_ASPECT, objectFit: "cover", display: "block", borderRadius: 1 };

/** Props for SkinsPanel. */
interface SkinsPanelProps {
	/** The operator whose default illustration the panel shows. */
	operator: Operator;
}

/**
 * The operator page's skins panel: the default illustration only.
 *
 * `skin_table.json` is not imported yet, so there is no skin list to show here - it lands with the asset pipeline in a later phase, which
 * will replace this panel's contents. No art is published yet either, so `hasIllustration` returns false for every operator today and the
 * panel always falls back to `ArtPlaceholder`. That is expected, not a bug.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function SkinsPanel({ operator }: SkinsPanelProps) {
	return (
		<Card>
			<CardContent>
				<Typography variant="h6" component="h2" gutterBottom>
					Skins
				</Typography>
				{hasIllustration(operator.id) ? (
					<Box component="img" src={illustrationUrl(operator.id)} alt={operator.name} sx={IMAGE_SX} />
				) : (
					<ArtPlaceholder name={operator.name} aspect={CARD_ASPECT} sx={{ maxWidth: PREVIEW_MAX_WIDTH }} />
				)}
				<Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
					More skins and art arrive with the asset pipeline.
				</Typography>
			</CardContent>
		</Card>
	);
}
