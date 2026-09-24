import { useCallback, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { SECTION_HEADING_GAP, SECTION_HEADING_SX, SECTION_SX, TIGHT_RADIUS } from "../lib/layout.js";

/** Which of an operator's two chibi rigs is on the stage. Named after upstream's own split: `build_<id>` is battle, `<id>/Back` is dorm. */
export type RigKind = "battle" | "dorm";

/** Which way the battle chibi faces: `front` plays the index's `battle` rig, `back` its `back` rig. */
export type RigFacing = "front" | "back";

/** What the stage reports back to the card, for the Front/Back switch. */
export interface StageStatus {
	/** Whether the selected form has a back-facing battle rig, which enables the Back toggle. */
	hasBack: boolean;
}

/** What the card asks its stage to draw. */
export interface StageRequest {
	/** The selected rig kind. */
	kind: RigKind;
	/** The reader's chosen facing. The stage falls back to the battle rig itself when the current form has no back rig. */
	facing: RigFacing;
	/** Stable callback the stage calls whenever its status changes. */
	onStatus: (status: StageStatus) => void;
	/** The stage box's style, for the stage to hand to `AnimationStage`. It fills the card's remaining height. */
	sx: SxProps<Theme>;
}

/**
 * The stage box. Takes every pixel the card has left, which is what lets row 1's slack land here instead of in an empty box. The tight radius
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

/** The Front/Back switch under the Battle tab. */
const FACING_SX: SxProps<Theme> = { flex: "none", alignSelf: "center", mb: SECTION_HEADING_GAP };

/** The status the card starts with, and the one the stage reports on its way out, so no Back toggle outlives the rig it described. */
export const INITIAL_STATUS: StageStatus = { hasBack: false };

/** The placeholder's stand-in icon, such as an operator's class icon or an enemy's icon, greyed so it reads as absent rather than as content. */
const PLACEHOLDER_ICON_SX: SxProps<Theme> = { width: 70, display: "block", mx: "auto", mb: 1.125, opacity: 0.45, filter: "grayscale(1)" };

/** Props for AnimationsCard. */
interface AnimationsCardProps {
	/** Draws the stage for the selected rig kind and facing, or returns null before the subject loads. */
	renderStage: (request: StageRequest) => ReactNode;
	/** Hides the Battle/Dorm switch and the Front/Back toggle, for a subject with a single battle rig such as an enemy. */
	battleOnly?: boolean;
}

/** Props for StagePlaceholder. */
interface StagePlaceholderProps {
	/** The image that stands in for the animation, such as an operator's class icon or an enemy's icon, or null for none. */
	iconUrl: string | null;
	/** Why no animation is playing. */
	message: string;
}

/**
 * What the stage shows when no animation plays: a greyed stand-in image and the reason.
 *
 * @param props Component props.
 * @returns The placeholder.
 */
export function StagePlaceholder({ iconUrl, message }: StagePlaceholderProps) {
	return (
		<Box sx={{ textAlign: "center", px: 2 }}>
			{iconUrl ? <Box component="img" src={iconUrl} alt="" sx={PLACEHOLDER_ICON_SX} /> : null}
			<Typography variant="body2" color="text.secondary">
				{message}
			</Typography>
		</Box>
	);
}

/**
 * The Animations card from gfl's doll page: Battle and Dorm, a Front/Back switch under Battle, then a stage that fills the card with the
 * caption under it. archive-kit's `AnimationStage` draws both: the wheel zooms, a drag pans, and a tap steps to the next animation. With
 * `battleOnly` the card is just the stage and its caption.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function AnimationsCard({ renderStage, battleOnly = false }: AnimationsCardProps) {
	const [kind, setKind] = useState<RigKind>("battle");
	const [chosenFacing, setChosenFacing] = useState<RigFacing>("front");
	const [status, setStatus] = useState<StageStatus>(INITIAL_STATUS);
	// The toggle shows Front whenever the current form has no back rig, without forgetting the reader's choice for forms that do. The stage
	// itself gets the raw choice below, so a form switch never loads the front rig first only to abort it for the back rig a moment later.
	const displayFacing: RigFacing = status.hasBack ? chosenFacing : "front";

	const handleKindChange = useCallback((_event: MouseEvent<HTMLElement>, value: RigKind | null) => {
		if (value !== null) {
			setKind(value);
		}
	}, []);

	const handleFacingChange = useCallback((_event: MouseEvent<HTMLElement>, value: RigFacing | null) => {
		if (value !== null) {
			setChosenFacing(value);
		}
	}, []);

	return (
		<Paper variant="outlined" sx={SECTION_SX}>
			<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
				Animations
			</Typography>
			{battleOnly ? null : (
				<ToggleButtonGroup value={kind} exclusive fullWidth size="small" onChange={handleKindChange} aria-label="Animation set" sx={KIND_SX}>
					<ToggleButton value="battle">Battle</ToggleButton>
					<ToggleButton value="dorm">Dorm</ToggleButton>
				</ToggleButtonGroup>
			)}
			{kind === "battle" && !battleOnly ? (
				<ToggleButtonGroup value={displayFacing} exclusive size="small" onChange={handleFacingChange} aria-label="Battle chibi facing" sx={FACING_SX}>
					<ToggleButton value="front">Front</ToggleButton>
					<ToggleButton value="back" disabled={!status.hasBack}>
						Back
					</ToggleButton>
				</ToggleButtonGroup>
			) : null}
			{/* The stage draws its own box and the caption under it. Before the subject loads, an empty box holds the card's shape. */}
			{renderStage({ kind, facing: chosenFacing, onStatus: setStatus, sx: STAGE_SX }) ?? <Box sx={STAGE_SX} />}
		</Paper>
	);
}
