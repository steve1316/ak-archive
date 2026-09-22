import type { ReactNode } from "react";

import { Navigate, useLocation, useParams } from "react-router-dom";

/** Props for CanonicalRoute. */
interface CanonicalRouteProps {
	/** Maps the route's `:id` parameter to the page's canonical path, or undefined when it names nothing, which the page shows as a 404. */
	canonicalPath: (param: string | undefined) => string | undefined;
	/** The page to render once the address is already canonical. */
	children: ReactNode;
}

/**
 * Keeps a detail page's address in its canonical short form, such as `/operator/456` for `char_456_ash` or `/enemy/1007` for `/enemy/01007`.
 * The query string is carried across, so a `?skin=` or `?variant=` link keeps its selection. It runs before the page mounts, so a redirect
 * never loads the page twice.
 *
 * @param props Component props.
 * @returns A redirect, or `children` when the address is already canonical.
 */
export default function CanonicalRoute({ canonicalPath, children }: CanonicalRouteProps) {
	const { id } = useParams();
	const location = useLocation();
	const target = canonicalPath(id);

	if (target !== undefined && target !== location.pathname) {
		return <Navigate to={`${target}${location.search}`} replace />;
	}
	return children;
}
