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
		type ReviewGroup,
		type ReviewRow,
		type RowStatus,
		type Tone
	} from '$lib/review';
	import { findInVendor, focusSource } from '$lib/source.svelte';
	import { Check, ChevronRight, Plus, CheckCheck, Info, X } from '@lucide/svelte';
	import CompactField from './CompactField.svelte';

	let { vendor }: { vendor: Vendor } = $props();

	// --- schema-driven columns: every non-textarea line field is a column ---
	// isQuoting is hidden: a row only exists because the vendor quoted it, and the "Not quoted"
	// status already covers no-bids, so the checkbox was noise. The data is kept untouched.
	const HIDDEN_COLS = new Set<keyof Line>(['isQuoting']);
	const LINE_COLS = LINE_FIELD_DEFS.filter((d) => d.type !== 'textarea' && !HIDDEN_COLS.has(d.field));
	const LINE_NOTE_DEFS = LINE_FIELD_DEFS.filter((d) => d.type === 'textarea');
	const QTY_IDX = LINE_COLS.findIndex((d) => d.field === 'quantity');
	const COLSPAN = 2 + LINE_COLS.length;
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

	type Filter = 'all' | 'attention' | 'unconfirmed';
	let filter = $state<Filter>('all');
	/** Cursor row (drives source highlight) + multi-selection (shift = range, ctrl/cmd = toggle). */
	let selectedKey = $state<string | null>(null);
	let selection = $state(new Set<string>());
	let anchorKey: string | null = null;
	let expanded = $state(new Set<string>());

	// --- colour coding toggle (per-viewer preference) ---
	const COLOR_KEY = 'quoteReview.colors';
	let colors = $state(true);
	onMount(() => {
		try {
			colors = localStorage.getItem(COLOR_KEY) !== 'off';
		} catch {}
	});
	function toggleColors() {
		colors = !colors;
		try {
			localStorage.setItem(COLOR_KEY, colors ? 'on' : 'off');
		} catch {}
	}

	// --- legend popover: hover to peek, click to pin ---
	let legendHover = $state(false);
	let legendPinned = $state(false);
	const legendOpen = $derived(legendHover || legendPinned);

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

	function visible(row: ReviewRow) {
		if (filter === 'unconfirmed') return !reviewed.has(row.key);
		if (filter === 'attention') return STATUS_META[row.status].attention && !reviewed.has(row.key);
		return true;
	}
	const visibleRows = $derived(groups.flatMap((g) => g.rows.filter(visible).map((r) => ({ g, r }))));

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

	/** Row click: plain = select one, shift = range from anchor, ctrl/cmd = add/remove. */
	function clickRow(g: ReviewGroup, r: ReviewRow, e: MouseEvent) {
		if (e.shiftKey && anchorKey) {
			selection = new Set(rangeKeys(anchorKey, r.key));
		} else if (e.ctrlKey || e.metaKey) {
			const next = new Set(selection);
			if (next.has(r.key)) next.delete(r.key);
			else next.add(r.key);
			selection = next;
			anchorKey = r.key;
		} else {
			selection = new Set([r.key]);
			anchorKey = r.key;
		}
		select(g, r, false);
	}

	function select(g: ReviewGroup, r: ReviewRow | null, resetSelection = true) {
		selectedKey = r?.key ?? null;
		if (resetSelection) {
			selection = new Set(r ? [r.key] : []);
			anchorKey = r?.key ?? null;
		}
		const qty = r?.qty ?? null;
		const pn = g.product?.partNumber || g.requested?.pn || '';
		focusSource(
			findInVendor(vendor, pn, qty) ?? (g.requested ? findInVendor(vendor, g.requested.pn, qty) : null)
		);
	}

	/** Confirm/unconfirm a row, or the whole selection if the row is part of it. */
	function toggleConfirm(key: string) {
		const targets = selection.has(key) && selection.size > 1 ? [...selection] : [key];
		const allDone = targets.every((k) => reviewed.has(k));
		store.setReviewed(vendor.id, targets, !allDone);
	}

	function setSelectionConfirmed(value: boolean) {
		store.setReviewed(vendor.id, [...selection], value);
	}

	/** Checkbox: plain = toggle (selection-aware); shift = confirm the range from the anchor. */
	function clickCheckbox(r: ReviewRow, e: MouseEvent) {
		e.stopPropagation();
		if (e.shiftKey && anchorKey) {
			const keys = rangeKeys(anchorKey, r.key);
			selection = new Set(keys);
			store.setReviewed(vendor.id, keys, true);
			return;
		}
		toggleConfirm(r.key);
	}

	function confirmAllMatches() {
		const keys = groups.flatMap((g) => g.rows.filter((r) => r.status === 'ok').map((r) => r.key));
		store.setReviewed(vendor.id, keys, true);
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
	function move(delta: number, extend = false) {
		if (!visibleRows.length) return;
		const i = visibleRows.findIndex((x) => x.r.key === selectedKey);
		const n = Math.max(0, Math.min(visibleRows.length - 1, i === -1 ? 0 : i + delta));
		const { g, r } = visibleRows[n];
		if (extend && anchorKey) {
			selection = new Set(rangeKeys(anchorKey, r.key));
			select(g, r, false);
		} else {
			select(g, r);
		}
		document.getElementById(`row-${r.key}`)?.scrollIntoView({ block: 'nearest' });
	}

	onMount(() => {
		function onKey(e: KeyboardEvent) {
			const t = e.target as HTMLElement | null;
			if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
			if (e.key === 'ArrowDown' || e.key === 'j') {
				e.preventDefault();
				move(1, e.shiftKey);
			} else if (e.key === 'ArrowUp' || e.key === 'k') {
				e.preventDefault();
				move(-1, e.shiftKey);
			} else if ((e.key === 'Enter' || e.key === ' ') && selectedKey) {
				e.preventDefault();
				const key = selectedKey;
				const multi = selection.size > 1;
				const wasConfirmed = reviewed.has(key);
				toggleConfirm(key);
				if (!multi && !wasConfirmed && filter === 'all') move(1);
			} else if (e.key === 'Escape' && (legendPinned || selection.size > 1)) {
				// Registered before the page's handler, so this keeps Esc from leaving the page.
				e.stopImmediatePropagation();
				legendPinned = false;
				selection = new Set(selectedKey ? [selectedKey] : []);
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
			selection = new Set();
			anchorKey = null;
			expanded = new Set();
		});
	});

	const cellInput =
		'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-gray-900 tabular-nums hover:border-gray-300 focus:border-blue-500 focus:bg-gray-50 focus:outline-none';
</script>

{#snippet pill(status: RowStatus)}
	{@const meta = STATUS_META[status]}
	<span
		class="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide {colors
			? TONE_CLS[meta.tone].pill
			: NEUTRAL_PILL}"
		title={meta.help}>{meta.label}</span
	>
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
	<header class="border-b border-gray-200 px-4 py-3">
		<div class="flex items-center gap-3">
			<p class="min-w-0 flex-1 truncate text-xs text-gray-500">
				{#if selection.size > 1}
					<span class="font-medium text-blue-400">{selection.size} selected</span>
					<button type="button" class="ml-2 rounded border border-gray-300 px-1.5 py-0.5 text-gray-800 hover:bg-gray-100" onclick={() => setSelectionConfirmed(true)}>Confirm</button>
					<button type="button" class="rounded border border-gray-300 px-1.5 py-0.5 text-gray-800 hover:bg-gray-100" onclick={() => setSelectionConfirmed(false)}>Unconfirm</button>
					<button type="button" class="px-1 text-gray-500 hover:text-gray-900" onclick={() => (selection = new Set(selectedKey ? [selectedKey] : []))}>Clear</button>
				{:else}
					<span class="font-medium {summary.attention ? 'text-amber-400' : 'text-emerald-400'}"
						>{summary.attention} need attention</span
					>
					· {summary.partsQuoted}/{summary.partsRequested} parts quoted
					{#if summary.confirmed > 0}
						· <span class="font-medium text-gray-800">{summary.confirmed}/{summary.total}</span> confirmed
					{/if}
				{/if}
			</p>

			<button
				type="button"
				class="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
				aria-pressed={colors}
				onclick={toggleColors}
				title="Turn colour coding on or off"
			>
				<span
					class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {colors
						? 'bg-blue-600'
						: 'bg-gray-300'}"
				>
					<span
						class="absolute h-3 w-3 rounded-full bg-gray-900 transition-transform {colors
							? 'translate-x-3.5'
							: 'translate-x-0.5'}"
					></span>
				</span>
				Colours
			</button>

			<!-- Legend -->
			<div
				class="relative"
				role="presentation"
				onmouseenter={() => (legendHover = true)}
				onmouseleave={() => (legendHover = false)}
			>
				<button
					type="button"
					class="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 {legendPinned
						? 'bg-gray-100 text-gray-900'
						: ''}"
					aria-label="What do the statuses and colours mean?"
					aria-expanded={legendOpen}
					onclick={() => (legendPinned = !legendPinned)}
				>
					<Info class="h-4 w-4" />
				</button>
				{#if legendOpen}
					<div
						class="absolute right-0 top-full z-30 mt-1 max-h-[75vh] w-[460px] overflow-y-auto rounded-xl border border-gray-200 bg-white text-xs shadow-2xl shadow-black/60"
					>
						<div class="border-b border-gray-200 px-4 py-3">
							<div class="flex items-center justify-between">
								<p class="text-sm font-semibold text-gray-900">How to use this table</p>
								{#if legendPinned}
									<button
										type="button"
										class="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
										aria-label="Close guide"
										onclick={() => (legendPinned = false)}><X class="h-3.5 w-3.5" /></button
									>
								{/if}
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
							<p class="pt-1 text-[11px] text-gray-500">
								<kbd class="rounded border border-gray-300 px-1 font-mono">↑</kbd>
								<kbd class="rounded border border-gray-300 px-1 font-mono">↓</kbd> move ·
								<kbd class="rounded border border-gray-300 px-1 font-mono">Enter</kbd> confirm &amp; next ·
								<kbd class="rounded border border-gray-300 px-1 font-mono">Shift</kbd>+click select a range ·
								<kbd class="rounded border border-gray-300 px-1 font-mono">Ctrl</kbd>+click add to selection ·
								hover a status for details
							</p>
						</div>
					</div>
				{/if}
			</div>

			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100"
				onclick={confirmAllMatches}
				title="Tick every row that exactly matches the RFQ"
			>
				<CheckCheck class="h-3.5 w-3.5 text-emerald-500" /> Confirm all matches
			</button>
		</div>

		<div class="mt-2.5 flex items-center gap-1 text-xs">
			{#each [['all', 'All'], ['attention', 'Needs attention'], ['unconfirmed', 'Unconfirmed']] as [f, label] (f)}
				<button
					type="button"
					class="rounded-md px-2 py-1 font-medium {filter === f
						? 'bg-gray-200 text-gray-900'
						: 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}"
					onclick={() => (filter = f as Filter)}>{label}</button
				>
			{/each}
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Quote header -->
		<div class="border-b border-gray-200 px-4 py-2.5">
			<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Quote header</p>
			<div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
				{#each HEADER_FIELD_DEFS as def (def.field)}
					<CompactField
						{def}
						value={vendor[def.field] as string | number | null}
						onChange={(value) => store.updateVendor(vendor.id, { [def.field]: value } as Partial<Vendor>)}
					/>
				{/each}
			</div>
		</div>

		<table class="w-full border-collapse text-[13px]">
			<thead class="sticky top-0 z-20 bg-white text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_var(--color-gray-200)]">
				<tr>
					<th class="w-9 px-2 py-2" title="Confirmed">✓</th>
					<th class="px-2 py-2 text-left font-semibold">Status</th>
					{#each LINE_COLS as def (def.field)}
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
				</tr>
			</thead>
			{#each groups as g, gi (g.key)}
				{@const rows = g.rows.filter(visible)}
				{#if rows.length}
					{@const stock = g.product ? partStatuses[g.product.partNumber] : undefined}
					<tbody>
						<!-- Part header: requested vs quoted PN, NSN, description, requested qtys -->
						<tr class="cursor-pointer border-t-8 border-gray-50 bg-gray-100/70" onclick={() => select(g, null)}>
							<td colspan={COLSPAN} class="px-2 py-1.5">
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
										<span class="font-mono">NSN {g.product?.nsn ?? g.requested?.nsn}</span>
										· {g.product?.description ?? g.requested?.desc}
										{#if g.requested}· asked {g.requested.qtys.join(' / ')}{/if}
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
								<td colspan={COLSPAN} class="border-b border-gray-200 bg-gray-50/60 px-4 py-2.5">
									<div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
										{#each PRODUCT_FIELD_DEFS as def (def.field)}
											<CompactField
												{def}
												value={product[def.field] as string | number | boolean | null}
												onChange={(value) => updateProduct(product.id, { [def.field]: value } as Partial<Product>)}
											/>
										{/each}
									</div>
								</td>
							</tr>
						{/if}

						{#each rows as r (r.key)}
							{@const tone = TONE_CLS[STATUS_META[r.status].tone]}
							{@const done = reviewed.has(r.key)}
							{@const selected = selectedKey === r.key}
							{@const inSel = selection.has(r.key)}
							{@const line = r.line}
							<tr
								id="row-{r.key}"
								class="cursor-pointer select-none border-t border-gray-200/60 transition-colors
									{inSel ? 'bg-blue-500/15' : colors ? tone.row : ''}
									{selected ? 'outline-2 -outline-offset-2 outline-blue-500' : inSel ? '' : 'hover:bg-gray-100/60'}
									{done && !inSel ? 'opacity-50' : ''}"
								onmousedown={(e) => {
									if (e.shiftKey) e.preventDefault();
								}}
								onclick={(e) => clickRow(g, r, e)}
								title={r.issues.join('\n')}
							>
								<td class="px-2 py-1 {colors ? tone.bar : ''}">
									<button
										type="button"
										class="mx-auto flex h-5 w-5 items-center justify-center rounded border {done
											? 'border-emerald-500 bg-emerald-500 text-gray-50'
											: 'border-gray-400 hover:border-gray-700'}"
										aria-label={done ? 'Unconfirm row' : 'Confirm row'}
										onclick={(e) => clickCheckbox(r, e)}
									>
										{#if done}<Check class="h-3 w-3" strokeWidth={3.5} />{/if}
									</button>
								</td>
								<td class="px-2 py-1">{@render pill(r.status)}</td>
								{#if line && g.product}
									{@const pid = g.product.id}
									{#each LINE_COLS as def (def.field)}
										<td class="px-0.5 py-0.5 {COL_WIDTH[def.field] ?? ''}">{@render lineCell(def, line, pid, r, g)}</td>
									{/each}
								{:else}
									{#each { length: Math.max(0, QTY_IDX) } as _, i (i)}<td></td>{/each}
									<td class="px-2 py-1 text-right font-mono tabular-nums text-gray-900">{r.qty ?? '—'}</td>
									<td colspan={LINE_COLS.length - QTY_IDX - 1} class="px-2 py-1 text-xs text-gray-500">
										<div class="flex items-center gap-2">
											<span class="truncate italic">{r.issues[0]}</span>
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
								{/if}
							</tr>
							{#if line && g.product && (selected || LINE_NOTE_DEFS.some((d) => !blank(line[d.field])))}
								{@const pid = g.product.id}
								<tr class="text-[11px] {colors ? tone.row : ''} {done && !inSel ? 'opacity-50' : ''}">
									<td class={colors ? tone.bar : ''}></td>
									<td colspan={COLSPAN - 1} class="px-2 pb-1.5">
										{#if selected && r.issues.length}
											<p class="mb-1 text-gray-700">{r.issues.join(' · ')}</p>
										{/if}
										{#each LINE_NOTE_DEFS as def (def.field)}
											<label class="flex items-start gap-2">
												<span class="shrink-0 pt-0.5 text-gray-500">{def.header}</span>
												<textarea
													rows="1"
													class="min-h-5 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 italic text-gray-700 [field-sizing:content] hover:border-gray-300 focus:border-blue-500 focus:bg-gray-50 focus:not-italic focus:outline-none"
													placeholder="Add a note…"
													value={(line[def.field] as string) ?? ''}
													onclick={(e) => e.stopPropagation()}
													oninput={(e) => updateLine(pid, line.id, { [def.field]: e.currentTarget.value } as Partial<Line>)}
												></textarea>
											</label>
										{/each}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				{/if}
			{/each}
		</table>
		{#if !visibleRows.length}
			<p class="py-10 text-center text-sm text-gray-500">Nothing left under this filter.</p>
		{/if}
	</div>
</section>
