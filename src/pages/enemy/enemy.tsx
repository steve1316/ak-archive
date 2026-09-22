import { useCallback, useEffect, useState } from "react";

import { Box, Paper, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useParams, useSearchParams } from "react-router-dom";

import { ArtPlaceholder, ENEMY_CARD_ASPECT, LoadError, PageBackdrop, ScrollToTop } from "archive-kit";

import AnimationsCard from "../../components/AnimationsCard.js";
import type { StageRequest } from "../../components/AnimationsCard.js";
import RecordBlock from "../../components/RecordBlock.js";
import { enemyIconUrl, hasEnemyIcon } from "../../lib/assets.js";
import { loadEnemyGroup } from "../../lib/data.js";
import { HERO_ROW_SX, PAGE_SX, SECTION_HEADING_SX, SECTION_SX, STATS_ROW_STRETCH_SX, STATS_SIDE_COLUMN_SX, TIGHT_RADIUS } from "../../lib/layout.js";
import { enemyNumber, VARIANT_PARAM, variantFromKey, variantKey } from "../../lib/routes.js";
import NotFound404 from "../../not_found_404.js";
import type { Enemy, EnemyDetails } from "../../types/enemy.js";
import type { HandbookRecord } from "../../types/operator.js";
import EnemyAbilitiesCard from "./EnemyAbilitiesCard.js";
import EnemyIdentityBlock from "./EnemyIdentityBlock.js";
import EnemySpineStage from "./EnemySpineStage.js";
import EnemyStatsPanel from "./EnemyStatsPanel.js";

/** The icon's width, matching the first track of `HERO_ROW_SX`, which is the operator page's art card. */
const ICON_WIDTH = 180;

/** Row 1: icon, then identity and record, then Animations. The shared row plus the gap to row 2, which this page has no fold grid to set. */
const ROW1_SX: SxProps<Theme> = { ...HERO_ROW_SX, mb: 2 };

/** The icon. The game draws it on a transparent canvas, so it sits on a card-coloured square. */
const ICON_SX: SxProps<Theme> = {
	display: "block",
	width: ICON_WIDTH,
	aspectRatio: ENEMY_CARD_ASPECT,
	objectFit: "contain",
	border: 1,
	borderColor: "divider",
	borderRadius: TIGHT_RADIUS,
	bgcolor: "background.paper",
	justifySelf: { xs: "center", md: "start" }
};

/** The handbook's lore paragraph. */
const LORE_SX: SxProps<Theme> = { fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-line", maxWidth: "80ch" };

/**
 * The record fields for one variant, in the shape `RecordBlock` draws.
 *
 * @param details The variant's details.
 * @returns The fields. Race is left out, since the name line already shows it, and enemies have no physical exam, so `exam` is always empty.
 */
function recordOf(details: EnemyDetails): HandbookRecord {
	const field = (label: string, value: string) => ({ label, value, grade: null });
	return {
		basic: [field("Attack", details.attack), field("Damage", details.damage.join(", ")), field("Movement", details.motion)],
		exam: []
	};
}

/**
 * The enemy detail page: the same two rows as the operator page, then the handbook's lore.
 *
 * A group's page is `/enemy/<number>`, the head's number, such as `/enemy/1007`. The selected variant lives in the query string by the number
 * its id adds, such as `?variant=2` for Originium Slug α, as the operator page keeps its form in `?skin=`, and switching replaces the history
 * entry. `CanonicalRoute` has already put the address in that short form before this page mounts.
 *
 * @returns The page.
 */
export default function EnemyPage() {
	const param = useParams().id;
	const [searchParams, setSearchParams] = useSearchParams();

	const [group, setGroup] = useState<{ enemy: Enemy; details: Record<string, EnemyDetails> } | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState(false);
	// Bumped by the retry button to run the load again.
	const [attempt, setAttempt] = useState(0);
	const [level, setLevel] = useState(0);

	useEffect(() => {
		if (!param) {
			setMissing(true);
			return;
		}
		let active = true;
		setGroup(null);
		setMissing(false);
		setError(false);
		loadEnemyGroup((enemy) => enemyNumber(enemy.id) === param).then(
			(loaded) => {
				if (!active) {
					return;
				}
				if (!loaded) {
					setMissing(true);
					return;
				}
				setGroup(loaded);
			},
			() => {
				if (active) {
					setError(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [param, attempt]);

	// The selected variant: the query string's, when it names one of this group's, otherwise the head, which the importer always lists first.
	const requested = group ? variantFromKey(group.enemy.id, searchParams.get(VARIANT_PARAM)) : undefined;
	const variant = group?.enemy.variants.find((entry) => entry.id === requested) ?? group?.enemy.variants[0];
	const details = variant ? group?.details[variant.id] : undefined;
	// A level past the new variant's last falls back to level 0 in this same render, rather than an effect that resets it after paint.
	const shownLevel = details && level < details.levels.length ? level : 0;

	const handleRetry = useCallback(() => setAttempt((current) => current + 1), []);

	const handleVariantChange = useCallback(
		(next: string) => {
			setSearchParams(
				(current) => {
					const params = new URLSearchParams(current);
					const key = group ? variantKey(group.enemy.id, next) : null;
					if (key === null) {
						params.delete(VARIANT_PARAM);
					} else {
						params.set(VARIANT_PARAM, key);
					}
					return params;
				},
				{ replace: true }
			);
		},
		[group, setSearchParams]
	);

	// Draws the Animations card's stage: the selected variant's chibi. Keyed by the variant inside the stage, so a switch loads its own rig.
	const renderStage = useCallback(
		({ onStatus }: StageRequest) => (variant ? <EnemySpineStage enemyId={variant.id} iconUrl={hasEnemyIcon(variant.id) ? enemyIconUrl(variant.id) : null} onStatus={onStatus} /> : null),
		[variant]
	);

	if (missing) {
		return <NotFound404 />;
	}

	return (
		<Box component="main">
			<PageBackdrop artUrl={undefined} />
			<ScrollToTop />
			<Box sx={PAGE_SX}>
				{error || (group && !details) ? (
					<LoadError what="this enemy" onRetry={handleRetry} titleComponent="h1" />
				) : group && variant && details ? (
					<>
						<Box sx={ROW1_SX}>
							{hasEnemyIcon(variant.id) ? (
								<Box component="img" src={enemyIconUrl(variant.id)} alt={variant.name} sx={ICON_SX} />
							) : (
								<ArtPlaceholder name={variant.name} aspect={ENEMY_CARD_ASPECT} sx={{ width: ICON_WIDTH }} />
							)}
							<Box sx={{ minWidth: 0 }}>
								<EnemyIdentityBlock
									name={variant.name}
									index={variant.index}
									level={details.level}
									races={details.races}
									releaseDate={details.releaseDate}
									debut={details.debut}
									variants={group.enemy.variants}
									variantId={variant.id}
									onVariantChange={handleVariantChange}
								/>
								<RecordBlock record={recordOf(details)} affiliation={null} trait={details.description} />
							</Box>
							<AnimationsCard key={group.enemy.id} interactive battleOnly renderStage={renderStage} />
						</Box>
						<Box sx={STATS_ROW_STRETCH_SX}>
							<EnemyStatsPanel levels={details.levels} level={shownLevel} onLevelChange={setLevel} />
							<Box sx={STATS_SIDE_COLUMN_SX}>
								<EnemyAbilitiesCard abilities={details.abilities} />
								<Paper variant="outlined" sx={SECTION_SX}>
									<Typography variant="h6" component="h2" sx={SECTION_HEADING_SX}>
										Handbook
									</Typography>
									<Typography component="p" sx={LORE_SX}>
										{details.lore}
									</Typography>
								</Paper>
							</Box>
						</Box>
					</>
				) : (
					<Typography variant="body1" color="text.secondary" role="status">
						Loading...
					</Typography>
				)}
			</Box>
		</Box>
	);
}
