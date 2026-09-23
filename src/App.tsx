import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { CssBaseline, ThemeProvider } from "@mui/material";
import { Route, Routes, useLocation } from "react-router-dom";

import { ArchiveNavbar, ErrorBoundary, ScrollToTopOnNavigate, normaliseName } from "archive-kit";
import type { NavItem, SearchOption } from "archive-kit";

import { glyphIconUrl } from "./lib/icons.js";
import { loadEnemySearchIndex, searchIndex } from "./lib/data.js";
import { canonicalEnemyPath, canonicalOperatorPath, enemyPath, operatorPath } from "./lib/routes.js";
import CanonicalRoute from "./components/CanonicalRoute.js";
import NotFound404 from "./not_found_404.js";
import Home from "./pages/home/home.js";
import { theme } from "./theme.js";

/**
 * The operator index and page load on first visit, like every route but the home page, so a reader landing on the home page does not also
 * download the operator page's stats controls and tabs.
 */
const OperatorIndex = lazy(() => import("./pages/operator_index/operator_index.js"));
const Operator = lazy(() => import("./pages/operator/operator.js"));

/** The art viewer loads on first visit. Few readers open it, and it would otherwise add its zoom and pan code to every route. */
const OperatorArt = lazy(() => import("./pages/operator_art/operator_art.js"));

/** The enemy index and pages load on first visit, so the operator routes do not carry their code. */
const EnemyIndex = lazy(() => import("./pages/enemy_index/enemy_index.js"));
const EnemyPage = lazy(() => import("./pages/enemy/enemy.js"));

/** The story routes load on first visit. The player pulls one story file at a time, none of which any other route needs. */
const Stories = lazy(() => import("./pages/stories/stories.js"));
const Story = lazy(() => import("./pages/story/story.js"));

/** The dev-only Spine rig lab. Guarded here too, not just at the route, so a production build's tree-shaking drops the import entirely. */
const SpineLab = import.meta.env.DEV ? lazy(() => import("./pages/spine_lab/spine_lab.js")) : null;

/**
 * The canonical address for an operator's art viewer.
 *
 * @param param The route's `:id` parameter.
 * @returns The canonical route, or undefined for an unknown operator.
 */
const canonicalOperatorArtPath = (param: string | undefined) => canonicalOperatorPath(param, "/art");

/** Path data of MUI's `Home` icon, the house the kit's top bar shows, so the drawer's Home entry matches it. */
const HOME_GLYPH = "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z";

/** Path data of MUI's `Groups` icon, for the Operator Index entry. */
const GROUPS_GLYPH =
	"M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91M4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29M20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3";

/** Path data of MUI's `GpsFixed` icon, a crosshair, for the Enemy Index entry. */
const ENEMY_GLYPH =
	"M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7";

/** Path data of MUI's `MenuBook` icon, an open book, for the Stories entry. */
const BOOK_GLYPH =
	"M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1m0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5z";

/** The drawer's destinations, each drawn as a plain glyph in the theme's text colour. */
const NAV_ITEMS: readonly NavItem[] = [
	{ title: "Home", link: "/", icon: glyphIconUrl(HOME_GLYPH, theme.palette.text.primary) },
	{ title: "Operator Index", link: "/operators", icon: glyphIconUrl(GROUPS_GLYPH, theme.palette.text.primary) },
	{ title: "Enemy Index", link: "/enemies", icon: glyphIconUrl(ENEMY_GLYPH, theme.palette.text.primary) },
	{ title: "Stories", link: "/stories", icon: glyphIconUrl(BOOK_GLYPH, theme.palette.text.primary) }
];

/**
 * Operator search options, built from the search index, which is 31 KB and already in the bundle. The navbar renders on every route, so this
 * must never touch a shard.
 */
const OPERATOR_OPTIONS: SearchOption[] = searchIndex.map((entry) => ({ path: operatorPath(entry.id), name: entry.name, keys: [normaliseName(entry.name)] }));

/** How long to wait before prefetching on a browser with no `requestIdleCallback`, such as Safari. */
const PREFETCH_FALLBACK_MS = 2000;

/**
 * Fetch the operator index and page chunks ahead of time. Most readers go there next, and without this the first click waits for the chunk
 * before the page can even start fetching its data.
 */
function prefetchOperatorRoutes() {
	void import("./pages/operator_index/operator_index.js");
	void import("./pages/operator/operator.js");
}

/**
 * The application shell: the theme, the navbar and one route per page.
 *
 * @returns The routed app.
 */
export default function App() {
	const { pathname } = useLocation();

	// Enemies join the search once their index arrives. It is 101 KB, three times the operator index, so it is fetched only when the search box
	// takes focus, which most visits never do. A failed fetch leaves operator search working and is retried on the next focus.
	const [enemyOptions, setEnemyOptions] = useState<SearchOption[]>([]);
	const enemiesLoaded = enemyOptions.length > 0;
	const handleSearchFocus = useCallback(() => {
		if (enemiesLoaded) {
			return;
		}
		loadEnemySearchIndex().then(
			(entries) => setEnemyOptions(entries.map((entry) => ({ path: enemyPath(entry.group ?? entry.id, entry.id), name: entry.name, keys: [normaliseName(entry.name)], tag: "Enemy" }))),
			() => undefined
		);
	}, [enemiesLoaded]);

	const searchOptions = useMemo<SearchOption[]>(() => [...OPERATOR_OPTIONS, ...enemyOptions], [enemyOptions]);

	// The operator routes load on demand to keep the startup script small, and are fetched once the first page is idle so a click stays instant.
	useEffect(() => {
		if (typeof window.requestIdleCallback === "function") {
			const handle = window.requestIdleCallback(prefetchOperatorRoutes);
			return () => window.cancelIdleCallback(handle);
		}
		const timer = window.setTimeout(prefetchOperatorRoutes, PREFETCH_FALLBACK_MS);
		return () => window.clearTimeout(timer);
	}, []);

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<ArchiveNavbar title="Arknights Archive" navItems={NAV_ITEMS} searchOptions={searchOptions} homeLink="/" searchLabel="Search operators and enemies" onSearchFocus={handleSearchFocus} />
			<ScrollToTopOnNavigate>
				{/*
				 * Keyed on the path so a caught throw is forgotten on the next navigation. Without the key the boundary stays in its error
				 * state for the rest of the session, and every later route renders the fallback instead of the page the reader asked for.
				 */}
				<ErrorBoundary key={pathname} fallback={<NotFound404 />}>
					<Routes>
						<Route path="/" element={<Home />} />
						<Route
							path="/operators"
							element={
								<Suspense>
									<OperatorIndex />
								</Suspense>
							}
						/>
						<Route
							path="/operator/:id/art"
							element={
								<CanonicalRoute canonicalPath={canonicalOperatorArtPath}>
									<Suspense>
										<OperatorArt />
									</Suspense>
								</CanonicalRoute>
							}
						/>
						<Route
							path="/operator/:id"
							element={
								<CanonicalRoute canonicalPath={canonicalOperatorPath}>
									<Suspense>
										<Operator />
									</Suspense>
								</CanonicalRoute>
							}
						/>
						{import.meta.env.DEV && SpineLab ? (
							<Route
								path="/spine-lab"
								element={
									<Suspense>
										<SpineLab />
									</Suspense>
								}
							/>
						) : null}
						<Route
							path="/enemies"
							element={
								<Suspense>
									<EnemyIndex />
								</Suspense>
							}
						/>
						<Route
							path="/enemy/:id"
							element={
								<CanonicalRoute canonicalPath={canonicalEnemyPath}>
									<Suspense>
										<EnemyPage />
									</Suspense>
								</CanonicalRoute>
							}
						/>
						<Route
							path="/stories"
							element={
								<Suspense>
									<Stories />
								</Suspense>
							}
						/>
						<Route
							path="/stories/:group"
							element={
								<Suspense>
									<Stories />
								</Suspense>
							}
						/>
						<Route
							path="/story/:group/:story"
							element={
								<Suspense>
									<Story />
								</Suspense>
							}
						/>
						<Route path="/404" element={<NotFound404 />} />
						{/* Anything unmatched shows the 404 in place, keeping the mistyped address visible. */}
						<Route path="*" element={<NotFound404 />} />
					</Routes>
				</ErrorBoundary>
			</ScrollToTopOnNavigate>
		</ThemeProvider>
	);
}
