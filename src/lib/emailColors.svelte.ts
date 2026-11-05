/**
 * Per-email highlight colour, so a reviewer can tell e.g. "my RFQ" (blue) from "their reply"
 * (red) at a glance when the highlight jumps between them. Per-viewer convenience, so it
 * lives in localStorage keyed by email id. `none` keeps the default yellow highlight.
 */
const KEY = 'quoteReview.emailColors';

export const EMAIL_COLORS = {
	none: {
		label: 'None',
		swatch: 'border border-dashed border-gray-400',
		edge: '',
		block: 'bg-yellow-100',
		line: 'bg-yellow-300 ring-2 ring-yellow-400'
	},
	blue: {
		label: 'Blue',
		swatch: 'bg-blue-500',
		edge: 'shadow-[inset_3px_0_0_var(--color-blue-500)]',
		block: 'bg-blue-500/20',
		line: 'bg-blue-500/45 ring-2 ring-blue-400'
	},
	red: {
		label: 'Red',
		swatch: 'bg-rose-500',
		edge: 'shadow-[inset_3px_0_0_var(--color-rose-500)]',
		block: 'bg-rose-500/20',
		line: 'bg-rose-500/45 ring-2 ring-rose-400'
	},
	green: {
		label: 'Green',
		swatch: 'bg-emerald-500',
		edge: 'shadow-[inset_3px_0_0_var(--color-emerald-500)]',
		block: 'bg-emerald-500/20',
		line: 'bg-emerald-500/45 ring-2 ring-emerald-400'
	},
	amber: {
		label: 'Amber',
		swatch: 'bg-amber-500',
		edge: 'shadow-[inset_3px_0_0_var(--color-amber-500)]',
		block: 'bg-amber-500/20',
		line: 'bg-amber-500/45 ring-2 ring-amber-400'
	},
	violet: {
		label: 'Violet',
		swatch: 'bg-violet-500',
		edge: 'shadow-[inset_3px_0_0_var(--color-violet-500)]',
		block: 'bg-violet-500/20',
		line: 'bg-violet-500/45 ring-2 ring-violet-400'
	}
} as const;

export type EmailColor = keyof typeof EMAIL_COLORS;
export const EMAIL_COLOR_KEYS = Object.keys(EMAIL_COLORS) as EmailColor[];

const colors = $state<Record<string, EmailColor>>({});
let loaded = false;

function ensureLoaded() {
	if (loaded || typeof localStorage === 'undefined') return;
	loaded = true;
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
		for (const [id, c] of Object.entries(saved)) if (c in EMAIL_COLORS) colors[id] = c as EmailColor;
	} catch {}
}

export function emailColor(emailId: string): EmailColor {
	ensureLoaded();
	return colors[emailId] ?? 'none';
}

export function setEmailColor(emailId: string, color: EmailColor) {
	ensureLoaded();
	if (color === 'none') delete colors[emailId];
	else colors[emailId] = color;
	try {
		localStorage.setItem(KEY, JSON.stringify(colors));
	} catch {}
}
