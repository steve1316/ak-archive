import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { ArtPlaceholder, ENEMY_CARD_ASPECT } from "archive-kit";

import { hasModuleArt, moduleArtUrl } from "../../lib/assets.js";
import { loadModuleLore } from "../../lib/data.js";
import { GROUP_HEADING_SX, RAISED_TILE_SX } from "../../lib/layout.js";
import { STAT_LABELS } from "../../lib/stats.js";
import type { Controls, ModuleStats, OperatorFull } from "../../types/operator.js";
import ModuleBadge from "./ModuleBadge.js";

/** The module picture's edge in px. The source is 220px, so it stays sharp at 2x. */
const ART_SIZE = 104;

/** The header: picture beside the code, name and unlock line. */
const HEAD_SX: SxProps<Theme> = { display: "grid", gridTemplateColumns: `${ART_SIZE}px minmax(0, 1fr)`, gap: 1.75, alignItems: "start", mt: 1.5 };

/** The module picture. */
const ART_SX: SxProps<Theme> = { width: ART_SIZE, height: ART_SIZE, borderRadius: 1, display: "block" };

/** The placeholder shown when a module picture was not published. */
const PLACEHOLDER_SX: SxProps<Theme> = { width: ART_SIZE };

/** The line saying which module is being previewed when none is applied. */
const PREVIEW_NOTE_SX: SxProps<Theme> = { mt: 1 };

/** The text column beside the picture. `minWidth: 0` lets a long name wrap instead of widening the grid. */
const META_SX: SxProps<Theme> = { minWidth: 0 };

/** The module's code line. */
const CODE_SX: SxProps<Theme> = { fontWeight: 700 };

/** The module's name. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700, fontSize: 17, mt: 0.5 };

/** One effect tile on the raised surface, with the same body text as a talent tile. */
const EFFECT_SX: SxProps<Theme> = { ...RAISED_TILE_SX, p: 1.25, mt: 1.25, fontSize: 13.5, lineHeight: 1.55 };

/** An effect tile's label: the card's small group heading, shown as a block over the text. */
const EFFECT_LABEL_SX: SxProps<Theme> = { ...GROUP_HEADING_SX, display: "block", mb: 0.5 };

/** The lore paragraph. */
const LORE_SX: SxProps<Theme> = { mt: 1.75, fontSize: 13.5, lineHeight: 1.65, color: "text.secondary", whiteSpace: "pre-line" };

/** Props for EffectTile. */
interface EffectTileProps {
	/** The tile's label, such as `Stats` or `Talent - Blade Art`. */
	label: string;
	/** The effect text. */
	children: ReactNode;
}

/**
 * One effect of the shown module stage: a small label over its text.
 *
 * @param props Component props.
 * @returns The tile.
 */
function EffectTile({ label, children }: EffectTileProps) {
	return (
		<Box sx={EFFECT_SX}>
			<Box component="span" sx={EFFECT_LABEL_SX}>
				{label}
			</Box>
			{children}
		</Box>
	);
}

/** Props for ModulesPanel. */
interface ModulesPanelProps {
	/** The operator, with at least one module, since the tab is hidden otherwise. */
	operator: OperatorFull;
	/** The page's controls, which name the applied module and stage. */
	controls: Controls;
	/** Applies a control change, the same handler the Stats card uses. */
	onChange: (patch: Partial<Controls>) => void;
}

/**
 * The Modules tab: one chip per module, then the shown module's picture, badge, name and unlock point, the selected stage's stats, trait,
 * talent and summon changes, then its lore. With no module applied it previews the first one, and picking a chip applies it.
 *
 * @param props Component props.
 * @returns The panel.
 */
export default function ModulesPanel({ operator, controls, onChange }: ModulesPanelProps) {
	const module = operator.modules.find((entry) => entry.id === controls.module) ?? operator.modules[0];
	const [lore, setLore] = useState<{ id: string; text: string } | null>(null);

	useEffect(() => {
		if (!module) {
			return;
		}
		let active = true;
		loadModuleLore(operator.id, module.id).then(
			(text) => {
				if (active) {
					setLore(text ? { id: module.id, text } : null);
				}
			},
			() => {
				// The lore is a nicety. A failed load leaves the effects on screen and the lore empty.
			}
		);
		return () => {
			active = false;
		};
	}, [operator.id, module]);

	if (!module) {
		return null;
	}
	const stage = controls.moduleStage;
	const current = module.stages[stage - 1];
	const stats = (Object.entries(current?.stats ?? {}) as [keyof ModuleStats, number][]).map(([field, value]) => `${STAT_LABELS[field]} +${value}`).join(", ");

	const handleSelect = (_event: MouseEvent<HTMLElement>, value: string | null) => {
		if (value !== null) {
			onChange({ module: value });
		}
	};

	return (
		<Box>
			<ToggleButtonGroup value={controls.module} exclusive size="small" onChange={handleSelect} aria-label="Module to show">
				{operator.modules.map((entry) => (
					<ToggleButton key={entry.id} value={entry.id} title={entry.name}>
						<ModuleBadge module={entry} />
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			{controls.module === null ? (
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
						<ModuleBadge module={module} />
					</Typography>
					<Typography component="h3" sx={NAME_SX}>
						{module.name}
					</Typography>
					<Typography variant="body2" color="text.secondary">{`Unlocks at E${module.unlockPhase} Lv${module.unlockLevel} - Stage ${stage}`}</Typography>
				</Box>
			</Box>
			{stats ? <EffectTile label="Stats">{stats}</EffectTile> : null}
			{current?.trait ? <EffectTile label={current.trait.mode === "append" ? "Trait - added" : "Trait - replaced"}>{current.trait.text}</EffectTile> : null}
			{current?.talents.map((talent, index) => (
				<EffectTile key={index} label={`${talent.index === null ? "New talent" : "Talent"} - ${talent.name}${talent.requiredPotential > 1 ? ` (P${talent.requiredPotential})` : ""}`}>
					{talent.description}
				</EffectTile>
			))}
			{current && current.summon.length > 0 ? (
				<EffectTile label="Summons">
					{current.summon.map((line) => (
						<Box key={line}>{line}</Box>
					))}
				</EffectTile>
			) : null}
			{lore?.id === module.id ? <Typography sx={LORE_SX}>{lore.text}</Typography> : null}
		</Box>
	);
}
