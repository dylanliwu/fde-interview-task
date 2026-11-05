<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Line, Product, Vendor } from '$lib/types';
	import { HEADER_FIELD_DEFS, PRODUCT_FIELD_DEFS, makeEmptyLine } from '$lib/fields';
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
	import { Check, ChevronRight, Plus, CheckCheck, Info } from '@lucide/svelte';
	import FieldInput from './FieldInput.svelte';

	let { vendor }: { vendor: Vendor } = $props();

	type Filter = 'all' | 'attention' | 'unconfirmed';
	let filter = $state<Filter>('all');
	let selectedKey = $state<string | null>(null);
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

	const TONE_CLS: Record<Tone, { row: string; bar: string; pill: string; cell: string; swatch: string }> = {
		ok: {
			row: 'bg-emerald-500/[0.06]',
			bar: 'shadow-[inset_3px_0_0_var(--color-emerald-500)]',
			pill: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
			cell: '',
			swatch: 'bg-emerald-500'
		},
		diff: {
			row: 'bg-amber-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-amber-500)]',
			pill: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
			cell: '',
			swatch: 'bg-amber-500'
		},
		extra: {
			row: 'bg-violet-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-violet-500)]',
			pill: 'border-violet-500/40 bg-violet-500/15 text-violet-400',
			cell: '',
			swatch: 'bg-violet-500'
		},
		bad: {
			row: 'bg-rose-500/[0.08]',
			bar: 'shadow-[inset_3px_0_0_var(--color-rose-500)]',
			pill: 'border-rose-500/40 bg-rose-500/15 text-rose-400',
			cell: 'bg-rose-500/15 ring-1 ring-inset ring-rose-500/60',
			swatch: 'bg-rose-500'
		}
	};
	const NEUTRAL_PILL = 'border-gray-300 bg-gray-100 text-gray-700';
	const BAD_CELL = TONE_CLS.bad.cell;

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

	// --- actions ---
	function select(g: ReviewGroup, r: ReviewRow | null) {
		selectedKey = r?.key ?? null;
		const qty = r?.qty ?? null;
		const pn = g.product?.partNumber || g.requested?.pn || '';
		focusSource(
			findInVendor(vendor, pn, qty) ?? (g.requested ? findInVendor(vendor, g.requested.pn, qty) : null)
		);
	}

	function toggleConfirm(key: string) {
		store.setReviewed(vendor.id, [key], !reviewed.has(key));
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
				if (!wasConfirmed && filter === 'all') move(1);
			} else if (e.key === 'Escape' && legendPinned) {
				legendPinned = false;
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
			expanded = new Set();
		});
	});

	const cell =
		'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right tabular-nums text-[13px] text-gray-900 hover:border-gray-300 focus:border-blue-500 focus:bg-gray-50 focus:outline-none';
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

{#snippet legendButton()}
	<div
		class="relative"
		role="presentation"
		onmouseenter={() => (legendHover = true)}
		onmouseleave={() => (legendHover = false)}
	>
		<button
			type="button"
			class="inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 {legendPinned
				? 'bg-gray-100 text-gray-900'
				: ''}"
			aria-label="What do the statuses and colours mean?"
			aria-expanded={legendOpen}
			onclick={(e) => {
				e.stopPropagation();
				legendPinned = !legendPinned;
			}}
		>
			<Info class="h-4 w-4" />
		</button>
		{#if legendOpen}
			<div
				class="absolute right-0 top-full z-30 mt-1 w-[380px] rounded-xl border border-gray-200 bg-white p-4 text-left text-xs normal-case tracking-normal shadow-2xl shadow-black/50"
			>
				<p class="mb-3 font-semibold text-gray-900">How to read this table</p>
				<p class="mb-3 text-gray-600">
					Each row is one <b class="text-gray-800">quantity</b> of one part. We compare what the AI
					extracted from the vendor's reply against what we asked for in the RFQ. Click a row to
					highlight where it came from in the email, then tick
					<span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-emerald-500 align-[-2px] text-gray-50"><Check class="h-2.5 w-2.5" strokeWidth={4} /></span>
					once you've checked it.
				</p>
				<div class="space-y-3">
					{#each STATUSES_BY_TONE as { tone, statuses } (tone)}
						<div>
							<div class="flex items-center gap-2">
								<span class="h-2.5 w-2.5 rounded-sm {TONE_CLS[tone].swatch}"></span>
								<span class="font-semibold text-gray-900">{TONES[tone].title}</span>
							</div>
							<p class="ml-[18px] mt-0.5 text-gray-500">{TONES[tone].help}</p>
							<ul class="ml-[18px] mt-1.5 space-y-1.5">
								{#each statuses as s (s)}
									<li class="flex items-start gap-2">
										<span class="mt-px shrink-0">{@render pill(s)}</span>
										<span class="text-gray-600">{STATUS_META[s].help}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
				<p class="mt-3 border-t border-gray-200 pt-2 text-[11px] text-gray-500">
					Shortcuts: <kbd class="rounded border border-gray-300 px-1 font-mono">↑</kbd>
					<kbd class="rounded border border-gray-300 px-1 font-mono">↓</kbd> move ·
					<kbd class="rounded border border-gray-300 px-1 font-mono">Enter</kbd> confirm &amp; next
				</p>
			</div>
		{/if}
	</div>
{/snippet}

<section class="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
	<!-- Toolbar -->
	<header class="border-b border-gray-200 px-4 py-3">
		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold tracking-tight text-gray-900">Confirm extracted quote</h2>
				<p class="mt-0.5 text-xs text-gray-500">
					<span class="font-medium text-gray-800">{summary.confirmed}/{summary.total}</span> rows
					confirmed ·
					<span class="font-medium {summary.attention ? 'text-amber-400' : 'text-emerald-400'}"
						>{summary.attention} need attention</span
					>
					· {summary.partsQuoted}/{summary.partsRequested} parts quoted
				</p>
			</div>

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

			{@render legendButton()}

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
		<div class="grid gap-3 border-b border-gray-200 px-4 py-3 sm:grid-cols-3">
			{#each HEADER_FIELD_DEFS.filter((d) => d.type !== 'textarea') as def (def.field)}
				<FieldInput
					{def}
					value={vendor[def.field] as string | number | null}
					onChange={(value) => store.updateVendor(vendor.id, { [def.field]: value } as Partial<Vendor>)}
				/>
			{/each}
		</div>

		<table class="w-full border-collapse text-[13px]">
			<thead class="sticky top-0 z-20 bg-white text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_var(--color-gray-200)]">
				<tr>
					<th class="w-10 px-2 py-2" title="Confirmed">✓</th>
					<th class="px-2 py-2 text-left font-semibold">
						Status
					</th>
					<th class="px-2 py-2 text-right font-semibold">Qty</th>
					<th class="px-2 py-2 text-right font-semibold">Unit cost</th>
					<th class="px-2 py-2 text-right font-semibold">Ext price</th>
					<th class="px-2 py-2 text-left font-semibold">Cur</th>
					<th class="px-2 py-2 text-right font-semibold">Lead (days)</th>
				</tr>
			</thead>
			{#each groups as g, gi (g.key)}
				{@const rows = g.rows.filter(visible)}
				{#if rows.length}
					<tbody>
						<!-- Part header: requested vs quoted PN + requested qtys -->
						<tr class="cursor-pointer border-t-8 border-gray-50 bg-gray-100/70" onclick={() => select(g, null)}>
							<td colspan="7" class="px-2 py-1.5">
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
									{#if g.requested}
										<span class="text-[11px] text-gray-500">
											asked for {g.requested.qtys.join(' · ')}
										</span>
									{/if}
									{#if g.product}
										<button
											type="button"
											class="ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 hover:text-gray-900"
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
								<td colspan="7" class="border-b border-gray-200 px-4 py-3">
									<div class="grid gap-3 sm:grid-cols-3">
										{#each PRODUCT_FIELD_DEFS as def (def.field)}
											<div class={def.type === 'textarea' ? 'sm:col-span-3' : ''}>
												<FieldInput
													{def}
													value={product[def.field] as string | number | boolean | null}
													onChange={(value) => updateProduct(product.id, { [def.field]: value } as Partial<Product>)}
												/>
											</div>
										{/each}
									</div>
								</td>
							</tr>
						{/if}

						{#each rows as r (r.key)}
							{@const meta = STATUS_META[r.status]}
							{@const tone = TONE_CLS[meta.tone]}
							{@const done = reviewed.has(r.key)}
							{@const selected = selectedKey === r.key}
							{@const line = r.line}
							{@const bad = colors ? BAD_CELL : ''}
							<tr
								id="row-{r.key}"
								class="cursor-pointer border-t border-gray-200/60 transition-colors
									{colors ? tone.row : ''}
									{selected ? 'outline-2 -outline-offset-2 outline-blue-500' : 'hover:bg-gray-100/60'}
									{done && !selected ? 'opacity-50' : ''}"
								onclick={() => select(g, r)}
								title={r.issues.join('\n')}
							>
								<td class="px-2 py-1 {colors ? tone.bar : ''}">
									<button
										type="button"
										class="mx-auto flex h-5 w-5 items-center justify-center rounded border {done
											? 'border-emerald-500 bg-emerald-500 text-gray-50'
											: 'border-gray-400 hover:border-gray-700'}"
										aria-label={done ? 'Unconfirm row' : 'Confirm row'}
										onclick={(e) => {
											e.stopPropagation();
											toggleConfirm(r.key);
										}}
									>
										{#if done}<Check class="h-3 w-3" strokeWidth={3.5} />{/if}
									</button>
								</td>
								<td class="px-2 py-1">{@render pill(r.status)}</td>
								<td class="px-2 py-1 text-right font-mono tabular-nums text-gray-900">{r.qty ?? '—'}</td>
								{#if line && g.product}
									{@const pid = g.product.id}
									{@const expected = line.unitCost !== null ? (line.unitCost * line.quantity).toFixed(2) : ''}
									<td class="w-24 px-1 py-0.5">
										<input
											class="{cell} {line.unitCost === null ? bad : ''}"
											type="number"
											step="0.01"
											value={line.unitCost ?? ''}
											onclick={(e) => e.stopPropagation()}
											onfocus={() => select(g, r)}
											oninput={(e) => updateLine(pid, line.id, { unitCost: num(e.currentTarget.value) })}
										/>
									</td>
									<td class="w-28 px-1 py-0.5">
										<input
											class="{cell} {line.price === null || r.status === 'math' ? bad : ''}"
											type="number"
											step="0.01"
											value={line.price ?? ''}
											placeholder={expected}
											title={expected ? `qty × unit cost = ${expected}` : ''}
											onclick={(e) => e.stopPropagation()}
											onfocus={() => select(g, r)}
											oninput={(e) => updateLine(pid, line.id, { price: num(e.currentTarget.value) })}
										/>
									</td>
									<td class="w-20 px-1 py-0.5">
										<select
											class="w-full rounded border border-transparent bg-transparent px-1 py-1 text-[13px] text-gray-900 hover:border-gray-300 {line.currency ? '' : bad}"
											value={line.currency}
											onclick={(e) => e.stopPropagation()}
											onfocus={() => select(g, r)}
											onchange={(e) => updateLine(pid, line.id, { currency: e.currentTarget.value as Line['currency'] })}
										>
											<option value="">—</option>
											<option>USD</option>
											<option>EUR</option>
											<option>GBP</option>
										</select>
									</td>
									<td class="w-24 px-1 py-0.5">
										<input
											class="{cell} {line.leadTime === null ? bad : ''}"
											type="number"
											step="1"
											value={line.leadTime ?? ''}
											onclick={(e) => e.stopPropagation()}
											onfocus={() => select(g, r)}
											oninput={(e) => updateLine(pid, line.id, { leadTime: num(e.currentTarget.value) })}
										/>
									</td>
								{:else}
									<td colspan="4" class="px-2 py-1 text-xs text-gray-500">
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
							{#if (selected && line && r.issues.length) || line?.additionalNotes}
								<tr class="text-[11px] {colors ? tone.row : ''} {done && !selected ? 'opacity-50' : ''}">
									<td class={colors ? tone.bar : ''}></td>
									<td colspan="6" class="px-2 pb-1.5 text-gray-500">
										{#if selected && r.issues.length}<span class="text-gray-700">{r.issues.join(' · ')}</span>{/if}
										{#if line?.additionalNotes}<span class="italic"> Vendor note: {line.additionalNotes}</span>{/if}
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
