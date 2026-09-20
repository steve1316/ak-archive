import { Box, Button, Container, Typography } from "@mui/material";
import { Link } from "react-router-dom";

/**
 * The page shown for an address that matches no route.
 *
 * Rendered in place rather than redirected, so the mistyped address stays visible in the bar.
 *
 * @returns The not-found page.
 */
export default function NotFound404() {
	return (
		<Container component="main" sx={{ py: 8, textAlign: "center" }}>
			<Typography variant="h1" sx={{ fontSize: "clamp(3rem, 12vw, 6rem)", fontWeight: 700 }}>
				404
			</Typography>
			<Typography variant="h2" sx={{ fontSize: "1.25rem", mt: 1, mb: 3 }}>
				There is no page at this address.
			</Typography>
			<Box>
				<Button component={Link} to="/operators" variant="contained">
					Browse operators
				</Button>
			</Box>
		</Container>
	);
}
