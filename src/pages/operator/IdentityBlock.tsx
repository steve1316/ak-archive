import { Box, Chip, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import RarityStars from "../../components/RarityStars.js";
import { classIconUrl } from "../../lib/assets.js";
import type { OperatorForm } from "../../lib/forms.js";
import type { Operator } from "../../types/operator.js";
import { BADGE_SX, CHIP_SELECTED_SX, CHIP_UNSELECTED_SX, HERO_CHIPS_SX, HERO_NAME_SX, HERO_SUBTITLE_SX } from "../../lib/layout.js";

/** The class icon inside the badge. */
const BADGE_ICON_SX: SxProps<Theme> = { width: 17, height: 17 };

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
			<Typography variant="h3" component="h1" sx={HERO_NAME_SX}>
				{operator.name} <Box component="span" sx={HERO_SUBTITLE_SX}>{`${operator.subProfession} — ${operator.position}`}</Box>
			</Typography>
			{forms.length > 1 ? (
				<Stack direction="row" useFlexGap sx={HERO_CHIPS_SX} role="group" aria-label="Forms">
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
