/**
 * Detail-page layout preference: which side the source pane sits on and how wide it is.
 * Per-viewer convenience, so it lives in localStorage (never in shared state).
 */
const KEY = 'quoteReview.layout';
export const EMAIL_MIN = 25;
export const EMAIL_MAX = 65;
export const EMAIL_DEFAULT = 42;

export const layout = $state({ emailPct: EMAIL_DEFAULT, swapped: false });

export function loadLayout() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (saved && typeof saved.emailPct === 'number') layout.emailPct = clampPct(saved.emailPct);
		if (saved && typeof saved.swapped === 'boolean') layout.swapped = saved.swapped;
	} catch {}
}

export function saveLayout() {
	try {
		localStorage.setItem(KEY, JSON.stringify(layout));
	} catch {}
}

export function clampPct(pct: number) {
	return Math.min(EMAIL_MAX, Math.max(EMAIL_MIN, pct));
}

export function toggleSwapped() {
	layout.swapped = !layout.swapped;
	saveLayout();
}
