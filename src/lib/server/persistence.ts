import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AppState } from '$lib/types';
import { buildSeedState } from '$lib/seed';

const STATE_FILE = resolve(process.cwd(), 'data/state.json');

let writeQueue: Promise<void> = Promise.resolve();

export async function loadState(): Promise<AppState> {
	try {
		const raw = await readFile(STATE_FILE, 'utf8');
		return JSON.parse(raw) as AppState;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
		const seed = buildSeedState();
		await saveState(seed);
		return seed;
	}
}

export function saveState(state: AppState): Promise<void> {
	writeQueue = writeQueue.then(async () => {
		await mkdir(dirname(STATE_FILE), { recursive: true });
		await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
	});
	return writeQueue;
}
