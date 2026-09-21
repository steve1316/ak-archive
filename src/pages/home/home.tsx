import { useCallback, useMemo, useState } from "react";

import { Box, Button, Card, CardActionArea, CardActions, CardContent, CardMedia, Container, Grid, Grow, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { ScrollToTop } from "archive-kit";

import { hasPortrait, illustrationUrl } from "../../lib/assets.js";
import { searchIndex, upstream } from "../../lib/data.js";
import OperatorCarousel from "./OperatorCarousel.js";

/** How many characters of the pinned sha the page shows. Enough to identify the commit without printing the full 40-character hash. */
const SHA_DISPLAY_LENGTH = 10;

/** How many operators the carousel holds: four sets of three before it asks for a fresh pool. */
const CAROUSEL_SIZE = 12;

/** Every operator id with a hosted portrait, read once. A random pick from the whole roster could otherwise land on one of the 21 with none. */
const OPERATOR_IDS_WITH_PORTRAIT = searchIndex.filter((entry) => hasPortrait(entry.id)).map((entry) => entry.id);

const styles = {
	root: { py: 3 },
	// Padding lives inside the carousel, so its side buttons reach the hero's top and bottom edges.
	heroContent: { backgroundColor: "background.paper" },
	cardGrid: { py: 8 },
	card: { height: "100%", display: "flex", flexDirection: "column" },
	// 16:9, held open by padding because the image is a background.
	cardMedia: { paddingTop: "56.25%" },
	cardContent: { flexGrow: 1 },
	cardButton: { display: "flex", margin: "10px", justifyContent: "flex-end" }
} satisfies Record<string, SxProps<Theme>>;

/** Transform origin for each card's grow-in. A constant, since an inline object is a new prop every render. */
const GROW_STYLE = { transformOrigin: "0 0 0" };

/** Crops the operators card's 2048x2048 illustration in toward Amiya's face and shoulders. Tuned by eye to this one image only. */
const AMIYA_CROP_SX = { backgroundSize: "240%", backgroundPosition: "50% 18%" } satisfies SxProps<Theme>;

/**
 * Pick distinct operator ids with a portrait, uniformly at random.
 *
 * @param count How many ids to return.
 * @returns Up to `count` distinct ids.
 */
function randomOperatorIds(count: number): string[] {
	const pool = [...OPERATOR_IDS_WITH_PORTRAIT];
	for (let index = pool.length - 1; index > 0; index--) {
		const swap = Math.floor(Math.random() * (index + 1));
		[pool[index], pool[swap]] = [pool[swap] as string, pool[index] as string];
	}
	return pool.slice(0, count);
}

/**
 * The home page: a shuffling operator carousel and cards linking into each section.
 *
 * The carousel and the section card below it read only `searchIndex` (31 KB) and `upstream.json`, both already in the bundle, and never call a
 * shard loader such as `loadAllOperators`. That is a hard requirement for this page: the index genuinely needs every operator to filter by
 * class, nation and tag, but the home page only ever shows a handful of names, so it has no reason to pull the shard data the index needs:
 * 1122 KB raw and 116 KB gzipped, both measured from the production build at the pinned sha.
 *
 * @returns The page.
 */
export default function Home() {
	// Held in state rather than derived, so previous and next are real history rather than fresh rolls and the shuffle button can hand the
	// carousel a whole new set.
	const [carouselIds, setCarouselIds] = useState(() => randomOperatorIds(CAROUSEL_SIZE));

	// Stable, so the memoised carousel does not re-render whenever the home page does.
	const reshuffle = useCallback(() => setCarouselIds(randomOperatorIds(CAROUSEL_SIZE)), []);

	const operatorCount = useMemo(() => searchIndex.length, []);

	// Amiya is the game's lead, so her illustration is the curated art for the one section card rather than an arbitrary pick.
	const amiyaArt = useMemo(() => illustrationUrl("char_002_amiya"), []);

	const shortSha = upstream.sha.slice(0, SHA_DISPLAY_LENGTH);

	return (
		<Box component="main" sx={styles.root}>
			<ScrollToTop />

			{/* Hero Unit */}
			<Box sx={{ boxShadow: 1 }}>
				{/* No container here: the carousel spans the hero, since each side of it is a button. */}
				<Box component="div" sx={styles.heroContent}>
					<OperatorCarousel ids={carouselIds} onShuffle={reshuffle} />
				</Box>
			</Box>
			{/* End of Hero Unit */}

			{/* Cards Section for Navigation */}
			<Container sx={styles.cardGrid} maxWidth="md">
				<Grid container spacing={4}>
					<Grid size={{ xs: 12, sm: 6, md: 4 }}>
						<Grow in style={GROW_STYLE} timeout={600}>
							<Card sx={styles.card}>
								{/* The artwork links to the section too, with a name for screen readers. */}
								<CardActionArea component={Link} to="/operators" aria-label="Operators">
									<CardMedia sx={[styles.cardMedia, AMIYA_CROP_SX]} image={amiyaArt} title="Operators" />
								</CardActionArea>
								<CardContent sx={styles.cardContent}>
									<Typography component="h2" variant="h5" gutterBottom>
										Operators
									</Typography>
									<Typography color="textSecondary">
										Browse all {operatorCount} operators: stats, talents, potentials, skins and lore, pulled straight from the game's own data.
									</Typography>
								</CardContent>
								<CardActions sx={styles.cardButton}>
									{/* One link styled as a button, rather than a button nested inside a link, with a name for screen readers. */}
									<Button component={Link} to="/operators" size="small" variant="contained" color="primary" aria-label="Open Operators">
										<ArrowForwardIcon />
									</Button>
								</CardActions>
							</Card>
						</Grow>
					</Grid>
				</Grid>
			</Container>
			{/* End of Cards Section */}

			<Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 4 }}>
				Data from {upstream.repo}, {upstream.server} server, commit {shortSha}
			</Typography>
		</Box>
	);
}
