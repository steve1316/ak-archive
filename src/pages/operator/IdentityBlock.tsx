import { Box, Chip, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import RarityStars from "../../components/RarityStars.js";
import { classIconUrl } from "../../lib/assets.js";
import type { OperatorForm } from "../../lib/forms.js";
import type { Operator } from "../../types/operator.js";

/** The class badge: the published class icon beside the class name, on the raised surface the mockup sits it on. */
const BADGE_SX: SxProps<Theme> = {
	display: "inline-flex",
	alignItems: "center",
	gap: 0.875,
	px: 1.125,
	py: 0.375,
	border: 1,
	borderColor: "divider",
	borderRadius: "3px",
	backgroundColor: (theme) => theme.palette.raised ?? theme.palette.background.paper,
	fontWeight: 600,
	fontSize: 13
};

/** The class icon inside the badge. */
const BADGE_ICON_SX: SxProps<Theme> = { width: 17, height: 17 };

/** The name. */
const NAME_SX: SxProps<Theme> = { fontWeight: 700, lineHeight: 1.15, mt: 0.625 };

/** Subclass and position, set small beside the name. */
const SUBTITLE_SX: SxProps<Theme> = { fontSize: 14, fontWeight: 400, color: "text.secondary", ml: 1.25 };

/** The chip row. */
const CHIPS_SX: SxProps<Theme> = { flexWrap: "wrap", gap: 0.625, mt: 1.25 };

/**
 * An unselected chip: the mockup's square-cornered outline on the same low-contrast fill as the rest of the fold's cards. Hover and focus lift
 * it to the raised-surface colour rather than MUI's default light overlay, which washes out white against a fill this dark.
 */
const CHIP_UNSELECTED_SX: SxProps<Theme> = (theme) => ({
	border: "1px solid",
	borderColor: "divider",
	borderRadius: "3px",
	backgroundColor: "rgba(13, 14, 18, 0.55)",
	color: "text.secondary",
	fontWeight: 400,
	"&:hover, &.Mui-focusVisible": { backgroundColor: theme.palette.raised ?? theme.palette.background.paper, borderColor: "text.secondary" }
});

/**
 * A selected chip: the primary fill and border in every state. A clickable MUI chip's own `:hover` and `.Mui-focusVisible` rules are more
 * specific than a plain `backgroundColor`, so hover and focus are pinned here explicitly rather than left to fall through to the default grey
 * overlay - the bug fix round 1 left behind.
 */
const CHIP_SELECTED_SX: SxProps<Theme> = (theme) => ({
	border: "1px solid",
	borderColor: "primary.main",
	borderRadius: "3px",
	backgroundColor: "primary.main",
	color: theme.palette.primary.contrastText,
	fontWeight: 600,
	"&:hover, &.Mui-focusVisible": { backgroundColor: "primary.dark", borderColor: "primary.dark" }
});

/** Props for IdentityBlock. */
interface IdentityBlockProps {
	/** The loaded operator. */
	operator: Operator;
	/** The operator's forms, from `formsOf`. */
	forms: OperatorForm[];
	/** The selected form's key, or null when the operator has no forms. */
	formKey: string | null;
	/** Called with a form's key when its chip is picked. */
	onFormChange: (key: string) => void;
}

/**
 * Class badge, rarity, name with subclass, then the form chips - the order gfl's doll hero uses. The chip row is left out when there is only one
 * form, since a lone "Base" chip switches nothing.
 *
 * @param props Component props.
 * @returns The block.
 */
export default function IdentityBlock({ operator, forms, formKey, onFormChange }: IdentityBlockProps) {
	return (
		<Box sx={{ minWidth: 0 }}>
			<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
				<Box sx={BADGE_SX}>
					<Box component="img" src={classIconUrl(operator.profession)} alt="" sx={BADGE_ICON_SX} />
					{operator.profession}
				</Box>
				<RarityStars rarity={operator.rarity} variant="body1" />
			</Stack>
			<Typography variant="h3" component="h1" sx={NAME_SX}>
				{operator.name} <Box component="span" sx={SUBTITLE_SX}>{`${operator.subProfession} — ${operator.position}`}</Box>
			</Typography>
			{forms.length > 1 ? (
				<Stack direction="row" useFlexGap sx={CHIPS_SX} role="group" aria-label="Forms">
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
				</Stack>
			) : null}
		</Box>
	);
}
