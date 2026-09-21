import { lazy, Suspense, useMemo } from "react";

import { CssBaseline, ThemeProvider } from "@mui/material";
import { Route, Routes, useLocation } from "react-router-dom";

import { ArchiveNavbar, ErrorBoundary, ScrollToTopOnNavigate, normaliseName } from "archive-kit";
import type { NavItem, SearchOption } from "archive-kit";

import { classIconUrl } from "./lib/assets.js";
import { searchIndex } from "./lib/data.js";
import { operatorPath } from "./lib/routes.js";
import CanonicalOperatorRoute from "./components/CanonicalOperatorRoute.js";
import NotFound404 from "./not_found_404.js";
import Home from "./pages/home/home.js";
import Operator from "./pages/operator/operator.js";
import OperatorIndex from "./pages/operator_index/operator_index.js";
import { theme } from "./theme.js";

/** The art viewer loads on first visit. Few readers open it, and it would otherwise add its zoom and pan code to every route. */
const OperatorArt = lazy(() => import("./pages/operator_art/operator_art.js"));

/** The drawer's destinations. Icons resolve to asset-host paths that 404 until the A3 pipeline publishes the class icons. */
const NAV_ITEMS: readonly NavItem[] = [
	{ title: "Home", link: "/", icon: classIconUrl("Guard") },
	{ title: "Operators", link: "/operators", icon: classIconUrl("Caster") }
];

/**
 * The application shell: the theme, the navbar and one route per page.
 *
 * @returns The routed app.
 */
export default function App() {
	const { pathname } = useLocation();

	// Built once from the search index, which is 31 KB and already in the bundle. The navbar renders on every route, so this must never touch a shard.
	const searchOptions = useMemo<SearchOption[]>(() => searchIndex.map((entry) => ({ path: operatorPath(entry.id), name: entry.name, keys: [normaliseName(entry.name)] })), []);

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<ArchiveNavbar title="Arknights Archive" navItems={NAV_ITEMS} searchOptions={searchOptions} homeLink="/" searchLabel="Search operators" />
			<ScrollToTopOnNavigate>
				{/*
				 * Keyed on the path so a caught throw is forgotten on the next navigation. Without the key the boundary stays in its error
				 * state for the rest of the session, and every later route renders the fallback instead of the page the reader asked for.
				 */}
				<ErrorBoundary key={pathname} fallback={<NotFound404 />}>
					<Routes>
						<Route path="/" element={<Home />} />
						<Route path="/operators" element={<OperatorIndex />} />
						<Route
							path="/operator/:id/art"
							element={
								<CanonicalOperatorRoute suffix="/art">
									<Suspense>
										<OperatorArt />
									</Suspense>
								</CanonicalOperatorRoute>
							}
						/>
						<Route
							path="/operator/:id"
							element={
								<CanonicalOperatorRoute>
									<Operator />
								</CanonicalOperatorRoute>
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
