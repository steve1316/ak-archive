import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.js";

const container = document.getElementById("root");
if (!container) {
	throw new Error("index.html is missing its #root element");
}

createRoot(container).render(
	<StrictMode>
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<App />
		</BrowserRouter>
	</StrictMode>
);
