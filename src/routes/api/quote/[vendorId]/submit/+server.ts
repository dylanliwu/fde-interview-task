import { json, error } from '@sveltejs/kit';
import { loadState, saveState } from '$lib/server/persistence';
import { HEADER_FIELD_DEFS, LINE_FIELD_DEFS, PRODUCT_FIELD_DEFS } from '$lib/fields';
import type { Vendor } from '$lib/types';
import type { RequestHandler } from './$types';

function countMissingRequired(vendor: Vendor, excluded: Set<string>): number {
	let count = 0;
	for (const field of HEADER_FIELD_DEFS.filter((f) => f.required).map((f) => f.field)) {
		const value = vendor[field];
		if (value === null || value === '' || value === undefined) count++;
	}
	for (const product of vendor.products) {
		for (const field of PRODUCT_FIELD_DEFS.filter((f) => f.required).map((f) => f.field)) {
			const value = product[field];
			if (value === null || value === '' || value === undefined) count++;
		}
		for (const line of product.lines) {
			if (excluded.has(line.id)) continue; // reviewer chose to submit without this line
			for (const field of LINE_FIELD_DEFS.filter((f) => f.required).map((f) => f.field)) {
				const value = line[field];
				if (value === null || value === '' || value === undefined) count++;
			}
		}
	}
	return count;
}

export const POST: RequestHandler = async ({ params, request }) => {
	await new Promise((r) => setTimeout(r, 400));

	// Optional body: { excludeLineIds: string[] } — lines to leave out of the submission.
	const body = (await request.json().catch(() => null)) as { excludeLineIds?: unknown } | null;
	const excludeLineIds = Array.isArray(body?.excludeLineIds)
		? body.excludeLineIds.filter((id): id is string => typeof id === 'string')
		: [];
	const excluded = new Set(excludeLineIds);

	const state = await loadState();
	const vendor = state.vendors.find((v) => v.id === params.vendorId);
	if (!vendor) throw error(404, 'vendor not found');

	const missing = countMissingRequired(vendor, excluded);
	if (missing > 0) throw error(400, `${missing} required fields are missing`);

	vendor.submittedAt = new Date().toISOString();
	if (excluded.size) vendor.excludedLineIds = [...excluded];
	else delete vendor.excludedLineIds;
	await saveState(state);

	return json({ vendor });
};
