<script lang="ts">
	import type { FieldDef } from '$lib/fields';

	type FieldValue = string | number | boolean | null | undefined;

	/** Dense label-left field for detail panels. Same contract as FieldInput. */
	let {
		def,
		value,
		onChange
	}: {
		def: FieldDef<any>;
		value: FieldValue;
		onChange: (value: Exclude<FieldValue, undefined>) => void;
	} = $props();

	const toNum = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
	const missing = $derived(def.required && (value === null || value === undefined || value === ''));

	const input =
		'h-7 w-full min-w-0 rounded border border-gray-200 bg-gray-50 px-2 text-xs text-gray-900 hover:border-gray-300 focus:border-blue-500 focus:outline-none';
</script>

<label class="flex min-w-0 items-center gap-2 {def.type === 'textarea' ? 'col-span-full items-start' : ''}">
	<span class="w-24 shrink-0 truncate text-[11px] text-gray-500 {def.type === 'textarea' ? 'pt-1.5' : ''}" title={def.header}>
		{def.header}{#if def.required}<span class="text-rose-500">*</span>{/if}
	</span>

	{#if def.type === 'checkbox'}
		<button
			type="button"
			class="inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 px-2 text-xs {value === true
				? 'text-emerald-400'
				: value === false
					? 'text-gray-700'
					: 'text-gray-500'}"
			aria-pressed={value === true}
			onclick={() => onChange(value === true ? false : true)}
		>
			<span
				class="h-3 w-3 rounded-sm border {value === true
					? 'border-emerald-500 bg-emerald-500'
					: 'border-gray-400'}"
			></span>
			{value === true ? 'Yes' : value === false ? 'No' : 'Not set'}
		</button>
	{:else if def.type === 'textarea'}
		<textarea
			rows="1"
			class="{input} h-auto min-h-7 resize-y py-1 [field-sizing:content]"
			value={(value as string) ?? ''}
			oninput={(e) => onChange(e.currentTarget.value)}
		></textarea>
	{:else if def.type === 'integer' || def.type === 'float' || def.type === 'currency'}
		<input
			type="number"
			step={def.type === 'integer' ? '1' : '0.01'}
			class="{input} tabular-nums {missing ? 'border-rose-500/60 bg-rose-500/10' : ''}"
			value={value === null || value === undefined ? '' : String(value)}
			oninput={(e) => onChange(toNum(e.currentTarget.value))}
		/>
	{:else if def.type === 'single_select'}
		<select class={input} value={(value as string) ?? ''} onchange={(e) => onChange(e.currentTarget.value)}>
			<option value="">—</option>
			{#each def.options ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
		</select>
	{:else}
		<input
			type="text"
			class="{input} {missing ? 'border-rose-500/60 bg-rose-500/10' : ''}"
			value={(value as string) ?? ''}
			oninput={(e) => onChange(e.currentTarget.value)}
		/>
	{/if}
</label>
