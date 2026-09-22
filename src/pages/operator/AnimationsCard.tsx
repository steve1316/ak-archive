import { useCallback, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { classIconUrl } from "../../lib/assets.js";
import { SECTION_HEADING_GAP, SECTION_HEADING_SX, SECTION_SX, TIGHT_RADIUS } from "./layout.js";

/** Which of an operator's two chibi rigs is on the stage. Named after upstream's own split: `build_<id>` is battle, `<id>/Back` is dorm. */
export type RigKind = "battle" | "dorm";

/** Which way the battle chibi faces: `front` plays the index's `battle` rig, `back` its `back` rig. */
export type RigFacing = "front" | "back";

/** What the stage reports back to the card, for the controls and the caption around it. */
export interface StageStatus {
	/** Whether the selected form has a back-facing battle rig, which enables the Back toggle. */
	hasBack: boolean;
	/** The caption's first line, such as "Attack - 2 / 7", or null when nothing is playing. */
	caption: string | null;
}

/** What the card asks its stage to draw. */
export interface StageRequest {
	/** The selected rig kind. */
	kind: RigKind;
	/** The reader's chosen facing. The stage falls back to the battle rig itself when the current form has no back rig. */
	facing: RigFacing;
	/** Stable callback the stage calls whenever its status changes. */
	onStatus: (status: StageStatus) => void;
}

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

/** The Front/Back switch under the Battle tab. */
const FACING_SX: SxProps<Theme> = { flex: "none", alignSelf: "center", mb: SECTION_HEADING_GAP };

/** The caption block under the stage: the playing animation, then the interaction hint. */
const CAPTION_SX: SxProps<Theme> = { flex: "none", mt: 0.875, textAlign: "center", display: "flex", flexDirection: "column" };

/** The caption block while nothing plays: hidden, but still holding its height. */
const CAPTION_HIDDEN_SX: SxProps<Theme> = { flex: "none", mt: 0.875, textAlign: "center", display: "flex", flexDirection: "column", visibility: "hidden" };

/** The status the card starts with, before the stage reports. */
const INITIAL_STATUS: StageStatus = { hasBack: false, caption: null };

/** The placeholder's class icon, greyed so it reads as absent rather than as content. */
const PLACEHOLDER_ICON_SX: SxProps<Theme> = { width: 70, display: "block", mx: "auto", mb: 1.125, opacity: 0.45, filter: "grayscale(1)" };

/** Props for AnimationsCard. */
interface AnimationsCardProps {
	/** Whether the stage responds to clicks, wheel and drags. The caption describing them is only shown when it does. */
	interactive: boolean;
	/** Draws the stage for the selected rig kind and facing. */
	renderStage: (request: StageRequest) => ReactNode;
}

/** Props for StagePlaceholder. */
interface StagePlaceholderProps {
	/** The operator's class, whose icon stands in for the chibi. */
	profession: string;
	/** Why no chibi is playing. */
	message: string;
}

/**
 * What the stage shows when no chibi plays: the operator's class icon and the reason.
 *
 * @param props Component props.
 * @returns The placeholder.
 */
export function StagePlaceholder({ profession, message }: StagePlaceholderProps) {
	return (
		<Box sx={{ textAlign: "center", px: 2 }}>
			<Box component="img" src={classIconUrl(profession)} alt="" sx={PLACEHOLDER_ICON_SX} />
			<Typography variant="body2" color="text.secondary">
				{message}
			</Typography>
		</Box>
	);
}

/**
 * The Animations card from gfl's doll page: Battle and Dorm, a Front/Back switch under Battle, then a stage that fills the card. No zoom
 * buttons - the stage zooms on the wheel and pans on a drag, as gfl's does, and a click cycles to the next animation.
 *
 * @param props Component props.
 * @returns The card.
 */
export default function AnimationsCard({ interactive, renderStage }: AnimationsCardProps) {
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
			<ToggleButtonGroup value={kind} exclusive fullWidth size="small" onChange={handleKindChange} aria-label="Animation set" sx={KIND_SX}>
				<ToggleButton value="battle">Battle</ToggleButton>
				<ToggleButton value="dorm">Dorm</ToggleButton>
			</ToggleButtonGroup>
			{kind === "battle" ? (
				<ToggleButtonGroup value={displayFacing} exclusive size="small" onChange={handleFacingChange} aria-label="Battle chibi facing" sx={FACING_SX}>
					<ToggleButton value="front">Front</ToggleButton>
					<ToggleButton value="back" disabled={!status.hasBack}>
						Back
					</ToggleButton>
				</ToggleButtonGroup>
			) : null}
			<Box sx={STAGE_SX}>{renderStage({ kind, facing: chosenFacing, onStatus: setStatus })}</Box>
			{interactive ? (
				// Both lines keep their height while nothing plays, so the stage does not jump when a chibi loads.
				<Box sx={status.caption === null ? CAPTION_HIDDEN_SX : CAPTION_SX}>
					<Typography variant="caption" color="text.primary" aria-live="polite">
						{status.caption ?? "\u00a0"}
					</Typography>
					<Typography variant="caption" color="text.secondary">
						Click to cycle · scroll to zoom · drag to pan
					</Typography>
				</Box>
			) : null}
		</Paper>
	);
}
