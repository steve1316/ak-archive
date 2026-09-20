import { useMemo } from "react";

import { Box, Button, Card, CardActionArea, CardContent, Container, Grid, Typography } from "@mui/material";
import { Link } from "react-router-dom";

import { searchIndex } from "../../lib/data.js";
import upstreamJson from "../../data/upstream.json";
import FeaturedOperatorCard from "./FeaturedOperatorCard.js";

/** Where the site's data was pulled from, written by `tools/data/import.mjs` to `src/data/upstream.json`. */
interface UpstreamInfo {
	/** The upstream repo this site's data was imported from, as `owner/name`. */
	repo: string;
	/** Which game server's tables were imported, such as `en`. */
	server: string;
	/** The commit sha the import is pinned to, in full. The page shows only the first ten characters of it. */
	sha: string;
	/** How many operators the import produced. */
	operators: number;
}

/** The upstream provenance record. A plain JSON import, so it costs nothing beyond `searchIndex` and never touches a shard. */
const upstream = upstreamJson as UpstreamInfo;

/** How many characters of the pinned sha the page shows. Enough to identify the commit without printing the full 40-character hash. */
const SHA_DISPLAY_LENGTH = 10;

/** How many six-star operators the carousel shows. Twelve fills a wide screen without the row growing unwieldy. */
const FEATURED_COUNT = 12;

/**
 * The home page: a hero, a featured operator carousel and entry cards into the index.
 *
 * The carousel and the counts below it read only `searchIndex` (31 KB) and `upstream.json`, both already in the bundle, and never call a
 * shard loader such as `loadAllOperators`. That is a hard requirement for this page: the index genuinely needs every operator to filter by
 * class, nation and tag, but the home page only ever shows a handful of names, so it has no reason to pull in the 508 KB of shard data the
 * index needs.
 *
 * @returns The page.
 */
export default function Home() {
	// The six-star entries, sorted by name and sliced to a fixed length. Sorting first (rather than slicing the array in its shard-grouped
	// upstream order) is what keeps every class represented instead of showing twelve snipers. The result never changes between renders or
	// between visits, since nothing here is random and the dependency array is empty: `searchIndex` is a module-level constant that never
	// changes identity once the bundle has loaded.
	const featured = useMemo(
		() =>
			searchIndex
				.filter((entry) => entry.rarity === 6)
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, FEATURED_COUNT),
		[]
	);

	// Same reasoning: derived once from the already-loaded search index rather than recomputed on every render.
	const { operatorCount, classCount } = useMemo(() => {
		const classes = new Set(searchIndex.map((entry) => entry.profession));
		return { operatorCount: searchIndex.length, classCount: classes.size };
	}, []);

	const shortSha = upstream.sha.slice(0, SHA_DISPLAY_LENGTH);

	return (
		<Container component="main" maxWidth="lg" sx={{ py: 3 }}>
			<Box sx={{ textAlign: "center", py: { xs: 4, md: 6 } }}>
				<Typography variant="h2" component="h1" sx={{ fontWeight: 700 }}>
					Arknights Archive
				</Typography>
				<Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, maxWidth: 640, mx: "auto" }}>
					A reference archive of every Arknights operator: stats, talents, potentials, skins and lore, pulled straight from the game's own data.
				</Typography>
			</Box>

			<Box component="section" sx={{ mb: 6 }}>
				<Typography variant="h5" component="h2" sx={{ mb: 2 }}>
					Featured operators
				</Typography>
				<Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1, scrollSnapType: "x proximity" }}>
					{featured.map((entry) => (
						<FeaturedOperatorCard key={entry.id} entry={entry} />
					))}
				</Box>
			</Box>

			<Grid container spacing={3} component="section">
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card sx={{ height: "100%" }}>
						<CardContent>
							<Typography variant="h3">{operatorCount}</Typography>
							<Typography variant="body2" color="text.secondary">
								Operators archived
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card sx={{ height: "100%" }}>
						<CardContent>
							<Typography variant="h3">{classCount}</Typography>
							<Typography variant="body2" color="text.secondary">
								Classes covered
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card sx={{ height: "100%" }}>
						<CardActionArea component={Link} to="/operators" sx={{ height: "100%" }}>
							<CardContent>
								<Typography variant="h6" component="p">
									Browse the index
								</Typography>
								<Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
									Filter by class, nation, tag and rarity across every operator.
								</Typography>
								<Button component="span" variant="outlined" size="small">
									Open operator index
								</Button>
							</CardContent>
						</CardActionArea>
					</Card>
				</Grid>
			</Grid>

			<Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 4 }}>
				Data from {upstream.repo}, {upstream.server} server, commit {shortSha}
			</Typography>
		</Container>
	);
}
