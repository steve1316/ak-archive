// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine dev staging URLs

/**
 * URL helpers for the dev-only Spine rig lab. The lab fetches staged rig files through the `vite.config.ts` middleware that serves
 * `tools/assets/.staging/assets/spine/` under `__spine/`, rather than through the asset host the production site uses.
 */

/** The dev-only root the staging middleware serves rigs from, honouring whatever base the site is configured with. */
export const SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine/`;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** URLs for one staged rig's files. A page image's URL is `pageBase` plus that atlas page's own file name. */
export interface RigUrls {
	/** URL of the rig's `.skel` file. */
	skel: string;
	/** URL of the rig's `.atlas` file. */
	atlas: string;
	/** Base URL the rig's atlas page images sit under. */
	pageBase: string;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// URL builder

/**
 * Builds the URLs for one staged rig. Matches how `spine-index.json` stores its file basenames and how the staging folder lays them out:
 * `<root><operatorId>/<formKey>/<kind>/`.
 *
 * @param root The root the rig files are served from, normally `SPINE_DEV_ROOT`.
 * @param operatorId The upstream operator id, such as `char_172_svrash`.
 * @param formKey The form key, such as `base`.
 * @param kind The art kind: `back`, `battle` or `dorm`.
 * @param rig The index entry's skel and atlas basenames, without extension.
 * @returns The rig's skel, atlas and atlas-page-base URLs.
 */
export function spineRigUrls(root: string, operatorId: string, formKey: string, kind: string, rig: { skel: string; atlas: string }): RigUrls {
	const pageBase = `${root}${operatorId}/${formKey}/${kind}/`;
	return { skel: `${pageBase}${rig.skel}.skel`, atlas: `${pageBase}${rig.atlas}.atlas`, pageBase };
}
