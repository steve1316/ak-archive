/**
 * A small client for the Arknights Wiki's MediaWiki API, used only by `tools/data/dates.mjs`.
 *
 * Requests run one at a time and carry a descriptive User-Agent, as the wiki asks of bots. Nothing here is cached, since the output this feeds is a
 * committed snapshot rather than something rebuilt on every import.
 */

/** The wiki's API endpoint. */
const API_URL = "https://arknights.wiki.gg/api.php";

/** Identifies this tool to the wiki's operators. */
const USER_AGENT = "ak-archive data importer (https://github.com/steve1316/ak-archive)";

/** Rows per Cargo page. The wiki serves up to 500 per request. */
const PAGE_SIZE = 500;

/**
 * Call the API once.
 *
 * @param {Record<string, string>} params Query parameters, without `format`.
 * @returns {Promise<any>} The parsed body, which may carry an `error` object.
 * @throws When the HTTP request itself fails.
 */
async function call(params) {
	const url = `${API_URL}?${new URLSearchParams({ format: "json", ...params })}`;
	const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	if (!response.ok) {
		throw new Error(`wiki request failed with HTTP ${response.status}: ${url}`);
	}
	return response.json();
}

/**
 * Run a Cargo query and collect every page of results.
 *
 * @param {{tables: string, fields: string, where?: string}} query The Cargo tables, fields and optional where clause.
 * @returns {Promise<Array<Record<string, string>>>} Every row, each a map of field name to string value.
 * @throws When the wiki reports an error.
 */
export async function cargoQuery({ tables, fields, where }) {
	const rows = [];
	for (let offset = 0; ; offset += PAGE_SIZE) {
		const body = await call({ action: "cargoquery", tables, fields, ...(where ? { where } : {}), limit: String(PAGE_SIZE), offset: String(offset) });
		if (body.error) {
			throw new Error(`wiki Cargo query on ${tables} failed: ${body.error.code} ${body.error.info}`);
		}
		const page = (body.cargoquery ?? []).map((entry) => entry.title);
		rows.push(...page);
		if (page.length < PAGE_SIZE) {
			return rows;
		}
	}
}

/**
 * Read one page's wikitext, following redirects.
 *
 * @param {string} title The page title, such as `Episode 07`.
 * @returns {Promise<string>} The wikitext, or an empty string when the page does not exist.
 * @throws When the wiki reports any error other than a missing page.
 */
export async function pageWikitext(title) {
	const body = await call({ action: "parse", page: title, prop: "wikitext", redirects: "1" });
	if (body.error?.code === "missingtitle") {
		return "";
	}
	if (body.error) {
		throw new Error(`wiki page ${title} failed: ${body.error.code} ${body.error.info}`);
	}
	return body.parse?.wikitext?.["*"] ?? "";
}
