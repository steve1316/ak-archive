import { memo } from "react";

import { Box, Card, CardActionArea, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { ArtPlaceholder, ENEMY_CARD_ASPECT, HighlightedName } from "archive-kit";

import { enemyIconUrl, hasEnemyIcon } from "../../lib/assets.js";
import { enemyPath } from "../../lib/routes.js";
import { ENEMY_LEVEL_COLOURS } from "../../theme.js";
import type { Enemy } from "../../types/enemy.js";

/** The icon at its own square shape. The game draws each one on a transparent canvas, so it sits on the placeholder's fill. */
const ICON_SX: SxProps<Theme> = { width: "100%", aspectRatio: ENEMY_CARD_ASPECT, objectFit: "contain", display: "block", bgcolor: "action.hover" };

/** The stripe along the card's bottom edge, coloured by level the way the operator cards are coloured by rarity. */
const STRIPE_SX: SxProps<Theme> = { position: "absolute", left: 0, right: 0, bottom: 0, height: 3 };

/** Props for EnemyCard. */
interface EnemyCardProps {
	/** The enemy group to show. */
	enemy: Enemy;
	/** Where the current name search matched inside the head's name, from `findNameMatch`, or null when it did not or nothing is typed. */
	match: [number, number] | null;
}

/**
 * One enemy group in the index grid: icon, name, handbook index, level and how many variants sit behind it.
 *
 * Memoised because the index draws every match at once. Both props are stable across a re-render the card has no part in, as with
 * `OperatorCard`.
 *
 * @param props Component props.
 * @returns The card.
 */
export default memo(function EnemyCard({ enemy, match }: EnemyCardProps) {
	const extra = enemy.variants.length - 1;
	return (
		<Card sx={{ position: "relative", overflow: "hidden" }}>
			<CardActionArea component={Link} to={enemyPath(enemy.id)}>
				{hasEnemyIcon(enemy.id) ? (
					<Box component="img" src={enemyIconUrl(enemy.id)} alt={enemy.name} loading="lazy" sx={ICON_SX} />
				) : (
					<ArtPlaceholder name={enemy.name} aspect={ENEMY_CARD_ASPECT} />
				)}
				<Box sx={{ p: 1 }}>
					<Typography variant="subtitle2" noWrap title={enemy.name}>
						<HighlightedName name={enemy.name} match={match} />
					</Typography>
					<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
						{`${enemy.index} · ${enemy.level}`}
					</Typography>
					<Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", minHeight: "1.66em" }}>
						{extra > 0 ? `+${extra} variant${extra > 1 ? "s" : ""}` : ""}
					</Typography>
				</Box>
			</CardActionArea>
			<Box sx={[STRIPE_SX, { bgcolor: ENEMY_LEVEL_COLOURS[enemy.level] }]} />
		</Card>
	);
});
