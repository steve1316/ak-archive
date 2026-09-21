import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Box, IconButton, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ArtPlaceholder, ArtZoomControls, containArtSx, LoadError, useArtPanBounds, useCloseOnEscape, useZoomPan } from "archive-kit";

import { loadOperator } from "../../lib/data.js";
import { formsOf, readFormKey, writeFormKey } from "../../lib/forms.js";
import NotFound404 from "../../not_found_404.js";
import type { Operator } from "../../types/operator.js";

/** The whole viewer: fixed above the persistent navbar, filling the viewport, dark like a photo lightbox. */
const ROOT_SX: SxProps<Theme> = { position: "fixed", inset: 0, bgcolor: "common.black", zIndex: (theme) => theme.zIndex.modal, display: "flex", flexDirection: "column" };

/** The top bar: close button, operator name and zoom controls. Wraps at `xs` so the form switcher can drop to its own row. */
const BAR_SX: SxProps<Theme> = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, p: 1, color: "common.white" };

/**
 * The form switcher. At `xs` it takes `order: 1` so it lands after the zoom controls in the wrapped flow, and `flexBasis: "100%"` so that
 * ordering forces it onto its own full-width row below the close button, name and zoom controls. `overflowX: "auto"` lets it scroll
 * internally on that row if an operator's skins still do not all fit.
 */
const FORM_GROUP_SX: SxProps<Theme> = {
	mr: { xs: 0, sm: 1 },
	order: { xs: 1, sm: 0 },
	flexBasis: { xs: "100%", sm: "auto" },
	maxWidth: "100%",
	overflowX: "auto",
	"& .MuiToggleButton-root": { color: "inherit", flexShrink: 0 }
};

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
 * The form shown is read from the same `?skin=` query parameter the operator page uses, so a link to a specific costume opens on that costume
 * here too. An operator with no published art at all still falls through to `ArtPlaceholder` with the zoom controls left out.
 *
 * @returns The viewer.
 */
export default function OperatorArt() {
	const { id } = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams, setSearchParams] = useSearchParams();

	// Undefined while loading, null when no operator has this id.
	const [operator, setOperator] = useState<Operator | null | undefined>(undefined);
	// True when the operator's shard failed to load, which shows a retry notice in place of the art.
	const [loadFailed, setLoadFailed] = useState(false);
	// Bumped by the retry button to run the load again. The data store keeps whatever already loaded cached.
	const [loadAttempt, setLoadAttempt] = useState(0);

	const forms = useMemo(() => (operator ? formsOf(operator) : []), [operator]);
	const formKey = readFormKey(searchParams, forms);
	const form = forms.find((entry) => entry.key === formKey) ?? null;

	// The art element fills the stage, so its box is the stage's size and its natural size gives the drawn picture's shape.
	const artRef = useRef<HTMLImageElement | null>(null);
	const panBounds = useArtPanBounds(artRef);
	const zoom = useZoomPan<HTMLDivElement>({ panBounds });

	// A new form is a new picture, so the view returns to fitted rather than keeping a zoom and pan chosen for the last one.
	const shownForm = useRef(formKey);
	useEffect(() => {
		if (shownForm.current !== formKey) {
			shownForm.current = formKey;
			zoom.reset();
		}
	});

	// The query string the viewer opened with. Compared against in `close` so a history pop is only used when nothing has changed since.
	const initialSearch = useRef(location.search);

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
	// it, so the browser Back button does not land the reader right back in the viewer it just closed. But the form switcher above writes with
	// history replace, so a pop would show the operator page's form from when the viewer opened rather than the one last shown here. Popping
	// only happens when the query string is still what it was at mount. Any other close - a form was switched, or the viewer was opened cold
	// from a pasted link with nothing to pop - goes straight to the operator page with the viewer's current query string, replacing the
	// viewer's own history entry so it does not linger either.
	const close = useCallback(() => {
		if (location.key !== "default" && location.search === initialSearch.current) {
			void navigate(-1);
			return;
		}
		void navigate(id ? `/operator/${id}${location.search}` : "/operators", { replace: true });
	}, [location.key, location.search, navigate, id]);

	useCloseOnEscape(close);

	// The viewer is the only route that names itself in the tab, so it also has to put the title back. Without the cleanup its own title would
	// sit there for every page the reader opened afterwards, until a reload.
	useEffect(() => {
		if (!operator) {
			return;
		}
		const previous = document.title;
		document.title = `${operator.name} - full art`;
		return () => {
			document.title = previous;
		};
	}, [operator]);

	const handleRetry = useCallback(() => setLoadAttempt((current) => current + 1), []);

	const handleFormChange = useCallback(
		(_event: MouseEvent<HTMLElement>, key: string | null) => {
			if (key === null) {
				return;
			}
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					writeFormKey(next, key, forms);
					return next;
				},
				{ replace: true }
			);
		},
		[forms, setSearchParams]
	);

	if (operator === null) {
		return <NotFound404 />;
	}

	const illustrated = form !== null;

	return (
		<Box sx={ROOT_SX}>
			<Box sx={BAR_SX}>
				<IconButton onClick={close} aria-label="close" sx={{ color: "inherit" }}>
					<CloseIcon />
				</IconButton>
				<Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
					{operator?.name ?? (loadFailed ? "" : "Loading...")}
				</Typography>
				{forms.length > 1 ? (
					<ToggleButtonGroup value={formKey} exclusive size="small" onChange={handleFormChange} aria-label="Form" sx={FORM_GROUP_SX}>
						{forms.map((entry) => (
							<ToggleButton key={entry.key} value={entry.key}>
								{entry.name}
							</ToggleButton>
						))}
					</ToggleButtonGroup>
				) : null}
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
						<Box component="img" ref={artRef} src={form.illustration} alt={operator.name} draggable={false} sx={containArtSx} style={zoom.contentStyle} />
					) : null}
				</Box>
			)}
		</Box>
	);
}
