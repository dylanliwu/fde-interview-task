import type { Line, Product, Vendor } from './types';
import { HEADER_FIELD_DEFS, LINE_FIELD_DEFS } from './fields';
import { REQUESTED_PARTS, REQUESTED_QTY_TIERS } from './seed';

/** What the buyer asked for. Reference data — not vendor-editable state. */
export type RequestedItem = { index: number; pn: string; nsn: string; desc: string; qtys: number[] };

export const RFQ_ITEMS: RequestedItem[] = REQUESTED_PARTS.map((p, i) => ({
	index: i,
	pn: p.pn,
	nsn: p.nsn,
	desc: p.desc,
	qtys: REQUESTED_QTY_TIERS[i] ?? []
}));

export type RowStatus =
	| 'nobid'
	| 'missing_break'
	| 'incomplete'
	| 'math'
	| 'extra_break'
	| 'alt'
	| 'extra_part'
	| 'ok';

/** Four colour groups so the grid reads at a glance; each status belongs to one. */
export type Tone = 'ok' | 'diff' | 'extra' | 'bad';

export const TONES: Record<Tone, { title: string; help: string }> = {
	ok: { title: 'Matches request', help: 'Same part and quantity we asked for. Check the numbers against the highlighted source, then confirm.' },
	diff: { title: 'Differs from request', help: 'The vendor changed something we asked for. Decide whether it is acceptable.' },
	extra: { title: 'Not requested', help: 'The vendor added something we did not ask for. Keep it or ignore it.' },
	bad: { title: 'Missing or wrong data', help: 'Something needs fixing before this row can be trusted.' }
};

export const STATUS_META: Record<
	RowStatus,
	{ label: string; tone: Tone; attention: boolean; help: string }
> = {
	ok: { label: 'Match', tone: 'ok', attention: false, help: 'Quoted exactly as requested.' },
	alt: {
		label: 'Different PN',
		tone: 'diff',
		attention: true,
		help: 'Vendor quoted a substitute part number (same NSN) instead of the one requested. Confirm the substitute is acceptable.'
	},
	missing_break: {
		label: 'Qty not quoted',
		tone: 'diff',
		attention: true,
		help: 'We asked for this quantity ("price break") but got no price for it. If it is in the email, click Add line; otherwise ask the vendor via "Draft from issues".'
	},
	extra_break: {
		label: 'Extra qty',
		tone: 'extra',
		attention: true,
		help: 'Vendor priced a quantity we did not ask for.'
	},
	extra_part: {
		label: 'Extra part',
		tone: 'extra',
		attention: true,
		help: 'Vendor added a part that was not on the RFQ.'
	},
	nobid: {
		label: 'Not quoted',
		tone: 'bad',
		attention: true,
		help: 'Vendor did not bid on this part at all.'
	},
	incomplete: {
		label: 'Missing data',
		tone: 'bad',
		attention: true,
		help: 'A required value (unit cost, price, currency, lead time) is empty, usually because extraction missed it. Find it in the highlighted text and fill it in.'
	},
	math: {
		label: 'Price mismatch',
		tone: 'bad',
		attention: true,
		help: 'Extended price does not equal qty × unit cost. Check the source for a typo.'
	}
};

/** `rfq: true` = the issue is about what we requested, so it can point at the RFQ email. */
export type Issue = { text: string; rfq?: boolean };

export type ReviewRow = {
	key: string;
	qty: number | null;
	line: Line | null;
	status: RowStatus;
	issues: Issue[];
};

export type ReviewGroup = {
	key: string;
	requested: RequestedItem | null;
	product: Product | null;
	kind: 'match' | 'alt' | 'nobid' | 'extra';
	rows: ReviewRow[];
};

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

function lineIssues(line: Line): { status: RowStatus | null; issues: Issue[] } {
	const issues: Issue[] = [];
	const missing = LINE_FIELD_DEFS.filter((d) => d.required && isBlank(line[d.field])).map(
		(d) => d.header
	);
	if (missing.length) issues.push({ text: `Missing ${missing.join(', ')}` });
	let status: RowStatus | null = missing.length ? 'incomplete' : null;
	if (line.unitCost !== null && line.price !== null) {
		const expected = line.unitCost * line.quantity;
		if (Math.abs(expected - line.price) > 0.01) {
			issues.push({
				text: `Price ${line.price.toFixed(2)} ≠ ${line.quantity} × ${line.unitCost} = ${expected.toFixed(2)}`
			});
			status ??= 'math';
		}
	}
	return { status, issues };
}

export function buildReview(vendor: Vendor): ReviewGroup[] {
	const used = new Set<string>();
	const groups: ReviewGroup[] = [];

	for (const req of RFQ_ITEMS) {
		let product = vendor.products.find((p) => !used.has(p.id) && p.partNumber.trim() === req.pn);
		let kind: ReviewGroup['kind'] = 'match';
		if (!product) {
			product = vendor.products.find((p) => !used.has(p.id) && p.nsn && p.nsn === req.nsn);
			if (product) kind = 'alt';
		}
		if (product) used.add(product.id);

		const key = `req:${req.index}`;
		if (!product || product.lines.length === 0) {
			groups.push({
				key,
				requested: req,
				product: product ?? null,
				kind: 'nobid',
				rows: [
					{
						key: `${key}:nobid`,
						qty: null,
						line: null,
						status: 'nobid',
						issues: [{ text: product?.additionalNotes || 'Vendor did not quote this part', rfq: true }]
					}
				]
			});
			continue;
		}

		const qtys = [...new Set([...req.qtys, ...product.lines.map((l) => l.quantity)])].sort(
			(a, b) => a - b
		);
		const rows: ReviewRow[] = qtys.map((qty) => {
			const line = product.lines.find((l) => l.quantity === qty) ?? null;
			if (!line) {
				return {
					key: `${key}:${qty}`,
					qty,
					line: null,
					status: 'missing_break',
					issues: [{ text: `Requested qty ${qty} not quoted`, rfq: true }]
				};
			}
			const { status, issues } = lineIssues(line);
			const requestedQty = req.qtys.includes(qty);
			if (!requestedQty) issues.push({ text: `Qty ${qty} was not requested`, rfq: true });
			if (kind === 'alt') issues.push({ text: `Quoted ${product.partNumber} instead of ${req.pn}`, rfq: true });
			return {
				key: `${key}:${qty}`,
				qty,
				line,
				status: status ?? (!requestedQty ? 'extra_break' : kind === 'alt' ? 'alt' : 'ok'),
				issues
			};
		});
		groups.push({ key, requested: req, product, kind, rows });
	}

	for (const product of vendor.products) {
		if (used.has(product.id)) continue;
		const key = `x:${product.id}`;
		groups.push({
			key,
			requested: null,
			product,
			kind: 'extra',
			rows: product.lines.map((line) => {
				const { status, issues } = lineIssues(line);
				return {
					key: `${key}:${line.quantity}`,
					qty: line.quantity,
					line,
					status: status ?? 'extra_part',
					issues: [...issues, { text: `${product.partNumber} was not on the RFQ`, rfq: true }]
				};
			})
		});
	}
	return groups;
}

export function summarize(groups: ReviewGroup[], reviewed: readonly string[]) {
	const rows = groups.flatMap((g) => g.rows);
	const done = new Set(reviewed);
	return {
		total: rows.length,
		confirmed: rows.filter((r) => done.has(r.key)).length,
		attention: rows.filter((r) => STATUS_META[r.status].attention && !done.has(r.key)).length,
		partsQuoted: groups.filter((g) => g.requested && g.kind !== 'nobid').length,
		partsRequested: RFQ_ITEMS.length
	};
}

/** Draft a follow-up from what's actually wrong, instead of a hand-written guess. */
export function draftFollowUp(vendor: Vendor, groups: ReviewGroup[]): string {
	const asks: string[] = [];
	const missingHeader = HEADER_FIELD_DEFS.filter((d) => d.required && isBlank(vendor[d.field])).map(
		(d) => d.header.toLowerCase()
	);
	if (missingHeader.length) asks.push(`Please confirm ${missingHeader.join(', ')}.`);

	for (const g of groups) {
		const pn = g.requested?.pn ?? g.product?.partNumber ?? '';
		if (g.kind === 'nobid') {
			asks.push(`${pn}: no pricing received — can you quote ${g.requested?.qtys.join('/')} pcs?`);
			continue;
		}
		if (g.kind === 'alt' && g.product) {
			asks.push(`${g.product.partNumber}: please confirm this is a direct alternate for ${pn} (same NSN).`);
		}
		if (g.kind === 'extra' && g.product) {
			asks.push(`${g.product.partNumber} wasn't on our RFQ — please confirm it's an optional add-on.`);
		}
		const missingBreaks = g.rows.filter((r) => r.status === 'missing_break').map((r) => r.qty);
		if (missingBreaks.length) {
			asks.push(`${pn}: please add pricing for qty ${missingBreaks.join(', ')}.`);
		}
		// 'incomplete' rows are extraction gaps (value is usually in the source) — the
		// reviewer fills those in; we don't ask the vendor for something they already sent.
	}

	const first = vendor.contactName.split(' ')[0] || 'there';
	if (!asks.length) return `Hi ${first},\n\nThanks — your quote is complete on our end.\n\nThanks,`;
	return [
		`Hi ${first},`,
		'',
		'Thanks for the quote. A few items to close out:',
		'',
		...asks.map((a) => `- ${a}`),
		'',
		'Thanks,'
	].join('\n');
}
