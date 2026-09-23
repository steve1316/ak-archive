import { Fragment } from "react";

import { Box, Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { RankBar } from "archive-kit";

import type { HandbookRecord, RecordField } from "../types/operator.js";

/**
 * Steps on the physical exam scale. `tools/data/lib/record.mjs` defines the scale as `GRADES` - change one, update the other.
 */
const EXAM_GRADE_COUNT = 7;

/** A value longer than this takes a whole row, so a sentence such as the infection status does not wrap into a narrow column. */
const LONG_VALUE = 40;

/** A rank bar's drawn width: 7 segments at the mockup's 12px plus 6 gaps at the kit's 2px, 7 * 12 + 6 * 2 = 96. */
const EXAM_BAR_WIDTH = 96;

/**
 * The record's own width at which it fits two label/value pairs per row. It asks its container, not the window, because the page's three-column
 * layout from `md` up can leave the record as little as ~360px wide on a window just over 900px, where two pairs spill under the Animations card.
 */
const TWO_PAIRS = "@container (min-width: 640px)";

/**
 * The block's styles. Checked with `satisfies` rather than annotated as `SxProps<Theme>`, which is a union including functions and so cannot be
 * spread - the long-field styles below extend the plain ones. gfl's pages use the same pattern.
 */
const styles = {
	/**
	 * Two label/value pairs per row when the record itself is wide enough, one otherwise. `gridAutoFlow: "row dense"` lets a short pair after a
	 * spanning long value backfill the gap the long value's own row leaves empty, rather than leaving a hole beside it.
	 */
	fields: {
		display: "grid",
		gridTemplateColumns: "auto minmax(0, 1fr)",
		[TWO_PAIRS]: { gridTemplateColumns: "auto minmax(0, 1fr) auto minmax(0, 1fr)" },
		gridAutoFlow: "row dense",
		columnGap: 2.75,
		rowGap: 0.875,
		m: 0,
		fontSize: 14
	},
	/** A label. */
	label: { color: "text.secondary", whiteSpace: "nowrap" },
	/** A value. */
	value: { m: 0, minWidth: 0 },
	/** The trait, set apart by a rule in the accent colour. */
	trait: { mt: 2, fontSize: 14, lineHeight: 1.55, borderLeft: 2, borderColor: "primary.main", pl: 1.25 },
	/** Module text in the trait, on its own line in the accent colour. */
	traitExtra: { display: "block", color: "primary.main" }
} satisfies Record<string, SxProps<Theme>>;

/** The block's root: the container the record's column count is measured against. */
const ROOT_SX = { mt: 2, containerType: "inline-size" } satisfies SxProps<Theme>;

/** A long field's label, pinned to the first column so its value can span the rest. */
const LONG_LABEL_SX = { ...styles.label, [TWO_PAIRS]: { gridColumn: "1" } } satisfies SxProps<Theme>;

/** A long value, spanning every column after its label. */
const LONG_VALUE_SX = { ...styles.value, [TWO_PAIRS]: { gridColumn: "2 / -1" } } satisfies SxProps<Theme>;

/** Props for RecordBlock. */
interface RecordBlockProps {
	/** The parsed record. */
	record: HandbookRecord;
	/** The operator's affiliations joined for display, or null when upstream names none. Not part of the handbook, so passed separately. */
	affiliation: string | null;
	/** The operator's trait, or null. */
	trait: string | null;
	/** Module text shown after the trait, or instead of it when `trait` is null. */
	traitExtra?: string | null;
}

/**
 * Render one field list as label and value pairs.
 *
 * @param fields The fields, in upstream order.
 * @param graded Whether a single-grade value draws as a rank bar beside its word.
 * @returns The pairs, as children of a description list.
 */
function renderFields(fields: RecordField[], graded: boolean) {
	return fields.map((field, index) => {
		const long = field.value.length > LONG_VALUE;
		return (
			<Fragment key={`${index}-${field.label}`}>
				<Box component="dt" sx={long ? LONG_LABEL_SX : styles.label}>
					{field.label}
				</Box>
				<Box component="dd" sx={long ? LONG_VALUE_SX : styles.value}>
					{graded && field.grade !== null ? (
						<Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
							{/* RankBar's own segments are `flex: 1` with no width, so the track needs an explicit width or every segment collapses to 0. */}
							<Box sx={{ width: EXAM_BAR_WIDTH, flex: "none" }}>
								<RankBar value={field.grade} max={EXAM_GRADE_COUNT} label={`${field.label}: ${field.value}`} />
							</Box>
							{/* Wraps below the bar on a narrow column rather than pushing past the dd, which scrolled the page sideways. */}
							<span>{field.value}</span>
						</Stack>
					) : (
						field.value
					)}
				</Box>
			</Fragment>
		);
	});
}

/**
 * The handbook's record, filling the space gfl fills with its firearm spec sheet: the Basic Info fields, the Physical Exam as rank bars, then
 * the trait, with any module text on its own line below it. Labels are upstream's own, so a robot's `Model` and `Manufacturer` read as written
 * rather than being forced into a human schema.
 *
 * @param props Component props.
 * @returns The block.
 */
export default function RecordBlock({ record, affiliation, trait, traitExtra }: RecordBlockProps) {
	const basic = affiliation === null ? record.basic : [...record.basic, { label: "Affiliation", value: affiliation, grade: null }];
	return (
		<Box sx={ROOT_SX}>
			{basic.length > 0 ? (
				<Box component="dl" sx={styles.fields}>
					{renderFields(basic, false)}
				</Box>
			) : null}
			{record.exam.length > 0 ? (
				<Box component="dl" sx={[styles.fields, { mt: 1.5 }]}>
					{renderFields(record.exam, true)}
				</Box>
			) : null}
			{trait || traitExtra ? (
				<Box sx={styles.trait}>
					{trait}
					{traitExtra ? (
						<Box component="span" sx={styles.traitExtra}>
							{traitExtra}
						</Box>
					) : null}
				</Box>
			) : null}
		</Box>
	);
}
