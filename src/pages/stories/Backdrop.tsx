import { memo, useState } from "react";

import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

/** The area the art fits into: the whole picker, measured as a size container. */
const FRAME_SX: SxProps<Theme> = { position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden", pointerEvents: "none", containerType: "size" };

/** The art: dimmed and softened, with its own edges faded into the dark, and faded in when it changes. */
const ART_SX: SxProps<Theme> = {
	display: "block",
	filter: "blur(2px) brightness(0.5)",
	maskImage: "radial-gradient(ellipse closest-side, #000 55%, transparent 100%)",
	animation: "storyBackdropIn 0.4s ease-out",
	"@keyframes storyBackdropIn": { from: { opacity: 0 }, to: { opacity: 1 } }
};

/** Props for Backdrop. */
interface BackdropProps {
	/** The art to show behind the picker. */
	url: string;
}

/**
 * The art behind the picker, fitted whole inside it rather than stretched to cover it. It stays hidden until it has loaded and its shape is
 * known, then fills as much of the picker as its shape allows. The parent keys it on the URL, so each new art measures itself afresh.
 *
 * @param props Component props.
 * @returns The backdrop.
 */
function Backdrop({ url }: BackdropProps) {
	const [ratio, setRatio] = useState<number | null>(null);
	return (
		<Box sx={FRAME_SX}>
			<Box
				component="img"
				src={url}
				alt=""
				onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
				sx={ART_SX}
				style={ratio ? { width: `min(100cqw, ${ratio * 100}cqh)`, aspectRatio: String(ratio) } : { visibility: "hidden" }}
			/>
		</Box>
	);
}

export default memo(Backdrop);
