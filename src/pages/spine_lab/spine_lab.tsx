// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Rig lab

/**
 * Dev-only lab for the Spine 3.8 runtime under `src/spine/`. Picks a staged rig by operator, form and kind, parses its skeleton and atlas
 * through the runtime, and draws a bone overlay so the setup-pose maths can be checked on screen before any renderer exists.
 *
 * Routed only when `import.meta.env.DEV`, so it never ships in a production build. Rig files come from the `vite.config.ts` middleware
 * that serves `tools/assets/.staging/assets/spine/` under `SPINE_DEV_ROOT`, not from the production asset host.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { Alert, Autocomplete, Chip, Container, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { useSearchParams } from "react-router-dom";

import { spineRigUrls, SPINE_DEV_ROOT } from "../../lib/spine.js";
import { readAtlas } from "../../spine/atlas.js";
import { readSkeleton } from "../../spine/binary.js";
import { featuresOf, SUPPORTED } from "../../spine/features.js";
import { localToWorld, Skeleton } from "../../spine/skeleton.js";
import type { Atlas, SkeletonData } from "../../spine/types.js";

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

/** Bone overlay canvas size in CSS pixels. */
const CANVAS_WIDTH = 800;
/** Bone overlay canvas size in CSS pixels. */
const CANVAS_HEIGHT = 600;

/** Empty space kept around the fitted skeleton inside the canvas, in pixels. */
const CANVAS_PADDING = 24;

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

/** A rig's parsed skeleton and atlas, before a skin is chosen. */
interface ParsedRig {
	/** The parsed skeleton data. */
	data: SkeletonData;
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
 * Picks the Skin select's default. Several staged rigs keep their setup attachments only in a named skin, so when a rig has more than one
 * skin the first non-default one is chosen. A rig with only the default skin keeps it, and an empty list (nothing parsed yet) gives "".
 *
 * @param skinNames Every skin name the rig's parsed skeleton carries, default skin first.
 * @returns The skin name to select when the query string names none.
 */
function defaultSkinOf(skinNames: readonly string[]): string {
	return skinNames.length > 1 ? skinNames[1]! : (skinNames[0] ?? "");
}

/**
 * Draws every bone as a line from its world origin along its world X axis for its length, fitted to the skeleton's extent with Y flipped
 * so up reads as up on screen. This checks the runtime's bone world transforms before any renderer exists.
 *
 * @param canvas The canvas to draw into.
 * @param skeleton The posed skeleton, with `updateWorldTransform` already run.
 */
function drawBoneOverlay(canvas: HTMLCanvasElement, skeleton: Skeleton): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.fillStyle = "#1b1b1b";
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	const segments = skeleton.bones.map((bone) => {
		const [endX, endY] = localToWorld(bone, bone.data.length, 0);
		return { x1: bone.worldX, y1: bone.worldY, x2: endX, y2: endY };
	});

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const segment of segments) {
		minX = Math.min(minX, segment.x1, segment.x2);
		minY = Math.min(minY, segment.y1, segment.y2);
		maxX = Math.max(maxX, segment.x1, segment.x2);
		maxY = Math.max(maxY, segment.y1, segment.y2);
	}
	if (!Number.isFinite(minX)) {
		return;
	}

	const spanX = Math.max(maxX - minX, 1);
	const spanY = Math.max(maxY - minY, 1);
	const availableWidth = CANVAS_WIDTH - CANVAS_PADDING * 2;
	const availableHeight = CANVAS_HEIGHT - CANVAS_PADDING * 2;
	const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
	const offsetX = CANVAS_PADDING + (availableWidth - spanX * scale) / 2;
	const offsetY = CANVAS_PADDING + (availableHeight - spanY * scale) / 2;

	ctx.strokeStyle = "#4fc3f7";
	ctx.fillStyle = "#f06292";
	ctx.lineWidth = 1.5;
	for (const segment of segments) {
		const x1 = offsetX + (segment.x1 - minX) * scale;
		const y1 = CANVAS_HEIGHT - (offsetY + (segment.y1 - minY) * scale);
		const x2 = offsetX + (segment.x2 - minX) * scale;
		const y2 = CANVAS_HEIGHT - (offsetY + (segment.y2 - minY) * scale);
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
		let active = true;
		fetch(SPINE_INDEX_URL)
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Fetching the rig index gave ${response.status}`);
				}
				return response.json() as Promise<SpineIndex>;
			})
			.then((json) => {
				if (active) {
					setSpineIndex(json);
				}
			})
			.catch((error: unknown) => {
				if (active) {
					setIndexError(error instanceof Error ? error.message : String(error));
				}
			});
		return () => {
			active = false;
		};
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

	// The parsed rig for the current operator, form and kind. Cleared and re-fetched whenever any of those three change.
	const [parsedRig, setParsedRig] = useState<ParsedRig | null>(null);
	const [rigError, setRigError] = useState<string | null>(null);

	useEffect(() => {
		if (!rigEntry) {
			setParsedRig(null);
			setRigError(null);
			return;
		}
		let active = true;
		setParsedRig(null);
		setRigError(null);
		const urls = spineRigUrls(SPINE_DEV_ROOT, selectedOp, selectedForm, selectedKind, rigEntry);
		(async () => {
			const [skelResponse, atlasResponse] = await Promise.all([fetch(urls.skel), fetch(urls.atlas)]);
			if (!skelResponse.ok) {
				throw new Error(`Fetching ${urls.skel} gave ${skelResponse.status}`);
			}
			if (!atlasResponse.ok) {
				throw new Error(`Fetching ${urls.atlas} gave ${atlasResponse.status}`);
			}
			const [skelBytes, atlasText] = await Promise.all([skelResponse.arrayBuffer(), atlasResponse.text()]);
			const data = readSkeleton(new Uint8Array(skelBytes));
			const atlas = readAtlas(atlasText);
			if (active) {
				setParsedRig({ data, atlas });
			}
		})().catch((error: unknown) => {
			if (active) {
				setRigError(error instanceof Error ? error.message : String(error));
			}
		});
		return () => {
			active = false;
		};
	}, [rigEntry, selectedOp, selectedForm, selectedKind]);

	const skinNames = useMemo(() => (parsedRig ? parsedRig.data.skins.map((skin) => skin.name) : []), [parsedRig]);
	const skinParam = searchParams.get(SKIN_PARAM);
	const selectedSkin = skinParam !== null && skinNames.includes(skinParam) ? skinParam : defaultSkinOf(skinNames);

	const skeleton = useMemo(() => {
		if (!parsedRig) {
			return null;
		}
		const built = new Skeleton(parsedRig.data);
		if (skinNames.includes(selectedSkin)) {
			built.setSkin(selectedSkin);
			built.setToSetupPose();
		}
		built.updateWorldTransform();
		return built;
	}, [parsedRig, skinNames, selectedSkin]);

	const features = useMemo(() => (parsedRig ? [...featuresOf(parsedRig.data)].sort() : []), [parsedRig]);
	const regionCount = useMemo(() => (parsedRig ? parsedRig.atlas.pages.reduce((sum, page) => sum + page.regions.length, 0) : 0), [parsedRig]);

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		if (!skeleton) {
			canvas.getContext("2d")?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
			return;
		}
		drawBoneOverlay(canvas, skeleton);
	}, [skeleton]);

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

	return (
		<Container maxWidth="xl" sx={{ py: 3 }}>
			<Typography variant="h4" gutterBottom>
				Spine rig lab
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
				Dev-only viewer for staged Spine rigs. Checks the runtime's setup pose and bone world transforms before the renderer exists.
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

			{parsedRig ? (
				<Stack direction={{ xs: "column", md: "row" }} spacing={3}>
					<canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={{ border: "1px solid #444", background: "#1b1b1b", maxWidth: "100%" }} />
					<Stack spacing={0.5} sx={{ minWidth: 280 }}>
						<Typography variant="subtitle1">Skeleton</Typography>
						<Typography variant="body2">Version: {parsedRig.data.version}</Typography>
						<Typography variant="body2">Bones: {parsedRig.data.bones.length}</Typography>
						<Typography variant="body2">Slots: {parsedRig.data.slots.length}</Typography>
						<Typography variant="body2">
							Atlas pages: {parsedRig.atlas.pages.length}, regions: {regionCount}
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
						<Typography variant="body2">{parsedRig.data.animations.map((animation) => animation.name).join(", ")}</Typography>
					</Stack>
				</Stack>
			) : !rigError && rigEntry ? (
				<Typography variant="body2">Loading rig...</Typography>
			) : null}
		</Container>
	);
}
