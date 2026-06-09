import type { AppState, Email, Line, Product, Vendor } from './types';
import { makeEmptyLine } from './fields';

const PARTS = [
	{ pn: 'MS27039-1-08', nsn: '5305-00-984-6210', desc: 'Screw, machine, pan head' },
	{ pn: 'NAS1149F0832P', nsn: '5310-00-167-0816', desc: 'Washer, flat, aluminum' },
	{ pn: 'MS21042L3', nsn: '5310-00-855-1257', desc: 'Nut, self-locking, hex' },
	{ pn: 'M83248/1-006', nsn: '5330-01-130-1932', desc: 'O-Ring, packing, preformed' },
	{ pn: 'AN960-10', nsn: '5310-00-167-0822', desc: 'Washer, flat' },
	{ pn: 'MS35206-228', nsn: '5305-00-984-4988', desc: 'Screw, machine, pan head, cad plated' },
	{ pn: 'MS9556-04', nsn: '4730-00-289-5226', desc: 'Plug, machine thread' },
	{ pn: 'NAS1351-3H8', nsn: '5305-00-728-7891', desc: 'Screw, socket head cap' },
	{ pn: 'MS17985C411', nsn: '5315-00-839-5824', desc: 'Pin, clevis, headed' },
	{ pn: 'AN3-12A', nsn: '5306-00-826-2519', desc: 'Bolt, machine, hex head' }
];

const QTY_TIERS = [
	[100, 250, 500],
	[50, 200, 500],
	[25, 100, 250],
	[10, 50, 200],
	[5, 25, 100]
];

function pick<T>(arr: readonly T[], i: number): T {
	return arr[i % arr.length];
}

function buildProducts(): Product[] {
	return PARTS.map((p, i) => {
		const tiers = pick(QTY_TIERS, i);
		return {
			id: crypto.randomUUID(),
			partNumber: p.pn,
			nsn: p.nsn,
			description: p.desc,
			lines: tiers.map((qty) => makeEmptyLine(qty))
		};
	});
}

function fillVendor1Lines(products: Product[]): Product[] {
	return products.map((product, productIdx) => ({
		...product,
		lines: product.lines.map((line, lineIdx) => {
			const fill = (productIdx + lineIdx) % 10 < 8;
			if (!fill) return line;
			const basePrice = 1.85 + productIdx * 0.55;
			const tierDiscount = 1 - lineIdx * 0.07;
			const fatLine = lineIdx === 0;
			return {
				...line,
				isQuoting: true,
				priceBreaks: Number((basePrice * tierDiscount).toFixed(2)),
				leadTime: 21 + ((productIdx * 3 + lineIdx * 7) % 60),
				dealerOrManufacturer: productIdx % 3 === 0 ? 'Manufacturer' : 'Dealer',
				waiveFat: !fatLine,
				additionalNotes:
					lineIdx === 0 && productIdx === 0
						? 'Prices firm through 30 days. Subject to prior sale.'
						: ''
			} satisfies Line;
		})
	}));
}

function fillVendor2Lines(products: Product[]): Product[] {
	return products.map((product, productIdx) => ({
		...product,
		lines: product.lines.map((line, lineIdx) => {
			const fill = (productIdx + lineIdx + 1) % 10 < 8;
			if (!fill) return line;
			const basePrice = 1.62 + productIdx * 0.48;
			const tierDiscount = 1 - lineIdx * 0.05;
			return {
				...line,
				isQuoting: true,
				priceBreaks: Number((basePrice * tierDiscount).toFixed(2)),
				leadTime: 35 + ((productIdx * 5 + lineIdx * 4) % 75),
				dealerOrManufacturer: 'Dealer',
				waiveFat: true,
				additionalNotes: ''
			} satisfies Line;
		})
	}));
}

function buildVendor1Emails(): Email[] {
	const sentDate = '2026-05-12T14:22:00Z';
	const replyDate = '2026-05-14T09:48:00Z';

	const lineRows = PARTS.map((p, i) => {
		const tiers = pick(QTY_TIERS, i);
		const basePrice = 1.85 + i * 0.55;
		const rows = tiers
			.map((qty, j) => {
				const price = (basePrice * (1 - j * 0.07)).toFixed(2);
				const lead = 21 + ((i * 3 + j * 7) % 60);
				return `   ${String(qty).padStart(4)} ea  @  $${price}   LT ${lead} days`;
			})
			.join('\n');
		return `${i + 1}. PN ${p.pn}  (NSN ${p.nsn})\n${rows}`;
	}).join('\n\n');

	const reply = [
		'Hi Sales Team,',
		'',
		'Thanks for the RFQ on the parts below. Quote is firm 30 days, FOB Buffalo NY.',
		'We are a manufacturer for items 1, 4, 7, 10 (cage 1A2B3); dealer for the rest (actual mfr cage 0K8G6).',
		'FAT required on item 1 only: 1 unit, $285.00, 14 days.',
		'Packaging included. Shipping additional, est. $45 per pallet.',
		'',
		lineRows,
		'',
		'Let me know if you need to firm up by COB Friday.',
		'',
		'Best,',
		'Mike Henderson',
		'Heritage Aero Supply  |  cage 1A2B3',
		'(716) 555-0188'
	].join('\n');

	return [
		{
			id: crypto.randomUUID(),
			from: 'rfq@argus-defense.example',
			fromName: 'Argus Defense RFQ Desk',
			to: 'mike@heritage-aero.example',
			date: sentDate,
			subject: 'RFQ — 10 parts due 5/20',
			body:
				'Hi Heritage team,\n\nPlease quote the attached list of 10 parts. Multiple price breaks per line where possible. Reply-all preferred. Need pricing by 5/20.\n\nThanks,\nArgus Defense RFQ Desk',
			attachments: []
		},
		{
			id: crypto.randomUUID(),
			from: 'mike@heritage-aero.example',
			fromName: 'Mike Henderson',
			to: 'rfq@argus-defense.example',
			date: replyDate,
			subject: 'Re: RFQ — 10 parts due 5/20',
			body: reply,
			attachments: []
		}
	];
}

function buildVendor2Emails(): Email[] {
	const sentDate = '2026-05-12T14:22:00Z';
	const replyDate = '2026-05-15T17:11:00Z';

	const pdfRows = PARTS.map((p, i) => {
		const tiers = pick(QTY_TIERS, i);
		const basePrice = 1.62 + i * 0.48;
		const rows = tiers
			.map((qty, j) => {
				const price = (basePrice * (1 - j * 0.05)).toFixed(2);
				const lead = 35 + ((i * 5 + j * 4) % 75);
				return `   ${String(qty).padStart(5)}   $${price.padStart(7)}    ${lead} days`;
			})
			.join('\n');
		return `${i + 1}. PN ${p.pn}  /  NSN ${p.nsn}\n   QTY        UNIT $       LEAD\n${rows}`;
	}).join('\n\n');

	const pdfText = [
		'                APEX COMPONENTS LLC',
		'                Quote #Q-AC-44218',
		'                Date: 5/15/26     Valid: 45 days',
		'                Cage 7C9X2     FOB Phoenix AZ',
		'─────────────────────────────────────────────────',
		'',
		pdfRows,
		'',
		'─────────────────────────────────────────────────',
		'Terms: NET 30. Packaging additional $12.50 per line.',
		'Shipping included. Subject to prior sale.',
		'',
		'Janet Cole',
		'Apex Components LLC'
	].join('\n');

	return [
		{
			id: crypto.randomUUID(),
			from: 'rfq@argus-defense.example',
			fromName: 'Argus Defense RFQ Desk',
			to: 'sales@apex-components.example',
			date: sentDate,
			subject: 'RFQ — 10 parts due 5/20',
			body:
				'Hi Apex,\n\nPlease quote on the 10-part list (multiple price breaks where possible). Reply by 5/20.\n\nThanks,\nArgus Defense',
			attachments: []
		},
		{
			id: crypto.randomUUID(),
			from: 'sales@apex-components.example',
			fromName: 'Janet Cole',
			to: 'rfq@argus-defense.example',
			date: replyDate,
			subject: 'Re: RFQ — 10 parts due 5/20  (quote attached)',
			body:
				'Hi,\n\nPlease see attached quote for all 10 parts. Tiers reflect best price per qty break. Valid 45 days.\n\nThanks,\nJanet Cole\nApex Components LLC',
			attachments: [
				{
					id: crypto.randomUUID(),
					filename: 'apex-quote-Q-AC-44218.pdf',
					pages: [pdfText]
				}
			]
		}
	];
}

export function buildSeedState(): AppState {
	const vendor1: Vendor = {
		id: crypto.randomUUID(),
		name: 'Heritage Aero Supply',
		contactName: 'Mike Henderson',
		contactEmail: 'mike@heritage-aero.example',
		cage: '1A2B3',
		submittedAt: null,
		emails: [],
		products: []
	};
	vendor1.emails = buildVendor1Emails();
	vendor1.products = fillVendor1Lines(buildProducts());

	const vendor2: Vendor = {
		id: crypto.randomUUID(),
		name: 'Apex Components LLC',
		contactName: 'Janet Cole',
		contactEmail: 'sales@apex-components.example',
		cage: '7C9X2',
		submittedAt: null,
		emails: [],
		products: []
	};
	vendor2.emails = buildVendor2Emails();
	vendor2.products = fillVendor2Lines(buildProducts());

	return {
		vendors: [vendor1, vendor2]
	};
}
