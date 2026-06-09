<script lang="ts">
	import type { Vendor } from '$lib/types';
	import { Mail } from '@lucide/svelte';
	import EmailThread from './EmailThread.svelte';

	let { vendor }: { vendor: Vendor } = $props();
</script>

<section
	class="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
>
	<header class="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
		<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
			<Mail class="h-4 w-4 text-blue-600" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline justify-between gap-2">
				<h2 class="truncate text-sm font-semibold tracking-tight text-gray-900">
					Correspondence
				</h2>
				<span class="shrink-0 font-mono text-[11px] text-gray-400">
					{vendor.emails.length} message{vendor.emails.length === 1 ? '' : 's'}
				</span>
			</div>
			<p class="truncate text-xs text-gray-500">
				{vendor.contactName} ·
				<span class="font-mono text-gray-400">{vendor.contactEmail}</span>
			</p>
		</div>
	</header>

	<div class="flex-1 overflow-y-auto">
		<EmailThread emails={vendor.emails} />
	</div>
</section>
