import type { Vendor } from './types';

/**
 * Source linking: find where a part (and optionally a qty line) appears in the vendor's
 * inbound correspondence — email bodies and attachment pages — so the source pane can
 * scroll to and highlight it. Works on any plain text, so it's format-agnostic.
 */
export type SourceMatch = {
	sourceId: string; // `${emailId}` or `${emailId}:${attachmentId}:${pageIdx}`
	emailId: string;
	attachmentId: string | null;
	block: [number, number];
	line: [number, number] | null;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function locate(text: string, pn: string, qty: number | null) {
	const header = new RegExp(`^[ \\t]*\\d+[.)][ \\t]+${esc(pn)}(?![\\w-])`, 'm');
	const loose = new RegExp(`${esc(pn)}(?![\\w-])`);
	const m = header.exec(text) ?? loose.exec(text);
	if (!m) return null;
	const start = text.lastIndexOf('\n', m.index) + 1;
	const brk = text.indexOf('\n\n', m.index);
	const end = brk === -1 ? text.length : brk;
	let line: [number, number] | null = null;
	if (qty !== null) {
		const block = text.slice(start, end);
		const q = new RegExp(`(?:qty\\s*${qty}\\b|\\b${qty}\\s*(?:ea|pcs|pc)\\b)`, 'i').exec(block);
		if (q) {
			const ls = block.lastIndexOf('\n', q.index) + 1;
			const le = block.indexOf('\n', q.index);
			line = [start + ls, le === -1 ? end : start + le];
		}
	}
	return { block: [start, end] as [number, number], line };
}

export function findInVendor(vendor: Vendor, pn: string, qty: number | null): SourceMatch | null {
	const outbound = vendor.emails[0]?.from;
	const inbound = vendor.emails.filter((e) => e.from !== outbound).reverse(); // newest first
	for (const email of inbound) {
		for (const att of email.attachments) {
			for (let i = 0; i < att.pages.length; i++) {
				const hit = locate(att.pages[i], pn, qty);
				if (hit)
					return { sourceId: `${email.id}:${att.id}:${i}`, emailId: email.id, attachmentId: att.id, ...hit };
			}
		}
		const hit = locate(email.body, pn, qty);
		if (hit) return { sourceId: email.id, emailId: email.id, attachmentId: null, ...hit };
	}
	return null;
}

/** Currently focused source location — shared by the grid and the source pane. */
export const sourceFocus = $state<{ match: SourceMatch | null; nonce: number }>({
	match: null,
	nonce: 0
});

export function focusSource(match: SourceMatch | null) {
	sourceFocus.match = match;
	sourceFocus.nonce++;
}
