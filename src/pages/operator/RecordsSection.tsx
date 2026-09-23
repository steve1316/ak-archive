import { memo } from "react";

import { Box, Chip, Paper, Typography } from "@mui/material";
import { Link } from "react-router-dom";

import { SECTION_HEADING_SX, SECTION_SX } from "../../lib/layout.js";
import { storyGroupPath } from "../../lib/routes.js";

/** Props for RecordsSection. */
interface RecordsSectionProps {
	/** The operator's record story sets. */
	records: { group: string; name: string }[];
}

/**
 * The operator's record stories, one chip per set, each opening that set's stories in the story picker.
 *
 * @param props Component props.
 * @returns The section, or nothing for an operator without records.
 */
function RecordsSection({ records }: RecordsSectionProps) {
	if (!records.length) {
		return null;
	}
	return (
		<Paper variant="outlined" sx={SECTION_SX} style={{ marginTop: 16 }}>
			<Typography component="h2" variant="h6" sx={SECTION_HEADING_SX}>
				Operator Records
			</Typography>
			<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
				{records.map((set) => (
					<Chip key={set.group} label={set.name} component={Link} to={storyGroupPath(set.group)} clickable />
				))}
			</Box>
		</Paper>
	);
}

export default memo(RecordsSection);
