import type { ReactNode } from "react";

import { Box, Chip, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import RarityStars from "../../components/RarityStars.js";
import { classIconUrl } from "../../lib/assets.js";
import type { OperatorForm } from "../../lib/forms.js";
import type { OperatorFull } from "../../types/operator.js";
import { BADGE_SX, CHIP_SELECTED_SX, CHIP_UNSELECTED_SX, GROUP_HEADING_SX, HERO_CHIP_ROW_SX, HERO_DEBUT_SX, HERO_NAME_SX, HERO_RELEASE_SX, HERO_SUBTITLE_SX } from "../../lib/layout.js";
import { storyGroupPath } from "../../lib/routes.js";

/** The class icon inside the badge. */
const BADGE_ICON_SX: SxProps<Theme> = { width: 17, height: 17 };

/** The stack of labelled chip rows under the name, spaced as the lone hero chip row is. */
const CHIP_ROWS_SX: SxProps<Theme> = { mt: 1.25 };

/** One labelled row: the label, then its chips wrapping beside it. */
const CHIP_ROW_SX: SxProps<Theme> = { display: "flex", alignItems: "flex-start" };

/** A row's label in group-heading small caps. A fixed width lines up the stacked rows, and its line height matches a small chip. */
const CHIP_LABEL_SX: SxProps<Theme> = { ...GROUP_HEADING_SX, mb: 0, fontWeight: 400, flex: "none", width: 64, lineHeight: "24px" };

/** Props for LabelledChipRow. */
interface LabelledChipRowProps {
	/** The row's label, also its accessible group name. */
	label: string;
	/** The row's chips. */
	children: ReactNode;
}

/**
 * A row of hero chips behind a small label, so the skin and record rows read apart while their chips line up.
 *
 * @param props Component props.
 * @returns The row.
 */
function LabelledChipRow({ label, children }: LabelledChipRowProps) {
	return (
		<Box sx={CHIP_ROW_SX}>
			<Box component="span" sx={CHIP_LABEL_SX} aria-hidden>
				{label}
			</Box>
			<Stack direction="row" useFlexGap sx={HERO_CHIP_ROW_SX} role="group" aria-label={label}>
				{children}
			</Stack>
		</Box>
	);
}

/** Props for IdentityBlock. */
interface IdentityBlockProps {
	/** The loaded operator, with its details for the record chips. */
	operator: OperatorFull;
	/** The operator's forms, from `formsOf`. */
	forms: OperatorForm[];
	/** The selected form's key, or null when the operator has no forms. */
	formKey: string | null;
	/** Called with a form's key when its chip is picked. */
	onFormChange: (key: string) => void;
}

/**
 * Class badge, rarity, name with subclass, then the form chips - the order gfl's doll hero uses. The skin row is left out when there is only one
 * form, since a lone "Base" chip switches nothing. The record row under it is left out for an operator without records. Under the name sits the
 * release line, with the selected outfit's own release under that.
 *
 * @param props Component props.
 * @returns The block.
 */
export default function IdentityBlock({ operator, forms, formKey, onFormChange }: IdentityBlockProps) {
	const { records } = operator;
	const showForms = forms.length > 1;
	const outfitDate = forms.find((form) => form.key === formKey)?.releaseDate ?? null;
	return (
		<Box sx={{ minWidth: 0 }}>
			<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
				<Box sx={BADGE_SX}>
					<Box component="img" src={classIconUrl(operator.profession)} alt="" sx={BADGE_ICON_SX} />
					{operator.profession}
				</Box>
				<RarityStars rarity={operator.rarity} variant="body1" />
			</Stack>
			<Typography variant="h3" component="h1" sx={HERO_NAME_SX}>
				{operator.name} <Box component="span" sx={HERO_SUBTITLE_SX}>{`${operator.subProfession} — ${operator.position}`}</Box>
			</Typography>
			<Box component="p" sx={HERO_RELEASE_SX}>{`Global release: ${operator.releaseDate ?? "Unknown"}`}</Box>
			{outfitDate ? <Box component="p" sx={HERO_DEBUT_SX}>{`Outfit release: ${outfitDate}`}</Box> : null}
			{showForms || records.length ? (
				<Stack spacing={0.75} sx={CHIP_ROWS_SX}>
					{showForms ? (
						<LabelledChipRow label="Skins">
							{forms.map((form) => {
								const selected = form.key === formKey;
								return (
									<Chip
										key={form.key}
										label={form.name}
										size="small"
										clickable
										aria-pressed={selected}
										onClick={() => onFormChange(form.key)}
										sx={selected ? CHIP_SELECTED_SX : CHIP_UNSELECTED_SX}
									/>
								);
							})}
						</LabelledChipRow>
					) : null}
					{records.length ? (
						<LabelledChipRow label="Records">
							{records.map((set) => (
								<Chip key={set.group} label={set.name} size="small" component={Link} to={storyGroupPath(set.group)} clickable sx={CHIP_UNSELECTED_SX} />
							))}
						</LabelledChipRow>
					) : null}
				</Stack>
			) : null}
		</Box>
	);
}
