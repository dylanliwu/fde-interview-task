/**
 * Per-viewer review-table preferences (toolbar menu). Conveniences only, so they live in
 * localStorage and never in shared state; every read/write tolerates storage being blocked.
 */
const KEY = 'quoteReview.prefs';

export type Prefs = {
	colors: boolean;
	optionalCols: boolean;
	partInfo: boolean;
	compact: boolean;
	fadeConfirmed: boolean;
	hideConfirmed: boolean;
	jumpToSource: boolean;
	autoAdvance: boolean;
};

export const DEFAULT_PREFS: Prefs = {
	colors: true,
	optionalCols: true,
	partInfo: true,
	compact: false,
	fadeConfirmed: true,
	hideConfirmed: false,
	jumpToSource: true,
	autoAdvance: true
};

export const prefs = $state<Prefs>({ ...DEFAULT_PREFS });

export function loadPrefs() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
		// Migrate the old standalone colour toggle.
		if (localStorage.getItem('quoteReview.colors') === 'off') prefs.colors = false;
		if (saved) {
			for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
				if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
			}
		}
	} catch {}
}

export function togglePref(key: keyof Prefs) {
	prefs[key] = !prefs[key];
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs));
	} catch {}
}
