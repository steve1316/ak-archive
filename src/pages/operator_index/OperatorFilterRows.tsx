import { useMemo } from "react";

import { MenuItem, TextField } from "@mui/material";

import { ChipRow, ChipRowDivider, FilterChip, RarityChipRow } from "archive-kit";
import type { RarityFilterEntry } from "archive-kit";

/**
 * Props for OperatorFilterRows.
 *
 * Every toggle takes the chip's own `value` back rather than being bound per chip. That is the kit's contract: `FilterChip` is memoised, and a
 * fresh arrow per chip is a new prop on every render, which defeats the memo. The parent holds one stable handler per row with `useCallback`.
 */
interface OperatorFilterRowsProps {
	/** Star counts currently selected. */
	rarities: number[];
	/** Toggles the star count it is called with. */
	onToggleRarity: (value?: string | number) => void;
	/** Display class names currently selected. */
	classes: string[];
	/** Toggles the class it is called with. */
	onToggleClass: (value?: string | number) => void;
	/** The archetypes available for the selected classes, already sorted. Empty when no class is selected. */
	subclassOptions: string[];
	/** Archetypes currently selected. */
	subclasses: string[];
	/** Toggles the archetype it is called with. */
	onToggleSubclass: (value?: string | number) => void;
	/** Every faction value, already sorted. */
	factionOptions: string[];
	/** The selected faction, or an empty string for all. */
	faction: string;
	/** Sets the selected faction. */
	onFactionChange: (faction: string) => void;
	/** Positions currently selected. */
	positions: string[];
	/** Toggles the position it is called with. */
	onTogglePosition: (value?: string | number) => void;
	/** Every recruitment tag, already sorted. */
	tagOptions: string[];
	/** Tags currently selected. */
	tags: string[];
	/** Toggles the tag it is called with. */
	onToggleTag: (value?: string | number) => void;
}

/** The eight display class names, in the game's own order. Exported so the chip row and the index's class sort read one list rather than two. */
export const CLASS_ORDER = ["Vanguard", "Guard", "Defender", "Sniper", "Caster", "Medic", "Supporter", "Specialist"];

/** The two deployment positions. */
const POSITIONS = ["Melee", "Ranged"];

/** The six star counts, highest first, which is the order the game's own roster puts them in. */
const RARITIES = [6, 5, 4, 3, 2, 1];

/**
 * The index's filter chip rows.
 *
 * The subclass row is conditional: with 71 archetypes across 8 classes, showing them all is a wall of chips, so the row appears only once a
 * class narrows it to that class's 7 to 14. Faction is a single dropdown over all 44 nation, group and team values for the same reason.
 *
 * @param props Component props.
 * @returns The rows.
 */
export default function OperatorFilterRows(props: OperatorFilterRowsProps) {
	const { rarities, onToggleRarity, classes, onToggleClass, subclassOptions, subclasses, onToggleSubclass } = props;
	const { factionOptions, faction, onFactionChange, positions, onTogglePosition, tagOptions, tags, onToggleTag } = props;

	// Built once per rarity change rather than per render, since `RarityChipRow` is memoised and a fresh array is a new prop every time. The row
	// already leads each chip with its own rarity number, so the label is the star rather than that same number printed twice.
	const rarityEntries = useMemo<RarityFilterEntry[]>(() => RARITIES.map((rarity) => ({ key: rarity, label: "★", rarity, selected: rarities.includes(rarity) })), [rarities]);

	return (
		<>
			<RarityChipRow entries={rarityEntries} onToggle={onToggleRarity} />
			<ChipRowDivider />
			<ChipRow>
				{CLASS_ORDER.map((profession) => (
					<li key={profession}>
						<FilterChip label={profession} value={profession} selected={classes.includes(profession)} onToggle={onToggleClass} />
					</li>
				))}
			</ChipRow>
			{subclassOptions.length > 0 && (
				<>
					<ChipRowDivider />
					<ChipRow>
						{subclassOptions.map((subclass) => (
							<li key={subclass}>
								<FilterChip label={subclass} value={subclass} selected={subclasses.includes(subclass)} onToggle={onToggleSubclass} />
							</li>
						))}
					</ChipRow>
				</>
			)}
			<ChipRowDivider />
			<TextField select size="small" fullWidth label="Faction" value={faction} onChange={(event) => onFactionChange(event.target.value)} sx={{ my: 1 }}>
				<MenuItem value="">All factions</MenuItem>
				{factionOptions.map((option) => (
					<MenuItem key={option} value={option}>
						{option}
					</MenuItem>
				))}
			</TextField>
			<ChipRow>
				{POSITIONS.map((position) => (
					<li key={position}>
						<FilterChip label={position} value={position} selected={positions.includes(position)} onToggle={onTogglePosition} />
					</li>
				))}
			</ChipRow>
			<ChipRowDivider />
			<ChipRow>
				{tagOptions.map((tag) => (
					<li key={tag}>
						<FilterChip label={tag} value={tag} selected={tags.includes(tag)} onToggle={onToggleTag} />
					</li>
				))}
			</ChipRow>
		</>
	);
}
