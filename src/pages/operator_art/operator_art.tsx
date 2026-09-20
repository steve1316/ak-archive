import { useCallback, useEffect, useRef, useState } from "react";

import { Box, IconButton, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { ArtPlaceholder, ArtZoomControls, containArtSx, LoadError, useArtPanBounds, useCloseOnEscape, useZoomPan } from "archive-kit";

import { hasIllustration, illustrationUrl } from "../../lib/assets.js";
import { loadOperator } from "../../lib/data.js";
import NotFound404 from "../../not_found_404.js";
import type { Operator } from "../../types/operator.js";

/** The whole viewer: fixed above the persistent navbar, filling the viewport, dark like a photo lightbox. */
const ROOT_SX: SxProps<Theme> = { position: "fixed", inset: 0, bgcolor: "common.black", zIndex: (theme) => theme.zIndex.modal, display: "flex", flexDirection: "column" };

/** The top bar: close button, operator name and zoom controls. */
const BAR_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1, p: 1, color: "common.white" };

/** The room below the bar, centring whatever it holds. Used for both the retry notice and the no-art placeholder. */
const CENTRE_SX: SxProps<Theme> = { flexGrow: 1, display: "grid", placeItems: "center", p: 2 };

/** The placeholder box's size: a fixed width that still shrinks on a narrow phone screen. */
const PLACEHOLDER_BOX_SX: SxProps<Theme> = { width: 256, maxWidth: "60vw" };

/** The zoomable stage that holds the illustration once one is published. */
const STAGE_SX: SxProps<Theme> = { flexGrow: 1, position: "relative", overflow: "hidden" };

/**
 * The full-screen art viewer route.
 *
 * A route rather than an overlay inside the operator page, so the browser back button closes it and the view can be linked to directly. It
 * sits above the persistent navbar (`zIndex.modal`), which is what makes it read as a dedicated viewer rather than another page under the bar.
 *
 * No illustration is published yet: `hasIllustration` returns false for every operator until the A3 asset pipeline lands, so today this always
 * shows `ArtPlaceholder` with the zoom controls left out, rather than controls that sit there with nothing to act on. The same code starts
 * drawing real art and showing the controls the moment the manifest and images exist, with no changes here.
 *
 * @returns The viewer.
 */
export default function OperatorArt() {
	const { id } = useParams();
	const navigate = useNavigate();
	const location = useLocation();

	// Undefined while loading, null when no operator has this id.
	const [operator, setOperator] = useState<Operator | null | undefined>(undefined);
	// True when the operator's shard failed to load, which shows a retry notice in place of the art.
	const [loadFailed, setLoadFailed] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [loadAttempt, setLoadAttempt] = useState(0);

	// The art element fills the stage, so its box is the stage's size and its natural size gives the drawn picture's shape.
	const artRef = useRef<HTMLImageElement | null>(null);
	const panBounds = useArtPanBounds(artRef);
	const zoom = useZoomPan<HTMLDivElement>({ panBounds });

	useEffect(() => {
		if (!id) {
			setOperator(null);
			return;
		}
		let active = true;
		setLoadFailed(false);
		loadOperator(id).then(
			(loaded) => {
				if (active) {
					setOperator(loaded ?? null);
				}
			},
			() => {
				if (active) {
					setLoadFailed(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [id, loadAttempt]);

	// Opened from the operator page's "View full art" button, going back pops that real history entry rather than pushing a new one on top of
	// it, or the browser Back button would land the reader right back in the viewer it just closed. Opened cold from a pasted link there is
	// nothing to pop, so this navigates to the operator page directly, replacing the viewer's own entry so it does not linger in history either.
	const close = useCallback(() => {
		if (location.key !== "default") {
			void navigate(-1);
			return;
		}
		void navigate(id ? `/operator/${id}` : "/operators", { replace: true });
	}, [location.key, navigate, id]);

	useCloseOnEscape(close);

	useEffect(() => {
		if (operator) {
			document.title = `${operator.name} - full art`;
		}
	}, [operator]);

	const handleRetry = useCallback(() => setLoadAttempt((current) => current + 1), []);

	if (operator === null) {
		return <NotFound404 />;
	}

	// The illustration is not hosted yet for any operator, so this is always false until the A3 pipeline lands. Kept as a check rather than a
	// constant so the page needs no change once it does.
	const illustrated = operator !== undefined && hasIllustration(operator.id);

	return (
		<Box sx={ROOT_SX}>
			<Box sx={BAR_SX}>
				<IconButton onClick={close} aria-label="close" sx={{ color: "inherit" }}>
					<CloseIcon />
				</IconButton>
				<Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
					{operator?.name ?? (loadFailed ? "" : "Loading...")}
				</Typography>
				{illustrated ? <ArtZoomControls zoom={zoom} /> : null}
			</Box>

			{loadFailed ? (
				<Box sx={CENTRE_SX}>
					<LoadError what="this operator's art" onRetry={handleRetry} titleComponent="h1" />
				</Box>
			) : operator && !illustrated ? (
				<Box sx={CENTRE_SX}>
					<Box sx={PLACEHOLDER_BOX_SX}>
						<ArtPlaceholder name={operator.name} />
					</Box>
				</Box>
			) : (
				// Mounted from the first render, before the operator loads, so the zoom hook has its element from the start.
				<Box ref={zoom.containerRef} sx={STAGE_SX} style={zoom.containerStyle} {...zoom.handlers}>
					{operator && illustrated ? (
						// Not draggable: a mouse drag on an image otherwise starts the browser's own image drag, which cancels the pan.
						<Box component="img" ref={artRef} src={illustrationUrl(operator.id)} alt={operator.name} draggable={false} sx={containArtSx} style={zoom.contentStyle} />
					) : null}
				</Box>
			)}
		</Box>
	);
}
