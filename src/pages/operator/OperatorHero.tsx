import { Box, Button, Typography } from "@mui/material";
import { Link } from "react-router-dom";

import OperatorArtCard from "../../components/OperatorArtCard.js";
import RarityStars from "../../components/RarityStars.js";
import { hasIllustration } from "../../lib/assets.js";
import type { Operator } from "../../types/operator.js";

/** Props for OperatorHero. */
interface OperatorHeroProps {
	/** The operator the hero introduces. */
	operator: Operator;
}

/**
 * The operator page's hero: the portrait, the name, the rarity stars, the class line, the affiliations and the trait.
 *
 * The portrait is the same `OperatorArtCard` the index grid and the home carousel draw, so the page reads as the same site rather than a
 * bolted-on detail view.
 *
 * @param props Component props.
 * @returns The hero block.
 */
export default function OperatorHero({ operator }: OperatorHeroProps) {
	const affiliations = [operator.nation, operator.group, operator.team].filter((value): value is string => value !== null);

	return (
		<Box>
			<OperatorArtCard id={operator.id} name={operator.name} rarity={operator.rarity} />
			<Box sx={{ mt: 2 }}>
				<Typography variant="h4" component="h1">
					{operator.name}
				</Typography>
				<RarityStars rarity={operator.rarity} variant="h6" sx={{ lineHeight: 1 }} />
				<Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
					{operator.profession} / {operator.subProfession} / {operator.position}
				</Typography>
				{affiliations.length > 0 ? (
					<Typography variant="body2" color="text.secondary">
						{affiliations.join(" · ")}
					</Typography>
				) : null}
				{operator.description ? (
					<Typography variant="body2" sx={{ mt: 1.5 }}>
						{operator.description}
					</Typography>
				) : null}
				{hasIllustration(operator.id) ? (
					<Button component={Link} to={`/operator/${operator.id}/art`} variant="outlined" sx={{ mt: 2 }}>
						View full art
					</Button>
				) : null}
			</Box>
		</Box>
	);
}
