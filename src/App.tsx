import { CssBaseline, ThemeProvider } from "@mui/material";
import { Route, Routes } from "react-router-dom";

import { ScrollToTopOnNavigate } from "archive-kit";

import { theme } from "./theme.js";

/**
 * The application shell: the theme, and one route per page.
 *
 * @returns The routed app.
 */
export default function App() {
	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<ScrollToTopOnNavigate>
				<Routes>
					<Route path="/" element={<main>Arknights Archive</main>} />
				</Routes>
			</ScrollToTopOnNavigate>
		</ThemeProvider>
	);
}
