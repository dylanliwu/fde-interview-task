<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Line, Product, Vendor } from '$lib/types';
	import {
		HEADER_FIELD_DEFS,
		LINE_FIELD_DEFS,
		PRODUCT_FIELD_DEFS,
		makeEmptyLine,
		type FieldDef
	} from '$lib/fields';
	import { store } from '$lib/store.svelte';
	import {
		buildReview,
		summarize,
		STATUS_META,
		TONES,
		type Issue,
		type ReviewGroup,
		type ReviewRow,
		type RowStatus,
		type Tone
	} from '$lib/review';
	import { findInRequest, findInVendor, focusSource } from '$lib/source.svelte';
	import {
		Check,
		ChevronRight,
		Plus,
		Info,
		X,
		Menu,
		Minus,
		Palette,
		ArrowLeftRight,
		Trash2,
		Undo2,
		Columns3,
		Rows3,
		EyeOff,
		Crosshair,
		ChevronsUpDown,
		ChevronsDownUp,
		RotateCcw,
		Tag,
		CornerDownLeft,
		Contrast
	} from '@lucide/svelte';
	import { layout, toggleSwapped, saveLayout, EMAIL_DEFAULT } from '$lib/layout.svelte';
	import { prefs, loadPrefs, togglePref, type Prefs } from '$lib/prefs.svelte';
	import CompactField from './CompactField.svelte';

	let { vendor }: { vendor: Vendor } = $props();

	// --- schema-driven columns: every non-textarea line field is a column ---
	// isQuoting is hidden: a row only exists because the vendor quoted it, and the "Not quoted"
	// status already covers no-bids, so the checkbox was noise. The data is kept untouched.
	const HIDDEN_COLS = new Set<keyof Line>(['isQuoting']);
	const ALL_LINE_COLS = LINE_FIELD_DEFS.filter((d) => d.type !== 'textarea' && !HIDDEN_COLS.has(d.field));
	const LINE_NOTE_DEFS = LINE_FIELD_DEFS.filter((d) => d.type === 'textarea');
	const SHORT_HEADER: Partial<Record<keyof Line, string>> = {
		isQuoting: 'Quoting',
		quantity: 'Qty',
		isFat: 'FAT',
		unitCost: 'Unit cost',
		variance: 'Var',
		price: 'Ext price',
		currency: 'Cur',
		leadTime: 'Lead (d)'
	};
	const COL_WIDTH: Partial<Record<keyof Line, string>> = {
		isQuoting: 'w-14',
		quantity: 'w-14',
		isFat: 'w-10',
		unitCost: 'w-24',
		variance: 'w-16',
		price: 'w-28',
		currency: 'w-[4.5rem]',
		leadTime: 'w-20'
	};

	let headerOpen = $state(false);
	/** Cursor row: drives the source highlight. */
	let selectedKey = $state<string | null>(null);
	/** Last checkbox clicked — the start of a shift+click range (Gmail-style). */
	let anchorKey: string | null = null;
	let expanded = $state(new Set<string>());

	// --- per-viewer preferences (toolbar menu) ---
	onMount(loadPrefs);
	const colors = $derived(prefs.colors);
	const lineCols = $derived(prefs.optionalCols ? ALL_LINE_COLS : ALL_LINE_COLS.filter((d) => d.required));
	const qtyIdx = $derived(lineCols.findIndex((d) => d.field === 'quantity'));
	const colspan = $derived(3 + lineCols.length); // ✓ + status + line fields + delete

	// --- toolbar menu + guide panel ---
	let menuOpen = $state(false);
	let guideOpen = $state(false);

	const TONE_CLS: Record<Tone, { row: string; bar: string; pill: string; swatch: string }> = {
		ok: {
			row: 'bg-emerald-500/[0.06]',
			bar: 'shadow-[inset_3px_0_0_var(--color-emerald-500)]',
			pill: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
			swatch: 'bg-emerald-500'
		},
		diff: {
			row: 'bg-amber-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-amber-500)]',
			pill: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
			swatch: 'bg-amber-500'
		},
		extra: {
			row: 'bg-violet-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-violet-500)]',
			pill: 'border-violet-500/40 bg-violet-500/15 text-violet-400',
			swatch: 'bg-violet-500'
		},
		bad: {
			row: 'bg-rose-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-rose-500)]',
			pill: 'border-rose-500/40 bg-rose-500/15 text-rose-400',
			swatch: 'bg-rose-500'
		}
	};
	const NEUTRAL_PILL = 'border-gray-300 bg-gray-100 text-gray-700';
	const BAD_CELL = 'bg-rose-500/15 ring-1 ring-inset ring-rose-500/60';

	const STATUSES_BY_TONE = (Object.keys(TONES) as Tone[]).map((tone) => ({
		tone,
		statuses: (Object.keys(STATUS_META) as RowStatus[]).filter((s) => STATUS_META[s].tone === tone)
	}));

	// --- review model ---
	const groups = $derived(buildReview(vendor));
	const reviewed = $derived(new Set(vendor.reviewedRows ?? []));
	const summary = $derived(summarize(groups, vendor.reviewedRows ?? []));
	const todoCount = $derived(summary.total - summary.confirmed);
	const allConfirmed = $derived(summary.total > 0 && summary.confirmed === summary.total);
	const someConfirmed = $derived(summary.confirmed > 0 && !allConfirmed);

	// Quote header collapses to a one-line summary; missing required values stay visible.
	const headerMissing = $derived(
		HEADER_FIELD_DEFS.filter((d) => d.required && blank(vendor[d.field])).map((d) => d.header)
	);
	const headerSummary = $derived(
		HEADER_FIELD_DEFS.filter((d) => d.type !== 'textarea' && !blank(vendor[d.field]))
			.map((d) => (d.field === 'daysQuoteValid' ? `valid ${vendor[d.field]} days` : String(vendor[d.field])))
			.join(' · ')
	);

	const shownRows = (g: ReviewGroup) =>
		prefs.hideConfirmed ? g.rows.filter((r) => !reviewed.has(r.key)) : g.rows;
	const visibleRows = $derived(groups.flatMap((g) => shownRows(g).map((r) => ({ g, r }))));

	// --- part stock status: refetch only when the set of PNs changes, not on every edit ---
	type PartStatus = { partNumber: string; stockStatus: 'in_stock' | 'low_stock'; lastQuoted: string };
	let partStatuses = $state<Record<string, PartStatus>>({});
	const pnKey = $derived(vendor.products.map((p) => p.partNumber).join('|'));
	$effect(() => {
		const pns = pnKey.split('|').filter(Boolean);
		let cancelled = false;
		void Promise.all(
			pns.map((pn) =>
				fetch(`/api/parts/${encodeURIComponent(pn)}/status`)
					.then((r) => r.json() as Promise<PartStatus>)
					.catch(() => null)
			)
		).then((results) => {
			if (cancelled) return;
			const next: Record<string, PartStatus> = {};
			for (const s of results) if (s) next[s.partNumber] = s;
			partStatuses = next;
		});
		return () => (cancelled = true);
	});

	// --- actions ---
	function rangeKeys(fromKey: string, toKey: string) {
		const keys = visibleRows.map((x) => x.r.key);
		const a = keys.indexOf(fromKey);
		const b = keys.indexOf(toKey);
		if (a === -1 || b === -1) return [toKey];
		return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
	}

	function select(g: ReviewGroup, r: ReviewRow | null) {
		selectedKey = r?.key ?? null;
		const qty = r?.qty ?? null;
		const pn = g.product?.partNumber || g.requested?.pn || '';
		if (!prefs.jumpToSource) return;
		focusSource(
			findInVendor(vendor, pn, qty) ?? (g.requested ? findInVendor(vendor, g.requested.pn, qty) : null)
		);
	}

	/** Jump the source pane to what we asked for in the RFQ (for request-related issues). */
	function showInRfq(g: ReviewGroup, e: MouseEvent) {
		e.stopPropagation();
		focusSource(findInRequest(vendor, g.requested?.pn ?? null));
	}

	function toggleConfirm(key: string) {
		store.setReviewed(vendor.id, [key], !reviewed.has(key));
		anchorKey = key;
	}

	/**
	 * Checkbox click. With Shift held, every row between the previously clicked checkbox and
	 * this one gets the same new state as this one (Gmail-style range check).
	 */
	function clickCheckbox(r: ReviewRow, e: MouseEvent) {
		e.stopPropagation();
		const value = !reviewed.has(r.key);
		const keys = e.shiftKey && anchorKey && anchorKey !== r.key ? rangeKeys(anchorKey, r.key) : [r.key];
		store.setReviewed(vendor.id, keys, value);
		anchorKey = r.key;
	}

	function toggleAll() {
		store.setReviewed(vendor.id, visibleRows.map((x) => x.r.key), !allConfirmed);
	}


	function updateLine(productId: string, lineId: string, patch: Partial<Line>) {
		store.updateLine(vendor.id, productId, lineId, patch);
	}

	function updateProduct(productId: string, patch: Partial<Product>) {
		store.updateProduct(vendor.id, productId, patch);
	}

	function addLine(g: ReviewGroup, qty: number) {
		if (!g.product) return;
		const currency = g.product.lines.find((l) => l.currency)?.currency ?? '';
		store.addLine(vendor.id, g.product.id, { ...makeEmptyLine(qty), isQuoting: true, currency });
	}

	// --- delete a line (not submitted), with a short-lived undo ---
	type Removed = { productId: string; line: Line; key: string; wasConfirmed: boolean };
	let lastRemoved = $state<Removed | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | null = null;

	function deleteLine(g: ReviewGroup, r: ReviewRow) {
		if (!g.product || !r.line) return;
		const wasConfirmed = reviewed.has(r.key);
		const line = store.removeLine(vendor.id, g.product.id, r.line.id);
		if (!line) return;
		if (wasConfirmed) store.setReviewed(vendor.id, [r.key], false);
		lastRemoved = { productId: g.product.id, line, key: r.key, wasConfirmed };
		if (undoTimer) clearTimeout(undoTimer);
		undoTimer = setTimeout(() => (lastRemoved = null), 8000);
	}

	function undoDelete() {
		if (!lastRemoved) return;
		const { productId, line, key, wasConfirmed } = lastRemoved;
		store.addLine(vendor.id, productId, line);
		if (wasConfirmed) store.setReviewed(vendor.id, [key], true);
		lastRemoved = null;
		if (undoTimer) clearTimeout(undoTimer);
	}

	function expandAll(open: boolean) {
		expanded = new Set(open ? groups.filter((g) => g.product).map((g) => g.key) : []);
		menuOpen = false;
	}

	function resetWidth() {
		layout.emailPct = EMAIL_DEFAULT;
		saveLayout();
		menuOpen = false;
	}

	function toggleExpand(key: string) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
	}

	const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
	const blank = (v: unknown) => v === null || v === undefined || v === '';

	function shortDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	// --- keyboard: ↑/↓ or j/k to move, Enter/Space to confirm + advance ---
	function move(delta: number) {
		if (!visibleRows.length) return;
		const i = visibleRows.findIndex((x) => x.r.key === selectedKey);
		const n = Math.max(0, Math.min(visibleRows.length - 1, i === -1 ? 0 : i + delta));
		const { g, r } = visibleRows[n];
		select(g, r);
		document.getElementById(`row-${r.key}`)?.scrollIntoView({ block: 'nearest' });
	}

	onMount(() => {
		function onKey(e: KeyboardEvent) {
			const t = e.target as HTMLElement | null;
			if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
			if (e.key === 'ArrowDown' || e.key === 'j') {
				e.preventDefault();
				move(1);
			} else if (e.key === 'ArrowUp' || e.key === 'k') {
				e.preventDefault();
				move(-1);
			} else if ((e.key === 'Enter' || e.key === ' ') && selectedKey) {
				e.preventDefault();
				const key = selectedKey;
				const wasConfirmed = reviewed.has(key);
				toggleConfirm(key);
				if (!wasConfirmed && prefs.autoAdvance) move(1);
			} else if (e.key === 'Escape' && (menuOpen || guideOpen)) {
				// Registered before the page's handler, so this keeps Esc from leaving the page.
				e.stopImmediatePropagation();
				menuOpen = false;
				guideOpen = false;
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Reset selection when switching vendors.
	$effect(() => {
		void vendor.id;
		untrack(() => {
			selectedKey = null;
			anchorKey = null;
			expanded = new Set();
		});
	});

	const MENU_ITEM =
		'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-gray-800 hover:bg-gray-100';

	const cellInput =
		'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-gray-900 tabular-nums hover:border-gray-300 focus:border-blue-500 focus:bg-gray-50 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
	/** Read-only text laid out exactly like a cellInput, so it lines up with editable cells. */
	const cellText = 'block border border-transparent px-1.5 py-1 text-[13px] tabular-nums';
</script>

{#snippet toggleItem(key: keyof Prefs, label: string, Icon: any, hint?: string)}
	<button
		type="button"
		role="menuitemcheckbox"
		aria-checked={prefs[key]}
		class={MENU_ITEM}
		onclick={() => togglePref(key)}
	>
		<Icon class="h-4 w-4 shrink-0 text-gray-500" />
		<span class="min-w-0 flex-1">
			<span class="block">{label}</span>
			{#if hint}<span class="block text-[10px] text-gray-500">{hint}</span>{/if}
		</span>
		<span
			class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors {prefs[key]
				? 'bg-blue-600'
				: 'bg-gray-300'}"
		>
			<span
				class="absolute h-3 w-3 rounded-full bg-gray-900 transition-transform {prefs[key]
					? 'translate-x-3.5'
					: 'translate-x-0.5'}"
			></span>
		</span>
	</button>
{/snippet}

{#snippet pill(status: RowStatus)}
	{@const meta = STATUS_META[status]}
	<span
		class="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide {colors
			? TONE_CLS[meta.tone].pill
			: NEUTRAL_PILL}"
		title={meta.help}>{meta.label}</span
	>
{/snippet}

{#snippet issueText(issue: Issue, g: ReviewGroup)}
	{#if issue.rfq}
		<button
			type="button"
			class="inline cursor-pointer text-left underline decoration-dotted decoration-gray-500 underline-offset-2 hover:text-blue-400 hover:decoration-blue-400"
			title="Show what we requested in the RFQ email"
			onclick={(e) => showInRfq(g, e)}>{issue.text}</button
		>
	{:else}
		<span>{issue.text}</span>
	{/if}
{/snippet}

{#snippet lineCell(def: FieldDef<Line>, line: Line, pid: string, row: ReviewRow, g: ReviewGroup)}
	{@const v = line[def.field]}
	{@const isBad =
		colors && ((def.required && blank(v)) || (def.field === 'price' && row.status === 'math'))}
	{#if def.field === 'quantity'}
		<!-- Qty commits on change (blur/Enter), not per keystroke: it re-keys the row against the RFQ. -->
		<input
			type="number"
			step="1"
			class="{cellInput} text-right font-mono {isBad ? BAD_CELL : ''}"
			value={line.quantity}
			onclick={(e) => e.stopPropagation()}
			onfocus={() => select(g, row)}
			onchange={(e) => {
				const q = num(e.currentTarget.value);
				if (q !== null) updateLine(pid, line.id, { quantity: q });
			}}
		/>
	{:else if def.type === 'checkbox'}
		<button
			type="button"
			class="mx-auto flex h-5 w-5 items-center justify-center rounded border text-[10px] {v === true
				? 'border-blue-500 bg-blue-500/20 text-blue-400'
				: v === false
					? 'border-gray-300 text-gray-500'
					: 'border-dashed border-gray-300 text-gray-400'}"
			title="{def.header} {v === true ? 'Yes' : v === false ? 'No' : 'Not set'}"
			aria-pressed={v === true}
			onclick={(e) => {
				e.stopPropagation();
				updateLine(pid, line.id, { [def.field]: v === true ? false : true } as Partial<Line>);
			}}
		>
			{#if v === true}<Check class="h-3 w-3" strokeWidth={3} />{:else if v === false}<X class="h-3 w-3" />{/if}
		</button>
	{:else if def.type === 'single_select'}
		<select
			class="{cellInput} px-1 {isBad ? BAD_CELL : ''}"
			value={(v as string) ?? ''}
			onclick={(e) => e.stopPropagation()}
			onfocus={() => select(g, row)}
			onchange={(e) => updateLine(pid, line.id, { [def.field]: e.currentTarget.value } as Partial<Line>)}
		>
			<option value="">—</option>
			{#each def.options ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
		</select>
	{:else if def.type === 'text'}
		<input
			type="text"
			class="{cellInput} {isBad ? BAD_CELL : ''}"
			value={(v as string) ?? ''}
			onclick={(e) => e.stopPropagation()}
			onfocus={() => select(g, row)}
			oninput={(e) => updateLine(pid, line.id, { [def.field]: e.currentTarget.value } as Partial<Line>)}
		/>
	{:else}
		{@const expected =
			def.field === 'price' && line.unitCost !== null ? (line.unitCost * line.quantity).toFixed(2) : ''}
		<input
			type="number"
			step={def.type === 'integer' ? '1' : '0.01'}
			class="{cellInput} text-right {isBad ? BAD_CELL : ''}"
			value={blank(v) ? '' : String(v)}
			placeholder={expected}
			title={expected ? `qty × unit cost = ${expected}` : ''}
			onclick={(e) => e.stopPropagation()}
			onfocus={() => select(g, row)}
			oninput={(e) => updateLine(pid, line.id, { [def.field]: num(e.currentTarget.value) } as Partial<Line>)}
		/>
	{/if}
{/snippet}

<section class="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
	<!-- Toolbar -->
	<header class="relative flex items-center gap-3 border-b border-gray-200 px-4 py-2">
		<p class="min-w-0 flex-1 truncate text-xs text-gray-500">
			{#if todoCount === 0}
				<span class="font-medium text-emerald-400">All {summary.total} rows confirmed</span>
			{:else}
				<span class="font-semibold tabular-nums text-gray-900">{todoCount}</span> of {summary.total} left to confirm
			{/if}
			<span class="text-gray-400"> · </span>
			<span class="tabular-nums">{vendor.products.length} parts</span>
			<span class="text-gray-500">({summary.partsQuoted}/{summary.partsRequested} requested quoted)</span>
		</p>

		{#if lastRemoved}
			<span class="inline-flex shrink-0 items-center gap-2 rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-700">
				Removed qty {lastRemoved.line.quantity} line
				<button
					type="button"
					class="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300"
					onclick={undoDelete}><Undo2 class="h-3 w-3" /> Undo</button
				>
			</span>
		{/if}

		<button
			type="button"
			class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 {menuOpen
				? 'bg-gray-100 text-gray-900'
				: ''}"
			aria-label="Table options"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => {
				menuOpen = !menuOpen;
				guideOpen = false;
			}}
		>
			<Menu class="h-4 w-4" />
		</button>

		{#if menuOpen || guideOpen}
			<!-- click-away backdrop -->
			<button
				type="button"
				class="fixed inset-0 z-30 cursor-default"
				aria-label="Close"
				tabindex="-1"
				onclick={() => {
					menuOpen = false;
					guideOpen = false;
				}}
			></button>
		{/if}

		{#if menuOpen}
			<div
				role="menu"
				class="absolute right-3 top-full z-40 mt-1 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-2xl shadow-black/60"
			>
				<p class="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Layout</p>
				<button type="button" role="menuitem" class={MENU_ITEM} onclick={() => { toggleSwapped(); menuOpen = false; }}>
					<ArrowLeftRight class="h-4 w-4 text-gray-500" />
					<span class="flex-1">Swap sides</span>
					<span class="text-[11px] text-gray-500">{layout.swapped ? 'Table left' : 'Table right'}</span>
				</button>
				<button type="button" role="menuitem" class={MENU_ITEM} onclick={resetWidth}>
					<RotateCcw class="h-4 w-4 text-gray-500" />
					<span class="flex-1">Reset panel widths</span>
				</button>
				{@render toggleItem('compact', 'Compact rows', Rows3, 'Fit more rows on screen')}

				<div class="my-1 h-px bg-gray-200"></div>
				<p class="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Table</p>
				{@render toggleItem('colors', 'Colour coding', Palette, 'Tint rows by status')}
				{@render toggleItem('optionalCols', 'Optional columns', Columns3, 'FAT and Variance')}
				{@render toggleItem('partInfo', 'NSN & description', Tag, 'In each part header')}
				{@render toggleItem('fadeConfirmed', 'Fade confirmed rows', Contrast)}
				{@render toggleItem('hideConfirmed', 'Hide confirmed rows', EyeOff, 'Show only what is left')}
				<button type="button" role="menuitem" class={MENU_ITEM} onclick={() => expandAll(true)}>
					<ChevronsUpDown class="h-4 w-4 text-gray-500" />
					<span class="flex-1">Expand all details</span>
				</button>
				<button type="button" role="menuitem" class={MENU_ITEM} onclick={() => expandAll(false)}>
					<ChevronsDownUp class="h-4 w-4 text-gray-500" />
					<span class="flex-1">Collapse all details</span>
				</button>

				<div class="my-1 h-px bg-gray-200"></div>
				<p class="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Reviewing</p>
				{@render toggleItem('jumpToSource', 'Jump to source on click', Crosshair, 'Highlight the email text')}
				{@render toggleItem('autoAdvance', 'Next row after confirming', CornerDownLeft, 'When pressing Enter')}

				<div class="my-1 h-px bg-gray-200"></div>
				<button type="button" role="menuitem" class={MENU_ITEM} onclick={() => { menuOpen = false; guideOpen = true; }}>
					<Info class="h-4 w-4 text-gray-500" />
					<span class="flex-1">How to read this table</span>
				</button>
			</div>
		{/if}

		{#if guideOpen}
			<div
				class="absolute right-3 top-full z-40 mt-1 max-h-[75vh] w-[460px] overflow-y-auto rounded-xl border border-gray-200 bg-white text-xs shadow-2xl shadow-black/60"
			>
				<div class="border-b border-gray-200 px-4 py-3">
					<div class="flex items-center justify-between">
						<p class="text-sm font-semibold text-gray-900">How to read this table</p>
						<button
							type="button"
							class="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
							aria-label="Close guide"
							onclick={() => (guideOpen = false)}><X class="h-3.5 w-3.5" /></button
						>
					</div>
					<p class="mt-1 leading-relaxed text-gray-600">
						Each row is <b class="text-gray-800">one quantity of one part</b>. It compares what the AI
						pulled out of the vendor's reply with what we asked for in the RFQ.
					</p>
					<ol class="mt-2.5 space-y-1.5 text-gray-700">
						{#each ['Click a row. Its source text lights up in the email on the left.', 'Check the numbers match. Fix any cell inline.', 'Tick the box (or press Enter) to confirm and move on.'] as step, i (i)}
							<li class="flex gap-2">
								<span
									class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-800"
									>{i + 1}</span
								>
								<span>{step}</span>
							</li>
						{/each}
					</ol>
				</div>

				{#each STATUSES_BY_TONE as { tone, statuses } (tone)}
					<section class="border-b border-gray-200 px-4 py-3">
						<div class="flex items-center gap-2">
							<span class="h-3.5 w-1 rounded-full {TONE_CLS[tone].swatch}"></span>
							<h4 class="font-semibold text-gray-900">{TONES[tone].title}</h4>
						</div>
						<p class="ml-3 mt-0.5 text-gray-500">{TONES[tone].help}</p>
						<dl class="ml-3 mt-2 grid grid-cols-[7.5rem_1fr] items-start gap-x-3 gap-y-2">
							{#each statuses as s (s)}
								<dt>{@render pill(s)}</dt>
								<dd class="leading-relaxed text-gray-600">{STATUS_META[s].help}</dd>
							{/each}
						</dl>
					</section>
				{/each}

				<div class="space-y-1.5 px-4 py-3 text-gray-600">
					<p class="flex items-center gap-2">
						<span class="h-3.5 w-6 shrink-0 rounded {BAD_CELL}"></span>
						Red cell: a required value is empty or doesn't add up.
					</p>
					<p class="flex items-center gap-2">
						<span class="flex h-3.5 w-6 shrink-0 items-center justify-center"
							><span class="h-3 w-3 rounded-sm bg-emerald-500"></span></span
						>
						Ticked rows fade out so the remaining work stands out.
					</p>
					<p class="pt-1 text-[11px] leading-relaxed text-gray-500">
						<kbd class="rounded border border-gray-300 px-1 font-mono">↑</kbd>
						<kbd class="rounded border border-gray-300 px-1 font-mono">↓</kbd> move ·
						<kbd class="rounded border border-gray-300 px-1 font-mono">Enter</kbd> confirm &amp; next ·
						<kbd class="rounded border border-gray-300 px-1 font-mono">Shift</kbd>+click a checkbox to tick
						everything since the last one · header checkbox ticks all rows
					</p>
				</div>
			</div>
		{/if}
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Quote header -->
		<div class="border-b border-gray-200">
			<button
				type="button"
				class="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs hover:bg-gray-100/60"
				aria-expanded={headerOpen}
				onclick={() => (headerOpen = !headerOpen)}
			>
				<ChevronRight class="h-3 w-3 shrink-0 text-gray-500 transition-transform {headerOpen ? 'rotate-90' : ''}" />
				<span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quote header</span>
				{#if !headerOpen}
					<span class="min-w-0 truncate text-gray-700">{headerSummary}</span>
				{/if}
				{#if headerMissing.length}
					<span
						class="ml-auto shrink-0 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 text-[10px] font-semibold text-rose-400"
						title="Missing: {headerMissing.join(', ')}">{headerMissing.length} missing</span
					>
				{/if}
			</button>
			{#if headerOpen}
				<div class="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 pb-2.5 sm:grid-cols-2 xl:grid-cols-3">
					{#each HEADER_FIELD_DEFS as def (def.field)}
						<CompactField
							{def}
							value={vendor[def.field] as string | number | null}
							onChange={(value) => store.updateVendor(vendor.id, { [def.field]: value } as Partial<Vendor>)}
						/>
					{/each}
				</div>
			{/if}
		</div>

		<table
			class="w-full border-collapse text-[13px] {prefs.compact
				? 'text-xs [&_input]:py-0! [&_select]:py-0! [&_td]:py-px!'
				: ''}"
		>
			<thead class="sticky top-0 z-20 bg-white text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_var(--color-gray-200)]">
				<tr>
					<th class="w-9 px-2 py-2">
						<button
							type="button"
							class="mx-auto flex h-5 w-5 items-center justify-center rounded border {allConfirmed || someConfirmed
								? 'border-emerald-500 bg-emerald-500 text-gray-50'
								: 'border-gray-400 hover:border-gray-700'}"
							aria-label={allConfirmed ? 'Unconfirm all rows' : 'Confirm all rows'}
							title={allConfirmed ? 'Unconfirm all rows' : 'Confirm all rows'}
							onclick={toggleAll}
						>
							{#if allConfirmed}<Check class="h-3 w-3" strokeWidth={3.5} />{:else if someConfirmed}<Minus
									class="h-3 w-3"
									strokeWidth={3.5}
								/>{/if}
						</button>
					</th>
					<th class="px-2 py-2 text-left font-semibold">Status</th>
					{#each lineCols as def (def.field)}
						<th
							class="px-1.5 py-2 font-semibold {COL_WIDTH[def.field] ?? ''} {def.type === 'checkbox'
								? 'text-center'
								: def.type === 'text' || def.type === 'single_select'
									? 'text-left'
									: 'text-right'}"
							title={def.header}
						>
							{SHORT_HEADER[def.field] ?? def.header}{#if def.required}<span class="text-rose-500">*</span>{/if}
						</th>
					{/each}
					<th class="w-8"><span class="sr-only">Delete</span></th>
				</tr>
			</thead>
			{#each groups as g, gi (g.key)}
				{@const rows = shownRows(g)}
				{#if rows.length}
					{@const stock = g.product ? partStatuses[g.product.partNumber] : undefined}
					<tbody>
						<!-- Part header: requested vs quoted PN, NSN, description, requested qtys -->
						<tr class="cursor-pointer border-t-8 border-gray-50 bg-gray-100/70" onclick={() => select(g, null)}>
							<td colspan={colspan} class="px-2 py-1.5">
								<div class="flex items-center gap-2">
									<span class="w-6 text-center font-mono text-[11px] text-gray-500">{g.requested ? gi + 1 : '+'}</span>
									{#if g.kind === 'extra'}
										<span class="font-mono font-semibold text-gray-900">{g.product?.partNumber}</span>
										<span class="text-[11px] text-gray-500">not on RFQ</span>
									{:else if g.kind === 'alt'}
										<span class="font-mono text-gray-500 line-through decoration-gray-500">{g.requested?.pn}</span>
										<span class="text-gray-500">→</span>
										<span class="font-mono font-semibold {colors ? 'text-amber-400' : 'text-gray-900'}">{g.product?.partNumber}</span>
									{:else}
										<span class="font-mono font-semibold text-gray-900">{g.requested?.pn}</span>
									{/if}
									{#if stock}
										<span
											class="rounded px-1 text-[10px] font-semibold uppercase {stock.stockStatus === 'in_stock'
												? 'text-emerald-400'
												: 'text-amber-400'}"
											title="Last quoted {shortDate(stock.lastQuoted)}"
											>{stock.stockStatus === 'in_stock' ? 'In stock' : 'Low stock'}</span
										>
									{/if}
									<span class="min-w-0 flex-1 truncate text-[11px] text-gray-500">
										{#if prefs.partInfo}
											<span class="font-mono">NSN {g.product?.nsn ?? g.requested?.nsn}</span>
											· {g.product?.description ?? g.requested?.desc}
											{#if g.requested}·{/if}
										{/if}
										{#if g.requested}asked {g.requested.qtys.join(' / ')}{/if}
									</span>
									{#if g.product}
										<button
											type="button"
											class="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-900"
											onclick={(e) => {
												e.stopPropagation();
												toggleExpand(g.key);
											}}
										>
											Details
											<ChevronRight class="h-3 w-3 transition-transform {expanded.has(g.key) ? 'rotate-90' : ''}" />
										</button>
									{/if}
								</div>
							</td>
						</tr>

						{#if expanded.has(g.key) && g.product}
							{@const product = g.product}
							<tr>
								<td colspan={colspan} class="border-b border-gray-200 bg-gray-50/60 px-4 py-2.5">
									<div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
										{#each PRODUCT_FIELD_DEFS as def (def.field)}
											<CompactField
												{def}
												value={product[def.field] as string | number | boolean | null}
												onChange={(value) => updateProduct(product.id, { [def.field]: value } as Partial<Product>)}
											/>
										{/each}
									</div>
									{#if product.lines.length}
										<p class="mb-1 mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Line notes</p>
										<div class="grid grid-cols-1 gap-y-1.5">
											{#each product.lines as l (l.id)}
												{#each LINE_NOTE_DEFS as def (def.field)}
													<label class="flex items-start gap-2">
														<span class="w-24 shrink-0 pt-1.5 font-mono text-[11px] text-gray-500">qty {l.quantity}</span>
														<textarea
															rows="1"
															class="h-auto min-h-7 w-full min-w-0 resize-y rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-900 [field-sizing:content] hover:border-gray-300 focus:border-blue-500 focus:outline-none"
															placeholder="No note"
															value={(l[def.field] as string) ?? ''}
															oninput={(e) => updateLine(product.id, l.id, { [def.field]: e.currentTarget.value } as Partial<Line>)}
														></textarea>
													</label>
												{/each}
											{/each}
										</div>
									{/if}
								</td>
							</tr>
						{/if}

						{#each rows as r (r.key)}
							{@const tone = TONE_CLS[STATUS_META[r.status].tone]}
							{@const done = reviewed.has(r.key)}
							{@const selected = selectedKey === r.key}
							{@const line = r.line}
							<tr
								id="row-{r.key}"
								class="group cursor-pointer border-t border-gray-200/60 transition-colors
									{colors ? tone.row : ''}
									{selected ? 'outline-2 -outline-offset-2 outline-blue-500' : 'hover:bg-gray-100/60'}
									{done && !selected && prefs.fadeConfirmed ? 'opacity-50' : ''}"
								onclick={() => select(g, r)}
								title={r.issues.map((i) => i.text).join('\n')}
							>
								<td class="px-2 py-1 {colors ? tone.bar : ''}">
									<button
										type="button"
										class="mx-auto flex h-5 w-5 items-center justify-center rounded border {done
											? 'border-emerald-500 bg-emerald-500 text-gray-50'
											: 'border-gray-400 hover:border-gray-700'}"
										aria-label={done ? 'Unconfirm row' : 'Confirm row'}
										onmousedown={(e) => {
											if (e.shiftKey) e.preventDefault();
										}}
										onclick={(e) => clickCheckbox(r, e)}
									>
										{#if done}<Check class="h-3 w-3" strokeWidth={3.5} />{/if}
									</button>
								</td>
								<td class="px-2 py-1">{@render pill(r.status)}</td>
								{#if line && g.product}
									{@const pid = g.product.id}
									{#each lineCols as def (def.field)}
										<td class="px-0.5 py-0.5 {COL_WIDTH[def.field] ?? ''}">{@render lineCell(def, line, pid, r, g)}</td>
									{/each}
									<td class="w-8 px-1 py-0.5 text-center">
										<button
											type="button"
											class="rounded p-1 text-gray-500 hover:bg-rose-500/15 hover:text-rose-400 {selected
												? 'opacity-100'
												: 'opacity-0 focus:opacity-100 group-hover:opacity-100'}"
											aria-label="Delete qty {line.quantity} line"
											title="Delete this line (it won't be submitted)"
											onclick={(e) => {
												e.stopPropagation();
												deleteLine(g, r);
											}}><Trash2 class="h-3.5 w-3.5" /></button
										>
									</td>
								{:else}
									{#each { length: Math.max(0, qtyIdx) } as _, i (i)}<td></td>{/each}
									<td class="px-0.5 py-0.5 {COL_WIDTH.quantity}">
										<span class="{cellText} text-right font-mono text-gray-900">{r.qty ?? '—'}</span>
									</td>
									<td colspan={lineCols.length - qtyIdx - 1} class="px-2 py-1 text-xs text-gray-500">
										<div class="flex items-center gap-2">
											<span class="text-gray-400">—</span>
											{#if r.status === 'missing_break' && g.product && r.qty !== null}
												{@const qty = r.qty}
												<button
													type="button"
													class="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-800 hover:bg-gray-200"
													onclick={(e) => {
														e.stopPropagation();
														addLine(g, qty);
													}}
												>
													<Plus class="h-3 w-3" /> Add line
												</button>
											{/if}
										</div>
									</td>
									<td></td>
								{/if}
							</tr>
							{#if selected && r.issues.length}
								<tr class="text-[11px] {colors ? tone.row : ''}">
									<td class={colors ? tone.bar : ''}></td>
									<td colspan={colspan - 1} class="px-2 pb-1.5 text-gray-700">
										{#each r.issues as issue, i (i)}{#if i > 0}<span class="text-gray-400"> · </span>{/if}{@render issueText(issue, g)}{/each}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				{/if}
			{/each}
		</table>
		</div>
</section>
