<script lang="ts">
	import type { EmailAttachment } from '$lib/types';
	import { FileText, ChevronDown } from '@lucide/svelte';
	import { slide } from 'svelte/transition';

	import HighlightedText from './HighlightedText.svelte';
	import { sourceFocus } from '$lib/source.svelte';

	let { attachment, emailId }: { attachment: EmailAttachment; emailId: string } = $props();
	let open = $state(true);

	$effect(() => {
		void sourceFocus.nonce; // re-open on each new focus, but never fight a manual collapse
		if (sourceFocus.match?.attachmentId === attachment.id) open = true;
	});
</script>

<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
	<button
		type="button"
		class="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
		onclick={() => (open = !open)}
	>
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 ring-1 ring-inset ring-red-200/60 transition-colors group-hover:bg-red-100"
		>
			<FileText class="h-4 w-4 text-red-600" />
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-xs font-semibold text-gray-900">{attachment.filename}</p>
			<p class="text-[11px] text-gray-500">
				PDF · {attachment.pages.length} page{attachment.pages.length === 1 ? '' : 's'}
			</p>
		</div>
		<ChevronDown
			class="h-4 w-4 shrink-0 text-gray-300 transition-transform duration-200 {open
				? 'rotate-180 text-gray-500'
				: 'group-hover:text-gray-500'}"
		/>
	</button>

	{#if open}
		<div transition:slide={{ duration: 180 }} class="space-y-3 border-t border-gray-100 bg-gray-100/50 p-3">
			{#each attachment.pages as page, i (i)}
				<article
					class="overflow-hidden rounded-md border border-gray-200 bg-gray-50"
				>
					<div
						class="flex items-center justify-between border-b border-gray-200/70 bg-white/70 px-3 py-1.5"
					>
						<span
							class="font-mono text-[10px] font-medium uppercase tracking-wider text-gray-400"
						>
							Page {i + 1} of {attachment.pages.length}
						</span>
					</div>
					<HighlightedText
						text={page}
						sourceId={`${emailId}:${attachment.id}:${i}`}
						class="overflow-x-auto whitespace-pre p-4 font-mono text-[11px] leading-relaxed text-gray-900"
					/>
				</article>
			{/each}
		</div>
	{/if}
</div>
