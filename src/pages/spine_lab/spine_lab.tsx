// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Rig lab

/**
 * Dev-only lab for the Spine 3.8 runtime under `src/spine/`. Picks a staged rig by operator, form and kind, loads it into a `SpinePlayer`
 * that draws the setup pose with WebGL2, and can lay a bone overlay over the drawing at the same fit.
 *
 * Routed only when `import.meta.env.DEV`, so it never ships in a production build. Rig files come from the `vite.config.ts` middleware
 * that serves `tools/assets/.staging/assets/spine/` under `SPINE_DEV_ROOT`, not from the production asset host.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { Alert, Autocomplete, Box, Chip, Container, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { useSearchParams } from "react-router-dom";

import { spineRigUrls, SPINE_DEV_ROOT } from "../../lib/spine.js";
import { featuresOf, SUPPORTED } from "../../spine/features.js";
import type { SpinePlayer } from "../../spine/player.js";
import type { View } from "../../spine/renderer.js";
import { defaultSkinName, localToWorld } from "../../spine/skeleton.js";
import type { Skeleton } from "../../spine/skeleton.js";
import type { Atlas } from "../../spine/types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Query string key for the chosen operator id. */
const OP_PARAM = "op";
/** Query string key for the chosen form. */
const FORM_PARAM = "form";
/** Query string key for the chosen art kind. */
const KIND_PARAM = "kind";
/** Query string key for the chosen skin. */
const SKIN_PARAM = "skin";

/** Drawing area width in CSS pixels. */
const CANVAS_WIDTH = 800;
/** Drawing area height in CSS pixels. */
const CANVAS_HEIGHT = 600;

/**
 * URL of the generated Spine rig index, resolved through Vite's asset-URL glob rather than a plain JSON import. The file is 500 KB and
 * only this dev-only page needs it, so it is fetched at runtime instead of typed and bundled like the small shards `lib/data.ts` loads.
 */
const SPINE_INDEX_URL = Object.values(import.meta.glob<string>("../../data/spine-index.json", { query: "?url", import: "default", eager: true }))[0] ?? "";

/** Sorts operator ids so the Autocomplete lists them in a stable, readable order. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** One rig's staged file basenames and animation names, as `tools/data` writes them into `spine-index.json`. */
interface SpineRigEntry {
	/** The rig's animation names, in file order. */
	anims: string[];
	/** The atlas file's basename, without the `.atlas` extension. */
	atlas: string;
	/** The skel file's basename, without the `.skel` extension. */
	skel: string;
}

/** The generated Spine rig index: operator id, then form key, then art kind, to that rig's files. */
type SpineIndex = Record<string, Record<string, Record<string, SpineRigEntry>>>;

/** The player module, loaded with a dynamic `import()` so the renderer stays out of the lab's first chunk. */
type PlayerModule = typeof import("../../spine/player.js");

/** The rig the player has loaded: its live skeleton and atlas. */
interface LoadedRig {
	/** The player's live skeleton. */
	skeleton: Skeleton;
	/** The parsed atlas. */
	atlas: Atlas;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Picks a value from a query parameter when it is one of the given options, otherwise falls back to the first option.
 *
 * @param paramValue The raw query parameter, or null when it is absent.
 * @param options The values currently available.
 * @returns The matched value, or an empty string when there are no options.
 */
function pickOption(paramValue: string | null, options: readonly string[]): string {
	return paramValue !== null && options.includes(paramValue) ? paramValue : (options[0] ?? "");
}

/**
 * Draws every bone as a line from its world origin along its world X axis for its length, on a transparent canvas laid over the player's
 * drawing. It uses the player's fitted view so the bones line up with the art, or fits the bones themselves when the player drew nothing.
 *
 * @param canvas The overlay canvas.
 * @param skeleton The posed skeleton, with `updateWorldTransform` already run.
 * @param view The world rectangle the player fitted to the canvas, or null when it drew nothing.
 * @param fit The player module's `fitView`, used when `view` is null.
 */
function drawBoneOverlay(canvas: HTMLCanvasElement, skeleton: Skeleton, view: View | null, fit: PlayerModule["fitView"]): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	const ratio = window.devicePixelRatio || 1;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);

	const segments = skeleton.bones.map((bone) => {
		const [endX, endY] = localToWorld(bone, bone.data.length, 0);
		return { x1: bone.worldX, y1: bone.worldY, x2: endX, y2: endY };
	});
	let shown = view;
	if (!shown) {
		const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for (const segment of segments) {
			box.minX = Math.min(box.minX, segment.x1, segment.x2);
			box.minY = Math.min(box.minY, segment.y1, segment.y2);
			box.maxX = Math.max(box.maxX, segment.x1, segment.x2);
			box.maxY = Math.max(box.maxY, segment.y1, segment.y2);
		}
		if (!Number.isFinite(box.minX)) {
			return;
		}
		shown = fit(box, width, height);
	}

	// World to CSS pixels, with Y flipped so up reads as up on screen.
	const scaleX = width / (shown.maxX - shown.minX);
	const scaleY = height / (shown.maxY - shown.minY);
	const { minX, maxY } = shown;
	ctx.strokeStyle = "#4fc3f7";
	ctx.fillStyle = "#f06292";
	ctx.lineWidth = 1.5;
	for (const segment of segments) {
		const x1 = (segment.x1 - minX) * scaleX;
		const y1 = (maxY - segment.y1) * scaleY;
		const x2 = (segment.x2 - minX) * scaleX;
		const y2 = (maxY - segment.y2) * scaleY;
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(x1, y1, 2, 0, Math.PI * 2);
		ctx.fill();
	}
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Page

/**
 * The dev-only Spine rig lab, routed at `/spine-lab`.
 *
 * @returns The lab page.
 */
export default function SpineLab() {
	const [searchParams, setSearchParams] = useSearchParams();

	// The rig index: operator -> form -> kind -> file basenames. Fetched once, since it is 500 KB and every production route must avoid it.
	const [spineIndex, setSpineIndex] = useState<SpineIndex | null>(null);
	const [indexError, setIndexError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		fetch(SPINE_INDEX_URL, { signal: controller.signal })
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Fetching the rig index gave ${response.status}`);
				}
				return response.json() as Promise<SpineIndex>;
			})
			.then((json) => setSpineIndex(json))
			.catch((error: unknown) => {
				if (!controller.signal.aborted) {
					setIndexError(error instanceof Error ? error.message : String(error));
				}
			});
		return () => controller.abort();
	}, []);

	const operatorIds = useMemo(() => (spineIndex ? Object.keys(spineIndex).sort(COLLATOR.compare) : []), [spineIndex]);
	const opParam = searchParams.get(OP_PARAM);
	const selectedOp = opParam !== null && operatorIds.includes(opParam) ? opParam : "";
	const opEntry = spineIndex?.[selectedOp];
	const formKeys = useMemo(() => (opEntry ? Object.keys(opEntry) : []), [opEntry]);
	const selectedForm = pickOption(searchParams.get(FORM_PARAM), formKeys);
	const kindMap = opEntry?.[selectedForm];
	const kindKeys = useMemo(() => (kindMap ? Object.keys(kindMap) : []), [kindMap]);
	const selectedKind = pickOption(searchParams.get(KIND_PARAM), kindKeys);
	const rigEntry = kindMap?.[selectedKind];

	// The player module, fetched once with a dynamic import, and the player built on the WebGL canvas once it arrives.
	const [playerModule, setPlayerModule] = useState<PlayerModule | null>(null);
	const [player, setPlayer] = useState<SpinePlayer | null>(null);
	const [playerError, setPlayerError] = useState<string | null>(null);
	const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const overlayRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		let active = true;
		import("../../spine/player.js")
			.then((module) => {
				if (active) {
					setPlayerModule(module);
				}
			})
			.catch((error: unknown) => {
				if (active) {
					setPlayerError(error instanceof Error ? error.message : String(error));
				}
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		const canvas = glCanvasRef.current;
		if (!playerModule || !canvas) {
			return;
		}
		let created: SpinePlayer;
		try {
			created = new playerModule.SpinePlayer(canvas);
		} catch (error) {
			setPlayerError(error instanceof Error ? error.message : String(error));
			return;
		}
		setPlayer(created);
		return () => {
			created.dispose();
			setPlayer(null);
		};
	}, [playerModule]);

	// The rig the player has loaded for the current operator, form and kind. A change aborts the previous load's fetches.
	const [loadedRig, setLoadedRig] = useState<LoadedRig | null>(null);
	const [rigError, setRigError] = useState<string | null>(null);

	useEffect(() => {
		setLoadedRig(null);
		setRigError(null);
		if (!player || !rigEntry) {
			return;
		}
		const controller = new AbortController();
		const urls = spineRigUrls(SPINE_DEV_ROOT, selectedOp, selectedForm, selectedKind, rigEntry);
		player
			.load(urls, controller.signal)
			.then(() => {
				const { skeleton, atlas } = player;
				if (skeleton && atlas) {
					setLoadedRig({ skeleton, atlas });
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) {
					setRigError(error instanceof Error ? error.message : String(error));
				}
			});
		// `load` drops the old rig at once, so this clears the canvas while the new one loads.
		player.render();
		return () => controller.abort();
	}, [player, rigEntry, selectedOp, selectedForm, selectedKind]);

	const skinNames = useMemo(() => (loadedRig ? loadedRig.skeleton.data.skins.map((skin) => skin.name) : []), [loadedRig]);
	const skinParam = searchParams.get(SKIN_PARAM);
	const selectedSkin = skinParam !== null && skinNames.includes(skinParam) ? skinParam : ((loadedRig && defaultSkinName(loadedRig.skeleton.data)) ?? "");

	const features = useMemo(() => (loadedRig ? [...featuresOf(loadedRig.skeleton.data)].sort() : []), [loadedRig]);
	const regionCount = useMemo(() => (loadedRig ? loadedRig.atlas.pages.reduce((sum, page) => sum + page.regions.length, 0) : 0), [loadedRig]);

	const [showBones, setShowBones] = useState(false);

	useEffect(() => {
		const overlay = overlayRef.current;
		if (!player || !loadedRig || !playerModule) {
			overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
			return;
		}
		// A skin change shows that skin's setup pose, framed afresh.
		player.setSkin(selectedSkin || null);
		player.setToSetupPose();
		player.refit();
		player.render();
		if (overlay) {
			if (showBones) {
				drawBoneOverlay(overlay, loadedRig.skeleton, player.view, playerModule.fitView);
			} else {
				overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
			}
		}
	}, [player, playerModule, loadedRig, selectedSkin, showBones]);

	/**
	 * Selects a new operator, clearing the form, kind and skin so they fall back to that operator's own defaults.
	 *
	 * @param _event Unused: the Autocomplete change event.
	 * @param value The chosen operator id, or null when the field was cleared.
	 */
	const handleOperatorChange = useCallback(
		(_event: SyntheticEvent, value: string | null) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					if (value) {
						next.set(OP_PARAM, value);
					} else {
						next.delete(OP_PARAM);
					}
					next.delete(FORM_PARAM);
					next.delete(KIND_PARAM);
					next.delete(SKIN_PARAM);
					return next;
				},
				{ replace: true }
			);
		},
		[setSearchParams]
	);

	/**
	 * Selects a new form, clearing the kind and skin so they fall back to that form's own defaults.
	 *
	 * @param event The Select change event.
	 */
	const handleFormChange = useCallback(
		(event: SelectChangeEvent) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					next.set(FORM_PARAM, event.target.value);
					next.delete(KIND_PARAM);
					next.delete(SKIN_PARAM);
					return next;
				},
				{ replace: true }
			);
		},
		[setSearchParams]
	);

	/**
	 * Selects a new kind, clearing the skin so it falls back to that rig's own default.
	 *
	 * @param event The Select change event.
	 */
	const handleKindChange = useCallback(
		(event: SelectChangeEvent) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					next.set(KIND_PARAM, event.target.value);
					next.delete(SKIN_PARAM);
					return next;
				},
				{ replace: true }
			);
		},
		[setSearchParams]
	);

	/**
	 * Selects a new skin for the current rig.
	 *
	 * @param event The Select change event.
	 */
	const handleSkinChange = useCallback(
		(event: SelectChangeEvent) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					next.set(SKIN_PARAM, event.target.value);
					return next;
				},
				{ replace: true }
			);
		},
		[setSearchParams]
	);

	/**
	 * Turns the bone overlay on or off.
	 *
	 * @param _event Unused: the Switch change event.
	 * @param checked Whether the overlay should show.
	 */
	const handleShowBonesChange = useCallback((_event: SyntheticEvent, checked: boolean) => setShowBones(checked), []);

	return (
		<Container maxWidth="xl" sx={{ py: 3 }}>
			<Typography variant="h4" gutterBottom>
				Spine rig lab
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
				Dev-only viewer for staged Spine rigs. Draws the setup pose with the runtime's WebGL2 renderer, with an optional bone overlay.
			</Typography>

			<Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3, flexWrap: "wrap" }} useFlexGap>
				<Autocomplete
					options={operatorIds}
					value={selectedOp || null}
					onChange={handleOperatorChange}
					disabled={operatorIds.length === 0}
					sx={{ minWidth: 280 }}
					renderInput={(params) => <TextField {...params} label="Operator" placeholder="char_172_svrash" />}
				/>
				<FormControl sx={{ minWidth: 160 }} disabled={formKeys.length === 0}>
					<InputLabel id="spine-lab-form-label">Form</InputLabel>
					<Select labelId="spine-lab-form-label" label="Form" value={selectedForm} onChange={handleFormChange}>
						{formKeys.map((key) => (
							<MenuItem key={key} value={key}>
								{key}
							</MenuItem>
						))}
					</Select>
				</FormControl>
				<FormControl sx={{ minWidth: 160 }} disabled={kindKeys.length === 0}>
					<InputLabel id="spine-lab-kind-label">Kind</InputLabel>
					<Select labelId="spine-lab-kind-label" label="Kind" value={selectedKind} onChange={handleKindChange}>
						{kindKeys.map((key) => (
							<MenuItem key={key} value={key}>
								{key}
							</MenuItem>
						))}
					</Select>
				</FormControl>
				<FormControl sx={{ minWidth: 160 }} disabled={skinNames.length === 0}>
					<InputLabel id="spine-lab-skin-label">Skin</InputLabel>
					<Select labelId="spine-lab-skin-label" label="Skin" value={selectedSkin} onChange={handleSkinChange}>
						{skinNames.map((name) => (
							<MenuItem key={name} value={name}>
								{name}
							</MenuItem>
						))}
					</Select>
				</FormControl>
				<FormControlLabel control={<Switch checked={showBones} onChange={handleShowBonesChange} />} label="Show bones" />
			</Stack>

			{indexError ? (
				<Alert severity="error" sx={{ mb: 2 }}>
					{indexError}
				</Alert>
			) : null}
			{rigError ? (
				<Alert severity="error" sx={{ mb: 2 }}>
					{rigError}
				</Alert>
			) : null}
			{playerError ? (
				<Alert severity="error" sx={{ mb: 2 }}>
					{playerError}
				</Alert>
			) : null}

			<Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ display: rigEntry ? "flex" : "none" }}>
				<Box sx={{ position: "relative", width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: "100%", flexShrink: 0, border: "1px solid #444", background: "#1b1b1b" }}>
					<canvas ref={glCanvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
					<canvas ref={overlayRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
					{!loadedRig && !rigError ? (
						<Typography variant="body2" sx={{ position: "absolute", top: 8, left: 8 }}>
							Loading rig...
						</Typography>
					) : null}
				</Box>
				{loadedRig ? (
					<Stack spacing={0.5} sx={{ minWidth: 280 }}>
						<Typography variant="subtitle1">Skeleton</Typography>
						<Typography variant="body2">Version: {loadedRig.skeleton.data.version}</Typography>
						<Typography variant="body2">Bones: {loadedRig.skeleton.data.bones.length}</Typography>
						<Typography variant="body2">Slots: {loadedRig.skeleton.data.slots.length}</Typography>
						<Typography variant="body2">
							Atlas pages: {loadedRig.atlas.pages.length}, regions: {regionCount}
						</Typography>

						<Typography variant="subtitle1" sx={{ mt: 2 }}>
							Features used
						</Typography>
						<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
							{features.map((feature) => (
								<Chip key={feature} label={feature} size="small" color={SUPPORTED.has(feature) ? "success" : "default"} variant={SUPPORTED.has(feature) ? "filled" : "outlined"} />
							))}
						</Stack>

						<Typography variant="subtitle1" sx={{ mt: 2 }}>
							Animations
						</Typography>
						<Typography variant="body2">{loadedRig.skeleton.data.animations.map((animation) => animation.name).join(", ")}</Typography>
					</Stack>
				) : null}
			</Stack>
		</Container>
	);
}
