import { memo } from "react";

import { Box, Card, CardContent, Chip, Typography } from "@mui/material";
import { Link } from "react-router-dom";

/** Props for RecordsSection. */
interface RecordsSectionProps {
	/** The operator's record story sets. */
	records: { group: string; name: string }[];
}

/**
 * The operator's record stories, one chip per set, each opening that set's stories in the story picker.
 *
 * @param props Component props.
 * @returns The card, or nothing for an operator without records.
 */
function RecordsSection({ records }: RecordsSectionProps) {
	if (!records.length) {
		return null;
	}
	return (
		<Card sx={{ mt: 2 }}>
			<CardContent>
				<Typography component="h2" variant="h6" gutterBottom>
					Operator Records
				</Typography>
				<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
					{records.map((set) => (
						<Chip key={set.group} label={set.name} component={Link} to={`/stories/${set.group}`} clickable />
					))}
				</Box>
			</CardContent>
		</Card>
	);
}

export default memo(RecordsSection);
