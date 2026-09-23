import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { ArtPlaceholder, ENEMY_CARD_ASPECT } from "archive-kit";

import { hasModuleArt, hasModuleType, moduleArtUrl, moduleTypeUrl } from "../../lib/assets.js";
import { loadProfile } from "../../lib/data.js";
import { RAISED_TILE_SX } from "../../lib/layout.js";
import type { OperatorModule } from "../../types/operator.js";

/** The module picture's edge in px. The source is 220px, so it stays sharp at 2x. */
const ART_SIZE = 104;

/** Labels for the stat bonus line. */
const STAT_LABELS: Record<string, string> = { maxHp: "HP", atk: "ATK", def: "DEF", magicResistance: "RES", cost: "Cost", blockCnt: "Block", respawnTime: "Redeploy", aspd: "ASPD" };

/** The header: picture beside the badge, name and unlock line. */
const HEAD_SX: SxProps<Theme> = { display: "grid", gridTemplateColumns: `${ART_SIZE}px minmax(0, 1fr)`, gap: 1.75, alignItems: "start", mt: 1.5 };

/** The module picture. */
const ART_SX: SxProps<Theme> = { width: ART_SIZE, height: ART_SIZE, borderRadius: 1, display: "block" };

/** The placeholder shown when a module picture was not published. */
const PLACEHOLDER_SX: SxProps<Theme> = { width: ART_SIZE };

/** The branch badge beside a code. */
const BADGE_SX: SxProps<Theme> = { width: 22, height: "auto", mr: 0.75, verticalAlign: "middle" };

/** The line saying which module is being previewed when none is applied. */
const PREVIEW_NOTE_SX: SxProps<Theme> = { mt: 1 };

/** The text column beside the picture. `minWidth: 0` lets a long name wrap instead of widening the grid. */
const META_SX: SxProps<Theme> = { minWidth: 0 };

/** The module's code line. */
const CODE_SX: SxProps<Theme> = { fontWeight: 700 };

/** The module's name. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700, fontSize: 17, mt: 0.5 };

/** One effect tile: a small label, then the text. */
const EFFECT_SX: SxProps<Theme> = { ...RAISED_TILE_SX, p: 1.25, mt: 1.25, fontSize: 13.5, lineHeight: 1.55 };

/** An effect tile's label. */
const EFFECT_LABEL_SX: SxProps<Theme> = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary", mb: 0.5 };

/** The lore paragraph. */
const LORE_SX: SxProps<Theme> = { mt: 1.75, fontSize: 13.5, lineHeight: 1.65, color: "text.secondary", whiteSpace: "pre-line" };

/** Props for ModulesPanel. */
interface ModulesPanelProps {
	/** The operator id, for the lore side file. */
	operatorId: string;
	/** The operator's modules. Never empty, since the tab is hidden otherwise. */
	modules: OperatorModule[];
	/** The applied module's id, or null. */
	selected: string | null;
	/** The selected stage, 1 to 3. */
	stage: number;
	/** Applies a module, the same as picking it in the Stats card. */
	onSelect: (id: string) => void;
}

/**
 * The Modules tab: one chip per module, then the shown module's picture, badge, name and unlock point, the selected stage's stats, trait,
 * talent and summon changes, then its lore. With no module applied it previews the first one, and picking a chip applies it.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function ModulesPanel({ operatorId, modules, selected, stage, onSelect }: ModulesPanelProps) {
	const [lore, setLore] = useState<Record<string, string>>({});

	useEffect(() => {
		let active = true;
		loadProfile(operatorId).then(
			(profile) => {
				if (active) {
					setLore(profile?.moduleLore ?? {});
				}
			},
			() => {
				// The lore is a nicety. A failed side-file load leaves the effects on screen and the lore empty.
			}
		);
		return () => {
			active = false;
		};
	}, [operatorId]);

	const module = modules.find((entry) => entry.id === selected) ?? modules[0];
	if (!module) {
		return null;
	}
	const current = module.stages[stage - 1];
	const stats = Object.entries(current?.stats ?? {})
		.map(([field, value]) => `${STAT_LABELS[field] ?? field} +${value}`)
		.join(", ");

	const handleSelect = (_event: MouseEvent<HTMLElement>, value: string | null) => {
		if (value !== null) {
			onSelect(value);
		}
	};

	return (
		<Box>
			<ToggleButtonGroup value={selected} exclusive size="small" onChange={handleSelect} aria-label="Module to show">
				{modules.map((entry) => (
					<ToggleButton key={entry.id} value={entry.id} title={entry.name}>
						{hasModuleType(entry.typeIcon) ? <Box component="img" src={moduleTypeUrl(entry.typeIcon)} alt="" sx={BADGE_SX} /> : null}
						{entry.code}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			{selected === null ? (
				<Typography variant="body2" color="text.secondary" sx={PREVIEW_NOTE_SX}>
					{`No module applied. Showing ${module.code} - pick it here or in Stats to apply it.`}
				</Typography>
			) : null}
			<Box sx={HEAD_SX}>
				{hasModuleArt(module.art) ? (
					<Box component="img" src={moduleArtUrl(module.art)} alt={module.name} sx={ART_SX} />
				) : (
					<ArtPlaceholder name={module.name} aspect={ENEMY_CARD_ASPECT} sx={PLACEHOLDER_SX} />
				)}
				<Box sx={META_SX}>
					<Typography sx={CODE_SX}>
						{hasModuleType(module.typeIcon) ? <Box component="img" src={moduleTypeUrl(module.typeIcon)} alt="" sx={BADGE_SX} /> : null}
						{module.code}
					</Typography>
					<Typography component="h3" sx={NAME_SX}>
						{module.name}
					</Typography>
					<Typography variant="body2" color="text.secondary">{`Unlocks at E${module.unlockPhase} Lv${module.unlockLevel} - Stage ${stage}`}</Typography>
				</Box>
			</Box>
			{stats ? (
				<Box sx={EFFECT_SX}>
					<Box component="span" sx={EFFECT_LABEL_SX}>
						Stats
					</Box>
					{stats}
				</Box>
			) : null}
			{current?.trait ? (
				<Box sx={EFFECT_SX}>
					<Box component="span" sx={EFFECT_LABEL_SX}>
						{current.trait.mode === "append" ? "Trait - added" : "Trait - replaced"}
					</Box>
					{current.trait.text}
				</Box>
			) : null}
			{current?.talents.map((talent, index) => (
				<Box key={index} sx={EFFECT_SX}>
					<Box component="span" sx={EFFECT_LABEL_SX}>
						{`${talent.index === null ? "New talent" : "Talent"} - ${talent.name}${talent.requiredPotential > 1 ? ` (P${talent.requiredPotential})` : ""}`}
					</Box>
					{talent.description}
				</Box>
			))}
			{current && current.summon.length > 0 ? (
				<Box sx={EFFECT_SX}>
					<Box component="span" sx={EFFECT_LABEL_SX}>
						Summons
					</Box>
					{current.summon.map((line) => (
						<Box key={line}>{line}</Box>
					))}
				</Box>
			) : null}
			{lore[module.id] ? <Typography sx={LORE_SX}>{lore[module.id]}</Typography> : null}
		</Box>
	);
}
