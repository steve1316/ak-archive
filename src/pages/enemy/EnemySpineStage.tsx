import { useCallback, useMemo } from "react";

import GenericSpineStage, { useRigIndex } from "../../components/SpineStage.js";
import { StagePlaceholder } from "../../components/AnimationsCard.js";
import { enemyRigUrls, enemySpineIndexFile, enemySpineRoot, loadEnemySpineIndexFile } from "../../lib/spine.js";

/** Props for EnemySpineStage. */
interface EnemySpineStageProps {
	/** The selected variant's upstream id, such as `enemy_1007_slime_2`. */
	enemyId: string;
	/** The variant's icon, which the placeholder shows, or null when none is hosted. */
	iconUrl: string | null;
}

/**
 * An enemy variant's chibi: looks its one battle rig up in the enemy rig index and hands it to the shared stage.
 *
 * @param props Component props.
 * @returns The stage.
 */
export default function EnemySpineStage({ enemyId, iconUrl }: EnemySpineStageProps) {
	const { index, state } = useRigIndex(loadEnemySpineIndexFile, enemySpineIndexFile(enemyId), enemyId);
	const rig = index?.[enemyId] ?? null;
	const urls = useMemo(() => (rig ? enemyRigUrls(enemySpineRoot(), enemyId, rig) : null), [rig, enemyId]);
	const renderPlaceholder = useCallback((message: string) => <StagePlaceholder iconUrl={iconUrl} message={message} />, [iconUrl]);

	return (
		<GenericSpineStage
			rigKey={rig ? enemyId : null}
			rig={rig}
			urls={urls}
			indexState={state}
			missingMessage="No animation for this enemy."
			renderPlaceholder={renderPlaceholder}
			canvasLabel="Enemy animation"
		/>
	);
}
