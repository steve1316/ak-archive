import { useCallback, useMemo, useState } from "react";

import { alpha, Box, Button, Card, CardActionArea, CardActions, CardContent, Container, Grid, Grow, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { ScrollToTop } from "archive-kit";

import { classIconUrl, hasPortrait } from "../../lib/assets.js";
import { searchIndex } from "../../lib/data.js";
import OperatorCarousel from "./OperatorCarousel.js";

/** How many operators the carousel holds: four sets of three before it asks for a fresh pool. */
const CAROUSEL_SIZE = 12;

/** Every operator id with a hosted portrait, read once, so a random pick can never land on an operator whose portrait is missing. */
const OPERATOR_IDS_WITH_PORTRAIT = searchIndex.filter((entry) => hasPortrait(entry.id)).map((entry) => entry.id);

const styles = {
	root: { py: 3 },
	// Padding lives inside the carousel, so its side buttons reach the hero's top and bottom edges.
	heroContent: { backgroundColor: "background.paper" },
	cardGrid: { py: 8 },
	card: { height: "100%", display: "flex", flexDirection: "column" },
	// 16:9, held open by padding, with the class icons laid over it.
	cardMedia: { position: "relative", paddingTop: "56.25%" },
	cardContent: { flexGrow: 1 },
	cardButton: { display: "flex", margin: "10px", justifyContent: "flex-end" }
} satisfies Record<string, SxProps<Theme>>;

/** Transform origin for each card's grow-in. A constant, since an inline object is a new prop every render. */
const GROW_STYLE = { transformOrigin: "0 0 0" };

/** The 8 classes in the game's own order, shown as the Operator Index card's art. */
const CLASSES = ["Vanguard", "Guard", "Defender", "Sniper", "Caster", "Medic", "Supporter", "Specialist"] as const;

/** The class icon grid, filling the card's 16:9 media box over a glow in the site's accent colour. */
const CLASS_GRID_SX: SxProps<Theme> = {
	position: "absolute",
	inset: 0,
	display: "grid",
	gridTemplateColumns: "repeat(4, 1fr)",
	gap: 1.25,
	px: 4.25,
	py: 2.25,
	background: (theme) => `radial-gradient(circle at 50% 40%, ${alpha(theme.palette.primary.main, 0.3)}, ${theme.palette.background.default} 70%)`
};

/** One class icon in the grid, scaled to fit its cell. */
const CLASS_ICON_SX: SxProps<Theme> = { width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 };

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
 * The carousel and the section card below it read only `searchIndex` (31 KB), already in the bundle, and never call a
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

	const classIcons = useMemo(() => CLASSES.map((name) => ({ name, url: classIconUrl(name) })), []);

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
								<CardActionArea component={Link} to="/operators" aria-label="Operator Index">
									<Box sx={styles.cardMedia}>
										<Box sx={CLASS_GRID_SX}>
											{classIcons.map((icon) => (
												<Box key={icon.name} component="img" src={icon.url} alt="" sx={CLASS_ICON_SX} />
											))}
										</Box>
									</Box>
								</CardActionArea>
								<CardContent sx={styles.cardContent}>
									<Typography component="h2" variant="h5" gutterBottom>
										Operator Index
									</Typography>
									<Typography color="textSecondary">View Index of Operators along with additional information like statistics, skills and chibi animations.</Typography>
								</CardContent>
								<CardActions sx={styles.cardButton}>
									{/* One link styled as a button, rather than a button nested inside a link, with a name for screen readers. */}
									<Button component={Link} to="/operators" size="small" variant="contained" color="primary" aria-label="Open Operator Index">
										<ArrowForwardIcon />
									</Button>
								</CardActions>
							</Card>
						</Grow>
					</Grid>
				</Grid>
			</Container>
			{/* End of Cards Section */}
		</Box>
	);
}
