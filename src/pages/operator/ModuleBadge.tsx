import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { hasModuleType, moduleTypeUrl } from "../../lib/assets.js";
import type { OperatorModule } from "../../types/operator.js";

/** The badge glyph, sized to sit inline before a module code. */
const BADGE_SX: SxProps<Theme> = { width: 20, height: "auto", mr: 0.75, verticalAlign: "middle" };

/** Props for ModuleBadge. */
interface ModuleBadgeProps {
	/** The module whose branch badge to draw. */
	module: OperatorModule;
}

/**
 * A module's branch badge followed by its code, such as the SWO-X glyph then `SWO-X`. The glyph is left out when it was not published.
 *
 * @param props Component props.
 * @returns The badge and code.
 */
export default function ModuleBadge({ module }: ModuleBadgeProps) {
	return (
		<>
			{hasModuleType(module.typeIcon) ? <Box component="img" src={moduleTypeUrl(module.typeIcon)} alt="" sx={BADGE_SX} /> : null}
			{module.code}
		</>
	);
}
