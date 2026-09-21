import { useCallback, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { classIconUrl } from "../../lib/assets.js";
import { SECTION_HEADING_GAP, SECTION_HEADING_SX, SECTION_SX, TIGHT_RADIUS } from "./layout.js";

/** Which of an operator's two chibi rigs is on the stage. Named after upstream's own split: `build_<id>` is battle, `<id>/Back` is dorm. */
export type RigKind = "battle" | "dorm";

/**
 * The stage. Takes every pixel the card has left, which is what lets row 1's slack land here instead of in an empty box. The tight radius
 * matches the art card beside it in row 1.
 */
const STAGE_SX: SxProps<Theme> = {
	position: "relative",
	flex: 1,
	minHeight: 240,
	border: 1,
	borderColor: "divider",
	borderRadius: TIGHT_RADIUS,
	overflow: "hidden",
	display: "grid",
	placeItems: "center"
};

/** The Battle/Dorm switch. */
const KIND_SX: SxProps<Theme> = { flex: "none", mb: SECTION_HEADING_GAP };

/** The interaction hint under the stage. */
const CAPTION_SX: SxProps<Theme> = { flex: "none", mt: 0.875, textAlign: "center" };

/** The placeholder's class icon, greyed so it reads as absent rather than as content. */
const PLACEHOLDER_ICON_SX: SxProps<Theme> = { width: 70, display: "block", mx: "auto", mb: 1.125, opacity: 0.45, filter: "grayscale(1)" };

/** Props for AnimationsCard. */
interface AnimationsCardProps {
	/** Whether the stage responds to clicks, wheel and drags. The caption describing them is only shown when it does. */
	interactive: boolean;
	/** Draws the stage for the selected rig kind. */
	renderStage: (kind: RigKind) => ReactNode;
}

/** Props for StagePlaceholder. */
interface StagePlaceholderProps {
	/** The operator's class, whose icon stands in for the chibi. */
	profession: string;
}

/**
 * What the stage shows until the operator's Spine rig is published.
 *
 * @param props Component props.
 * @returns The placeholder.
 */
export function StagePlaceholder({ profession }: StagePlaceholderProps) {
	return (
		<Box sx={{ textAlign: "center", px: 2 }}>
			<Box component="img" src={classIconUrl(profession)} alt="" sx={PLACEHOLDER_ICON_SX} />
			<Typography variant="body2" color="text.secondary">
				Chibi animations are on their way.
			</Typography>
		</Box>
	);
}

/**
 * The Animations card from gfl's doll page: Battle and Dorm, then a stage that fills the card. No zoom buttons - the stage zooms on the wheel
 * and pans on a drag, as gfl's does, and a click cycles to the next animation.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function AnimationsCard({ interactive, renderStage }: AnimationsCardProps) {
	const [kind, setKind] = useState<RigKind>("battle");

	const handleKindChange = useCallback((_event: MouseEvent<HTMLElement>, value: RigKind | null) => {
		if (value !== null) {
			setKind(value);
		}
	}, []);

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
				Animations
			</Typography>
			<ToggleButtonGroup value={kind} exclusive fullWidth size="small" onChange={handleKindChange} aria-label="Animation set" sx={KIND_SX}>
				<ToggleButton value="battle">Battle</ToggleButton>
				<ToggleButton value="dorm">Dorm</ToggleButton>
			</ToggleButtonGroup>
			<Box sx={STAGE_SX}>{renderStage(kind)}</Box>
			{interactive ? (
				<Typography variant="caption" color="text.secondary" sx={CAPTION_SX}>
					Click to cycle · scroll to zoom · drag to pan
				</Typography>
			) : null}
		</Paper>
	);
}
