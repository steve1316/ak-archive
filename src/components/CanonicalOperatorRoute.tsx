import type { ReactNode } from "react";

import { Navigate, useLocation, useParams } from "react-router-dom";

import { operatorNumber, operatorPath, resolveOperatorParam } from "../lib/routes.js";

/** Props for CanonicalOperatorRoute. */
interface CanonicalOperatorRouteProps {
	/** The path under the operator, such as `"/art"`, or empty for the operator page itself. */
	suffix?: string;
	/** The page to render once the address is already in its short form. */
	children: ReactNode;
}

/**
 * Keeps an operator's address in its short form. A full id such as `char_456_ash`, or a number with leading zeros, is replaced with `/operator/456`,
 * carrying the query string across so a `?skin=` link keeps its form.
 *
 * @param props Component props.
 * @returns A redirect, or `children` when the address is already short.
 */
export default function CanonicalOperatorRoute({ suffix = "", children }: CanonicalOperatorRouteProps) {
	const { id: param } = useParams();
	const location = useLocation();
	const id = resolveOperatorParam(param);

	if (id !== undefined && param !== operatorNumber(id)) {
		return <Navigate to={`${operatorPath(id, suffix)}${location.search}`} replace />;
	}
	return children;
}
