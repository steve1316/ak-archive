import { useCallback, useEffect, useMemo } from "react";

import GenericSpineStage, { useRigIndex } from "../../components/SpineStage.js";
import { StagePlaceholder } from "../../components/AnimationsCard.js";
import type { RigFacing, RigKind } from "../../components/AnimationsCard.js";
import { classIconUrl } from "../../lib/assets.js";
import { loadSpineIndexFile, spineFormKey, spineIndexFile, spineRigUrls, spineRoot } from "../../lib/spine.js";

/** Props for SpineStage. */
interface SpineStageProps {
	/** The upstream operator id, such as `char_172_svrash`. */
	operatorId: string;
	/** The page's selected form key, as `?skin=` carries it, or null when the operator has no forms. */
	formKey: string | null;
	/** The selected rig kind. */
	kind: RigKind;
	/** The selected facing, used for the battle kind only. */
	facing: RigFacing;
	/** The operator's class, whose icon the placeholder shows. */
	profession: string;
	/** Tells the card whether the selected form has a back-facing battle rig, for its Back toggle. */
	onHasBack: (hasBack: boolean) => void;
}

/**
 * An operator's chibi for the selected form, kind and facing: picks the rig from the Spine index and hands it to the shared stage.
 *
 * @param props Component props.
 * @returns The stage.
 */
export default function SpineStage({ operatorId, formKey, kind, facing, profession, onHasBack }: SpineStageProps) {
	const { index, state } = useRigIndex(loadSpineIndexFile, spineIndexFile(operatorId), `${operatorId}/${formKey}/${kind}/${facing}`);
	const entry = index?.[operatorId];
	const spineKey = entry && formKey !== null ? spineFormKey(formKey, entry) : null;
	const form = entry && spineKey !== null ? entry[spineKey] : undefined;
	const rigKind = kind === "dorm" ? "dorm" : facing === "back" && form?.back ? "back" : "battle";
	const rig = form?.[rigKind] ?? null;
	const rigKey = rig && spineKey !== null ? `${operatorId}/${spineKey}/${rigKind}` : null;
	const urls = useMemo(() => (rig && spineKey !== null ? spineRigUrls(spineRoot(), operatorId, spineKey, rigKind, rig) : null), [rig, spineKey, operatorId, rigKind]);
	const renderPlaceholder = useCallback((message: string) => <StagePlaceholder iconUrl={classIconUrl(profession)} message={message} />, [profession]);
	const hasBack = form?.back !== undefined;

	// Tells the card whether the Back toggle applies, and turns it off again when the stage goes away.
	useEffect(() => {
		onHasBack(hasBack);
		return () => onHasBack(false);
	}, [onHasBack, hasBack]);

	return (
		<GenericSpineStage
			rigKey={rigKey}
			rig={rig}
			urls={urls}
			indexState={state}
			missingMessage={kind === "dorm" ? "No dorm chibi for this outfit." : "No battle chibi for this outfit."}
			renderPlaceholder={renderPlaceholder}
			canvasLabel="Operator chibi animation"
		/>
	);
}
