import { json, error } from '@sveltejs/kit';
import { loadState, saveState } from '$lib/server/persistence';
import { FIELD_DEFS } from '$lib/fields';
import type { Vendor } from '$lib/types';
import type { RequestHandler } from './$types';

const REQUIRED_FIELDS = FIELD_DEFS.filter((f) => f.required).map((f) => f.field);

function countMissingRequired(vendor: Vendor): number {
	let count = 0;
	for (const product of vendor.products) {
		for (const line of product.lines) {
			for (const field of REQUIRED_FIELDS) {
				const value = line[field];
				if (value === null || value === '' || value === undefined) count++;
			}
		}
	}
	return count;
}

export const POST: RequestHandler = async ({ params }) => {
	await new Promise((r) => setTimeout(r, 400));

	const state = await loadState();
	const vendor = state.vendors.find((v) => v.id === params.vendorId);
	if (!vendor) throw error(404, 'vendor not found');

	const missing = countMissingRequired(vendor);
	if (missing > 0) throw error(400, `${missing} required fields are missing`);

	vendor.submittedAt = new Date().toISOString();
	await saveState(state);

	return json({ vendor });
};
