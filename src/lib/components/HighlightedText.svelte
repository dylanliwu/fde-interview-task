<script lang="ts">
	import { tick } from 'svelte';
	import { sourceFocus } from '$lib/source.svelte';

	let { text, sourceId, class: cls = '' }: { text: string; sourceId: string; class?: string } =
		$props();

	let el = $state<HTMLElement | null>(null);

	const segments = $derived.by(() => {
		const m = sourceFocus.match;
		if (!m || m.sourceId !== sourceId) return [{ t: text, k: 'none' as const }];
		const [bs, be] = m.block;
		const [ls, le] = m.line ?? [be, be];
		return [
			{ t: text.slice(0, bs), k: 'none' as const },
			{ t: text.slice(bs, ls), k: 'block' as const },
			{ t: text.slice(ls, le), k: 'line' as const },
			{ t: text.slice(le, be), k: 'block' as const },
			{ t: text.slice(be), k: 'none' as const }
		].filter((s) => s.t);
	});

	$effect(() => {
		void sourceFocus.nonce;
		if (sourceFocus.match?.sourceId !== sourceId) return;
		void tick().then(() => {
			const target = el?.querySelector('[data-hl=line]') ?? el?.querySelector('[data-hl=block]');
			target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
	});
</script>

<pre bind:this={el} class={cls}>{#each segments as s, i (i)}{#if s.k === 'none'}{s.t}{:else if s.k === 'block'}<mark
				data-hl="block"
				class="rounded-sm bg-yellow-100 text-inherit">{s.t}</mark
			>{:else}<mark data-hl="line" class="rounded-sm bg-yellow-300 text-inherit ring-2 ring-yellow-400"
				>{s.t}</mark
			>{/if}{/each}</pre>
