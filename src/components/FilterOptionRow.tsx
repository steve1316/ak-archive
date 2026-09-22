import { ChipRow, FilterChip } from "archive-kit";

/** Props for FilterOptionRow. */
interface FilterOptionRowProps {
	/** The row's option labels, in display order. Each is also the value its chip reports back through `onToggle`. */
	options: string[];
	/** The options currently selected in this row. */
	selected: string[];
	/** Toggles the option it is called with. One stable handler for the whole row, per the kit's `FilterChip` contract. */
	onToggle: (value?: string | number) => void;
}

/**
 * One row of filter chips over a plain list of string options.
 *
 * Most rows on both indexes are this same shape - a `ChipRow` of `li`-wrapped `FilterChip`s differing only in which options/selected/onToggle
 * triple they get - so they share this rather than repeating the block. The operator rarity row stays separate, since it uses the kit's own
 * `RarityChipRow` and carries colour data the other rows do not.
 *
 * @param props Component props.
 * @returns The row.
 */
export default function FilterOptionRow({ options, selected, onToggle }: FilterOptionRowProps) {
	return (
		<ChipRow>
			{options.map((option) => (
				<li key={option}>
					<FilterChip label={option} value={option} selected={selected.includes(option)} onToggle={onToggle} />
				</li>
			))}
		</ChipRow>
	);
}
