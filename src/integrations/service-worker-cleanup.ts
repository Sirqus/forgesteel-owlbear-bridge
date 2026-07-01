const CLEANUP_RELOAD_KEY = 'forgesteel.serviceWorkerCleanupReloaded.v1';
const APP_BASE = import.meta.env.BASE_URL;

const STALE_SERVICE_WORKER_PATHS = [
	'/',
	'/forgesteel-owlbear/',
	'/forgesteel-owlbear-extension/'
];

export function isOwlbearBridgeMode(): boolean {
	const params = new URLSearchParams(window.location.search);
	const enabled = params.get('owlbearBridge');
	return enabled === '1' || enabled === 'true';
}

export async function cleanupStaleServiceWorkers({
	includeCurrentScope = false
}: {
	includeCurrentScope?: boolean;
} = {}): Promise<boolean> {
	if (!('serviceWorker' in navigator)) {
		return false;
	}

	try {
		const staleScopes = new Set(
			STALE_SERVICE_WORKER_PATHS.map(path => new URL(path, window.location.origin).href)
		);

		if (includeCurrentScope) {
			staleScopes.add(new URL(APP_BASE, window.location.origin).href);
		}

		const registrations = await navigator.serviceWorker.getRegistrations();
		const staleRegistrations = registrations.filter(registration =>
			staleScopes.has(registration.scope)
		);

		if (staleRegistrations.length === 0) {
			return false;
		}

		await Promise.all(
			staleRegistrations.map(registration => registration.unregister())
		);
		await deleteForgeSteelCaches();

		return true;
	} catch (error) {
		console.warn('Unable to clean up stale ForgeSteel service workers.', error);
		return false;
	}
}

export function reloadAfterServiceWorkerCleanup(): boolean {
	if (sessionStorage.getItem(CLEANUP_RELOAD_KEY) === '1') {
		return false;
	}

	sessionStorage.setItem(CLEANUP_RELOAD_KEY, '1');
	window.location.reload();
	return true;
}

async function deleteForgeSteelCaches() {
	if (!('caches' in window)) {
		return;
	}

	const cacheNames = await caches.keys();
	await Promise.all(
		cacheNames
			.filter(cacheName => cacheName.startsWith('forgesteel-'))
			.map(cacheName => caches.delete(cacheName))
	);
}
