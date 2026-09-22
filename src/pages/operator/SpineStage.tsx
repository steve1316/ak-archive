import { useCallback, useMemo } from "react";

import GenericSpineStage, { useRigIndex } from "../../components/SpineStage.js";
import { StagePlaceholder } from "../../components/AnimationsCard.js";
import type { RigFacing, RigKind, StageStatus } from "../../components/AnimationsCard.js";
import { classIconUrl } from "../../lib/assets.js";
import { loadSpineIndex, spineFormKey, spineRigUrls, spineRoot } from "../../lib/spine.js";

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
	/** Reports the stage's status to the card. */
	onStatus: (status: StageStatus) => void;
}

/**
 * An operator's chibi for the selected form, kind and facing: picks the rig from the Spine index and hands it to the shared stage.
 *
 * @param props Component props.
 * @returns The stage.
 */
export default function SpineStage({ operatorId, formKey, kind, facing, profession, onStatus }: SpineStageProps) {
	const { index, state } = useRigIndex(loadSpineIndex, `${operatorId}/${formKey}/${kind}/${facing}`);
	const entry = index?.[operatorId];
	const spineKey = entry && formKey !== null ? spineFormKey(formKey, entry) : null;
	const form = entry && spineKey !== null ? entry[spineKey] : undefined;
	const rigKind = kind === "dorm" ? "dorm" : facing === "back" && form?.back ? "back" : "battle";
	const rig = form?.[rigKind] ?? null;
	const rigKey = rig && spineKey !== null ? `${operatorId}/${spineKey}/${rigKind}` : null;
	const urls = useMemo(() => (rig && spineKey !== null ? spineRigUrls(spineRoot(), operatorId, spineKey, rigKind, rig) : null), [rig, spineKey, operatorId, rigKind]);
	const renderPlaceholder = useCallback((message: string) => <StagePlaceholder iconUrl={classIconUrl(profession)} message={message} />, [profession]);

	return (
		<GenericSpineStage
			guardKey={operatorId}
			rigKey={rigKey}
			rig={rig}
			urls={urls}
			indexState={state}
			missingMessage={kind === "dorm" ? "No dorm chibi for this outfit." : "No battle chibi for this outfit."}
			renderPlaceholder={renderPlaceholder}
			canvasLabel="Operator chibi animation"
			hasBack={form?.back !== undefined}
			onStatus={onStatus}
		/>
	);
}
