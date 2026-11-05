<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Line, Product, Vendor } from '$lib/types';
	import { HEADER_FIELD_DEFS, PRODUCT_FIELD_DEFS, makeEmptyLine } from '$lib/fields';
	import { store } from '$lib/store.svelte';
	import { buildReview, summarize, STATUS_META, type ReviewGroup, type ReviewRow } from '$lib/review';
	import { findInVendor, focusSource } from '$lib/source.svelte';
	import { Check, ChevronRight, ClipboardCheck, Plus, CheckCheck } from '@lucide/svelte';
	import FieldInput from './FieldInput.svelte';

	let { vendor }: { vendor: Vendor } = $props();

	type Filter = 'all' | 'attention' | 'unconfirmed';
	let filter = $state<Filter>('all');
	let selectedKey = $state<string | null>(null);
	let expanded = $state(new Set<string>());

	const groups = $derived(buildReview(vendor));
	const reviewed = $derived(new Set(vendor.reviewedRows ?? []));
	const summary = $derived(summarize(groups, vendor.reviewedRows ?? []));

	function visible(row: ReviewRow) {
		if (filter === 'unconfirmed') return !reviewed.has(row.key);
		if (filter === 'attention') return STATUS_META[row.status].attention && !reviewed.has(row.key);
		return true;
	}
	const visibleRows = $derived(groups.flatMap((g) => g.rows.filter(visible).map((r) => ({ g, r }))));

	// --- part stock status: refetch only when the set of PNs actually changes ---
	type PartStatus = { partNumber: string; stockStatus: 'in_stock' | 'low_stock' };
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
	function pnFor(g: ReviewGroup) {
		return g.product?.partNumber || g.requested?.pn || '';
	}

	function select(g: ReviewGroup, r: ReviewRow | null) {
		selectedKey = r?.key ?? null;
		const pn = pnFor(g);
		focusSource(findInVendor(vendor, pn, r?.qty ?? null) ??
			(g.requested ? findInVendor(vendor, g.requested.pn, r?.qty ?? null) : null));
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
		'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right tabular-nums text-[13px] hover:border-gray-200 focus:border-blue-500 focus:bg-white focus:outline-none';
</script>

<section class="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
	<!-- Summary + filters -->
	<header class="border-b border-gray-100 px-4 py-3">
		<div class="flex items-center gap-3">
			<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
				<ClipboardCheck class="h-4 w-4 text-blue-600" />
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold tracking-tight text-gray-900">Review extracted quote</h2>
				<p class="mt-0.5 text-xs text-gray-500">
					{summary.partsQuoted}/{summary.partsRequested} requested parts quoted ·
					<span class="font-medium text-gray-700">{summary.confirmed}/{summary.total} rows confirmed</span>
					·
					<span class="font-medium {summary.attention ? 'text-amber-600' : 'text-emerald-600'}">
						{summary.attention} need attention
					</span>
				</p>
			</div>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
				onclick={confirmAllMatches}
				title="Confirm every row that exactly matches the RFQ"
			>
				<CheckCheck class="h-3.5 w-3.5 text-emerald-600" /> Confirm all matches
			</button>
		</div>
		<div class="mt-2.5 flex items-center gap-1 text-xs">
			{#each [['all', 'All rows'], ['attention', 'Needs attention'], ['unconfirmed', 'Unconfirmed']] as [f, label] (f)}
				<button
					type="button"
					class="rounded-md px-2 py-1 font-medium {filter === f
						? 'bg-gray-900 text-white'
						: 'text-gray-600 hover:bg-gray-100'}"
					onclick={() => (filter = f as Filter)}>{label}</button
				>
			{/each}
			<span class="ml-auto text-[11px] text-gray-400">
				<kbd class="rounded border px-1 font-mono">↑↓</kbd> move ·
				<kbd class="rounded border px-1 font-mono">Enter</kbd> confirm
			</span>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Quote header strip -->
		<div class="grid gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-3 sm:grid-cols-3">
			{#each HEADER_FIELD_DEFS as def (def.field)}
				<div class={def.type === 'textarea' ? 'sm:col-span-3' : ''}>
					<FieldInput
						{def}
						value={vendor[def.field] as string | number | null}
						onChange={(value) => store.updateVendor(vendor.id, { [def.field]: value } as Partial<Vendor>)}
					/>
				</div>
			{/each}
		</div>

		<table class="w-full border-collapse text-[13px]">
			<thead class="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_#f3f4f6]">
				<tr>
					<th class="w-9 px-2 py-2"></th>
					<th class="px-2 py-2 text-left font-semibold">Status</th>
					<th class="px-2 py-2 text-right font-semibold">Qty</th>
					<th class="px-2 py-2 text-right font-semibold">Unit</th>
					<th class="px-2 py-2 text-right font-semibold">Ext</th>
					<th class="px-2 py-2 text-left font-semibold">Cur</th>
					<th class="px-2 py-2 text-right font-semibold">Lead (d)</th>
				</tr>
			</thead>
			{#each groups as g, gi (g.key)}
				{@const rows = g.rows.filter(visible)}
				{#if rows.length}
					{@const status = g.product ? partStatuses[g.product.partNumber] : undefined}
					<tbody class="border-b border-gray-200">
						<!-- Part header -->
						<tr class="cursor-pointer bg-gray-50/80 hover:bg-gray-100/80" onclick={() => select(g, null)}>
							<td colspan="7" class="px-2 py-2">
								<div class="flex items-center gap-2">
									<button
										type="button"
										class="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
										aria-label="Toggle product details"
										onclick={(e) => {
											e.stopPropagation();
											toggleExpand(g.key);
										}}
									>
										<ChevronRight class="h-3.5 w-3.5 transition-transform {expanded.has(g.key) ? 'rotate-90' : ''}" />
									</button>
									<span class="w-5 font-mono text-[11px] text-gray-400">{g.requested ? gi + 1 : '+'}</span>
									{#if g.kind === 'extra'}
										<span class="font-mono font-semibold text-gray-900">{g.product?.partNumber}</span>
										<span class="rounded border border-violet-200 bg-violet-50 px-1.5 text-[10px] font-semibold uppercase text-violet-700">not requested</span>
									{:else if g.kind === 'alt'}
										<span class="font-mono text-gray-400 line-through">{g.requested?.pn}</span>
										<span class="text-gray-400">→</span>
										<span class="font-mono font-semibold text-amber-700">{g.product?.partNumber}</span>
										<span class="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-semibold uppercase text-amber-800">alternate</span>
									{:else}
										<span class="font-mono font-semibold text-gray-900">{g.requested?.pn}</span>
									{/if}
									{#if status}
										<span class="rounded px-1.5 text-[10px] font-semibold uppercase {status.stockStatus === 'in_stock' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
											{status.stockStatus === 'in_stock' ? 'In stock' : 'Low stock'}
										</span>
									{/if}
									<span class="ml-auto truncate text-[11px] text-gray-500">
										{g.product?.description ?? g.requested?.desc}
										{#if g.requested}· asked {g.requested.qtys.join('/')}{/if}
									</span>
								</div>
							</td>
						</tr>

						{#if expanded.has(g.key) && g.product}
							{@const product = g.product}
							<tr>
								<td colspan="7" class="bg-white px-4 py-3">
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
							{@const done = reviewed.has(r.key)}
							{@const line = r.line}
							<tr
								id="row-{r.key}"
								class="cursor-pointer border-t border-gray-100 {selectedKey === r.key
									? 'bg-blue-50 outline-2 -outline-offset-2 outline-blue-400'
									: done
										? 'bg-emerald-50/30'
										: 'hover:bg-gray-50'}"
								onclick={() => select(g, r)}
							>
								<td class="px-2 py-1 text-center">
									<button
										type="button"
										class="flex h-5 w-5 items-center justify-center rounded border {done
											? 'border-emerald-600 bg-emerald-600 text-white'
											: 'border-gray-300 bg-white hover:border-gray-500'}"
										aria-label={done ? 'Unconfirm row' : 'Confirm row'}
										onclick={(e) => {
											e.stopPropagation();
											toggleConfirm(r.key);
										}}
									>
										{#if done}<Check class="h-3 w-3" strokeWidth={3} />{/if}
									</button>
								</td>
								<td class="px-2 py-1">
									<span
										class="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase {meta.cls}"
										title={r.issues.join('\n')}>{meta.label}</span
									>
								</td>
								<td class="px-2 py-1 text-right font-mono tabular-nums">{r.qty ?? '—'}</td>
								{#if line && g.product}
									{@const pid = g.product.id}
									<td class="w-24 px-1 py-0.5">
										<input
											class="{cell} {line.unitCost === null ? 'border-rose-300 bg-rose-50' : ''}"
											type="number"
											step="0.01"
											value={line.unitCost ?? ''}
											onclick={(e) => e.stopPropagation()}
											oninput={(e) => updateLine(pid, line.id, { unitCost: num(e.currentTarget.value) })}
										/>
									</td>
									<td class="w-28 px-1 py-0.5">
										<input
											class="{cell} {line.price === null || r.status === 'math' ? 'border-rose-300 bg-rose-50' : ''}"
											type="number"
											step="0.01"
											value={line.price ?? ''}
											placeholder={line.unitCost !== null ? (line.unitCost * line.quantity).toFixed(2) : ''}
											title={line.unitCost !== null ? `qty × unit = ${(line.unitCost * line.quantity).toFixed(2)}` : ''}
											onclick={(e) => e.stopPropagation()}
											oninput={(e) => updateLine(pid, line.id, { price: num(e.currentTarget.value) })}
										/>
									</td>
									<td class="w-20 px-1 py-0.5">
										<select
											class="w-full rounded border bg-transparent px-1 py-1 text-[13px] {line.currency ? 'border-transparent hover:border-gray-200' : 'border-rose-300 bg-rose-50'}"
											value={line.currency}
											onclick={(e) => e.stopPropagation()}
											onchange={(e) => updateLine(pid, line.id, { currency: e.currentTarget.value as Line['currency'] })}
										>
											<option value="">—</option>
											<option>USD</option>
											<option>EUR</option>
											<option>GBP</option>
										</select>
									</td>
									<td class="w-20 px-1 py-0.5">
										<input
											class="{cell} {line.leadTime === null ? 'border-rose-300 bg-rose-50' : ''}"
											type="number"
											step="1"
											value={line.leadTime ?? ''}
											onclick={(e) => e.stopPropagation()}
											oninput={(e) => updateLine(pid, line.id, { leadTime: num(e.currentTarget.value) })}
										/>
									</td>
								{:else}
									<td colspan="4" class="px-2 py-1 text-xs text-gray-500">
										<div class="flex items-center gap-2">
											<span class="truncate">{r.issues[0]}</span>
											{#if r.status === 'missing_break' && g.product && r.qty !== null}
												{@const qty = r.qty}
												<button
													type="button"
													class="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
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
							{#if line?.additionalNotes || (r.issues.length && line)}
								<tr class="text-[11px]">
									<td></td>
									<td colspan="6" class="px-2 pb-1.5 text-gray-500">
										{#if r.issues.length}<span class="text-amber-700">{r.issues.join(' · ')}</span>{/if}
										{#if line?.additionalNotes}<span class="italic"> {line.additionalNotes}</span>{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				{/if}
			{:else}
				<tbody><tr><td colspan="7" class="py-10 text-center text-sm text-gray-500">Nothing to show.</td></tr></tbody>
			{/each}
		</table>
		{#if !visibleRows.length && groups.length}
			<p class="py-10 text-center text-sm text-emerald-600">All clear for this filter.</p>
		{/if}
	</div>
</section>
