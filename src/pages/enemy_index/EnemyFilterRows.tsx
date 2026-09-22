import { ChipRowDivider } from "archive-kit";

import FilterOptionRow from "../../components/FilterOptionRow.js";

// The labels below are the display names `tools/data/lib/enemies.mjs` writes (`LEVELS`, `ATTACKS`, `DAMAGES`, `MOTIONS`) - change one, update the
// other, or the chip silently matches nothing.

/** The three enemy levels, in the game's own order. Exported so the chip row and the index's level sort read one list. */
export const LEVEL_ORDER = ["Normal", "Elite", "Leader"];

/** How an enemy attacks. */
const ATTACKS = ["Melee", "Ranged", "Melee and Ranged", "None"];

/** What damage an enemy deals. */
const DAMAGES = ["Physical", "Arts", "Healing", "None"];

/** How an enemy moves. */
const MOTIONS = ["Ground", "Aerial"];

/**
 * Props for EnemyFilterRows.
 *
 * Every toggle takes the chip's own `value` back rather than being bound per chip, the same contract as `OperatorFilterRows`.
 */
interface EnemyFilterRowsProps {
	/** Levels currently selected. */
	levels: string[];
	/** Toggles the level it is called with. */
	onToggleLevel: (value?: string | number) => void;
	/** Every race, already sorted. */
	raceOptions: string[];
	/** Races currently selected. */
	races: string[];
	/** Toggles the race it is called with. */
	onToggleRace: (value?: string | number) => void;
	/** Attack patterns currently selected. */
	attacks: string[];
	/** Toggles the attack pattern it is called with. */
	onToggleAttack: (value?: string | number) => void;
	/** Damage types currently selected. */
	damages: string[];
	/** Toggles the damage type it is called with. */
	onToggleDamage: (value?: string | number) => void;
	/** Movement types currently selected. */
	motions: string[];
	/** Toggles the movement type it is called with. */
	onToggleMotion: (value?: string | number) => void;
	/** Every release year that occurs, oldest first, with "Unknown" last. */
	yearOptions: string[];
	/** Release years currently selected. */
	years: string[];
	/** Toggles the release year it is called with. */
	onToggleYear: (value?: string | number) => void;
}

/**
 * The enemy index's filter chip rows: level, race, attack pattern, damage type, movement and release year.
 *
 * @param props Component props.
 * @returns The rows.
 */
export default function EnemyFilterRows(props: EnemyFilterRowsProps) {
	const { levels, onToggleLevel, raceOptions, races, onToggleRace, attacks, onToggleAttack, damages, onToggleDamage, motions, onToggleMotion } = props;
	const { yearOptions, years, onToggleYear } = props;
	return (
		<>
			<FilterOptionRow options={LEVEL_ORDER} selected={levels} onToggle={onToggleLevel} />
			<ChipRowDivider />
			<FilterOptionRow options={raceOptions} selected={races} onToggle={onToggleRace} />
			<ChipRowDivider />
			<FilterOptionRow options={ATTACKS} selected={attacks} onToggle={onToggleAttack} />
			<ChipRowDivider />
			<FilterOptionRow options={DAMAGES} selected={damages} onToggle={onToggleDamage} />
			<ChipRowDivider />
			<FilterOptionRow options={MOTIONS} selected={motions} onToggle={onToggleMotion} />
			<ChipRowDivider />
			<FilterOptionRow options={yearOptions} selected={years} onToggle={onToggleYear} />
		</>
	);
}
