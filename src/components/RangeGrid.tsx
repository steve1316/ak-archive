import { useMemo } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import rangesJson from "../data/ranges.json";
import { TRAIT_AREA_COLOUR } from "../theme.js";

/** Every range shape by id, as [row, col] tiles with the operator at [0, 0]. Written by `tools/data/import.mjs`. */
const RANGES: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>> = rangesJson;

/** A tile's side in pixels. */
const TILE = 14;

/** The gap between tiles in pixels. */
const GAP = 3;

/** The trait shade, the amber at ~35% opacity as an 8-digit hex. */
const TRAIT_FILL = `${TRAIT_AREA_COLOUR}59`;

/** What one tile shows. */
type TileKind = "self" | "attack" | "trait" | "empty";

/** Each tile kind's look, shared with the legend swatches. The trait shade only ever lands on an attack tile. Checked with `satisfies` so it can be spread. */
const TILE_SX = {
	self: { bgcolor: "text.primary", borderRadius: "2px" },
	attack: { border: 2, borderColor: "text.secondary", borderRadius: "2px" },
	trait: { border: 2, borderColor: TRAIT_AREA_COLOUR, bgcolor: TRAIT_FILL, borderRadius: "2px" },
	empty: {}
} satisfies Record<TileKind, SxProps<Theme>>;

/** The grid beside its legend. */
const ROOT_SX: SxProps<Theme> = { display: "flex", alignItems: "center", gap: 1.75 };

/** One legend swatch. Checked with `satisfies` rather than annotated, so the legend can spread it - the pattern `RecordBlock.tsx` uses. */
const SWATCH_SX = { display: "inline-block", boxSizing: "border-box", width: 10, height: 10, mr: 0.5, verticalAlign: "-1px" } satisfies SxProps<Theme>;

/** The legend line under the label. */
const LEGEND_SX: SxProps<Theme> = { display: "flex", flexWrap: "wrap", columnGap: 1.5, fontSize: 12, color: "text.secondary", mt: 0.5 };

/** Props for RangeGrid. */
interface RangeGridProps {
	/** The attack range to draw, a key into `ranges.json`. */
	rangeId: string;
	/** The trait's secondary area to shade inside the range, or null for none. */
	traitRangeId?: string | null;
	/** The caption beside the grid. */
	label?: string;
}

/**
 * One attack range drawn as tiles, the operator's own tile solid and every tile it reaches outlined, facing right as the game draws it. A trait
 * area, such as the Spreadshooter's 160% row, is shaded amber when it marks out part of the range. An unknown range id draws nothing.
 *
 * @param props Component props.
 * @returns The grid with its legend, or null for an unknown range.
 */
export default function RangeGrid({ rangeId, traitRangeId = null, label = "Attack range" }: RangeGridProps) {
	const layout = useMemo(() => {
		const tiles = RANGES[rangeId];
		if (!tiles) {
			return null;
		}
		const key = (row: number, col: number) => `${row},${col}`;
		const attack = new Set(tiles.map(([row = 0, col = 0]) => key(row, col)));
		// Only shade a trait area that marks out part of the range, such as the Spreadshooter row. A Dollkeeper's substitute range reaches past the
		// attack range or matches it exactly, and shading its overlap would misstate it.
		const traitTiles = (traitRangeId ? (RANGES[traitRangeId] ?? []) : []).map(([row = 0, col = 0]) => key(row, col)).filter((id) => id !== key(0, 0));
		const inside = traitTiles.every((id) => attack.has(id)) && traitTiles.length < [...attack].filter((id) => id !== key(0, 0)).length;
		const trait = new Set(inside ? traitTiles : []);
		const rows = [0, ...tiles.map(([row = 0]) => row)];
		const cols = [0, ...tiles.map(([, col = 0]) => col)];
		const [top, bottom, left, right] = [Math.max(...rows), Math.min(...rows), Math.min(...cols), Math.max(...cols)];
		const cells: Array<{ id: string; kind: TileKind }> = [];
		for (let row = top; row >= bottom; row--) {
			for (let col = left; col <= right; col++) {
				const id = key(row, col);
				const kind: TileKind = row === 0 && col === 0 ? "self" : attack.has(id) ? (trait.has(id) ? "trait" : "attack") : "empty";
				cells.push({ id, kind });
			}
		}
		return { columns: right - left + 1, cells, hasTrait: cells.some((cell) => cell.kind === "trait") };
	}, [rangeId, traitRangeId]);

	if (!layout) {
		return null;
	}

	return (
		<Box sx={ROOT_SX}>
			<Box sx={{ display: "grid", gridTemplateColumns: `repeat(${layout.columns}, ${TILE}px)`, gridAutoRows: `${TILE}px`, gap: `${GAP}px`, flex: "none" }} aria-hidden>
				{layout.cells.map((cell) => (
					<Box key={cell.id} sx={TILE_SX[cell.kind]} />
				))}
			</Box>
			<Box>
				<Typography variant="body2" color="text.secondary">
					{label}
				</Typography>
				<Box sx={LEGEND_SX}>
					<span>
						<Box component="span" sx={{ ...SWATCH_SX, ...TILE_SX.self }} />
						Operator
					</span>
					<span>
						<Box component="span" sx={{ ...SWATCH_SX, ...TILE_SX.attack }} />
						Range
					</span>
					{layout.hasTrait ? (
						<span>
							<Box component="span" sx={{ ...SWATCH_SX, ...TILE_SX.trait }} />
							Trait area
						</span>
					) : null}
				</Box>
			</Box>
		</Box>
	);
}
