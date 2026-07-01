import { DataService } from '@/services/data-service';
import { Hero } from '@/models/hero';
import localforage from 'localforage';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'forgesteel-heroes-v1.json';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const LOCAL_METADATA_KEY = 'forgesteel-google-drive-hero-sync-metadata-v1';
const SYNC_DEBOUNCE_MS = 1500;
const SYNC_POLL_MS = 30000;
const clientId = createID();

export type GoogleDriveSyncStatusKind =
	| 'unconfigured'
	| 'signed-out'
	| 'signing-in'
	| 'syncing'
	| 'synced'
	| 'offline'
	| 'error';

export interface GoogleDriveSyncStatus {
	kind: GoogleDriveSyncStatusKind;
	message: string;
	lastSyncedAt: string | null;
	pendingChanges: boolean;
}

type StatusListener = (status: GoogleDriveSyncStatus) => void;

interface GoogleDriveTokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
}

interface GoogleTokenClient {
	requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleOAuth2 {
	initTokenClient: (config: {
		client_id: string;
		scope: string;
		callback: (response: GoogleDriveTokenResponse) => void;
	}) => GoogleTokenClient;
	revoke?: (token: string, callback: () => void) => void;
}

declare global {
	interface Window {
		google?: {
			accounts?: {
				oauth2?: GoogleOAuth2;
			};
		};
	}
}

interface DriveFile {
	id: string;
	modifiedTime?: string;
}

interface DriveHeroRecord {
	hero?: Hero;
	updatedAt: string;
	deletedAt?: string;
}

interface DriveHeroesDocument {
	schemaVersion: 1;
	updatedAt: string;
	clientId: string;
	heroes: Record<string, DriveHeroRecord>;
}

interface LocalSyncMetadata {
	schemaVersion: 1;
	clientId: string;
	driveFileId?: string;
	heroUpdatedAt: Record<string, string>;
	heroDeletedAt: Record<string, string>;
	lastSyncedAt?: string;
}

interface SyncCallbacks {
	dataService: DataService;
	onHeroUpdated: (hero: Hero) => void;
	onHeroDeleted: (heroId: string) => void;
}

const initialStatus: GoogleDriveSyncStatus = {
	kind: CLIENT_ID ? 'signed-out' : 'unconfigured',
	message: CLIENT_ID ? 'Google Drive sync is signed out.' : 'Google Drive sync is not configured.',
	lastSyncedAt: null,
	pendingChanges: false
};

class GoogleDriveHeroSyncCoordinator {
	private readonly listeners = new Set<StatusListener>();
	private status: GoogleDriveSyncStatus = initialStatus;
	private callbacks: SyncCallbacks | null = null;
	private accessToken = '';
	private identityScriptPromise: Promise<void> | null = null;
	private debounceTimer: number | undefined;
	private pollTimer: number | undefined;
	private syncInFlight: Promise<void> | null = null;

	configure(callbacks: SyncCallbacks) {
		this.callbacks = callbacks;
	};

	getStatus(): GoogleDriveSyncStatus {
		return this.status;
	}

	subscribe(listener: StatusListener): () => void {
		this.listeners.add(listener);
		listener(this.status);

		return () => {
			this.listeners.delete(listener);
		};
	}

	async signIn(): Promise<void> {
		if (!CLIENT_ID) {
			this.setStatus({
				kind: 'unconfigured',
				message: 'Google Drive sync needs a Google OAuth client ID.',
				pendingChanges: false
			});
			return;
		}

		this.setStatus({
			kind: 'signing-in',
			message: 'Opening Google sign-in.',
			pendingChanges: this.status.pendingChanges
		});

		try {
			this.accessToken = await this.requestAccessToken('consent');
			this.startListeners();
			await this.syncNow();
		} catch (error) {
			this.setStatus({
				kind: 'error',
				message: `Google sign-in failed: ${getErrorMessage(error)}`,
				pendingChanges: this.status.pendingChanges
			});
		}
	}

	signOut() {
		this.stopListeners();
		if (this.accessToken && window.google?.accounts?.oauth2?.revoke) {
			window.google.accounts.oauth2.revoke(this.accessToken, () => undefined);
		}
		this.accessToken = '';
		this.setStatus({
			kind: CLIENT_ID ? 'signed-out' : 'unconfigured',
			message: CLIENT_ID ? 'Google Drive sync is signed out.' : 'Google Drive sync is not configured.',
			pendingChanges: false
		});
	}

	async syncNow(): Promise<void> {
		if (!CLIENT_ID) {
			return;
		}
		if (!navigator.onLine) {
			this.setStatus({
				kind: 'offline',
				message: 'Google Drive sync is waiting for a network connection.',
				pendingChanges: this.status.pendingChanges
			});
			return;
		}
		if (!this.callbacks) {
			this.setStatus({
				kind: 'error',
				message: 'Google Drive sync is not ready yet.',
				pendingChanges: this.status.pendingChanges
			});
			return;
		}
		if (!this.accessToken) {
			this.setStatus({
				kind: 'signed-out',
				message: 'Sign in with Google to sync heroes.',
				pendingChanges: this.status.pendingChanges
			});
			return;
		}
		if (this.syncInFlight) {
			return this.syncInFlight;
		}

		this.syncInFlight = this.runSync()
			.finally(() => {
				this.syncInFlight = null;
			});

		return this.syncInFlight;
	}

	async recordLocalHeroSaved(hero: Hero): Promise<void> {
		const metadata = await this.getMetadata();
		metadata.heroUpdatedAt[hero.id] = new Date().toISOString();
		delete metadata.heroDeletedAt[hero.id];
		await this.saveMetadata(metadata);
		this.queueUpload();
	}

	async recordLocalHeroDeleted(heroId: string): Promise<void> {
		const metadata = await this.getMetadata();
		metadata.heroDeletedAt[heroId] = new Date().toISOString();
		delete metadata.heroUpdatedAt[heroId];
		await this.saveMetadata(metadata);
		this.queueUpload();
	}

	private async runSync(): Promise<void> {
		const callbacks = this.callbacks!;
		this.setStatus({
			kind: 'syncing',
			message: 'Syncing heroes with Google Drive.',
			pendingChanges: this.status.pendingChanges
		});

		try {
			let metadata = await this.ensureMetadataForLocalHeroes();
			const localDocument = await this.createLocalDocument(metadata);
			const driveFile = await this.findDriveFile(metadata.driveFileId);
			const remoteDocument = driveFile ? await this.downloadDocument(driveFile.id) : null;
			const mergedDocument = mergeDocuments(localDocument, remoteDocument);

			await this.applyDocument(callbacks, mergedDocument);
			metadata = metadataFromDocument(metadata, mergedDocument);
			const savedFile = await this.uploadDocument(mergedDocument, driveFile?.id || metadata.driveFileId);
			metadata.driveFileId = savedFile.id;
			metadata.lastSyncedAt = new Date().toISOString();
			await this.saveMetadata(metadata);

			this.setStatus({
				kind: 'synced',
				message: 'Heroes synced with Google Drive.',
				lastSyncedAt: metadata.lastSyncedAt,
				pendingChanges: false
			});
		} catch (error) {
			this.setStatus({
				kind: 'error',
				message: `Google Drive sync failed: ${getErrorMessage(error)}`,
				pendingChanges: this.status.pendingChanges
			});
		}
	}

	private async applyDocument(callbacks: SyncCallbacks, document: DriveHeroesDocument) {
		const localHeroes = await callbacks.dataService.getHeroes();
		const localHeroIDs = new Set(localHeroes.map(hero => hero.id));

		for (const [ heroId, record ] of Object.entries(document.heroes)) {
			if (record.deletedAt || !record.hero) {
				if (localHeroIDs.has(heroId)) {
					await callbacks.dataService.deleteHero(heroId);
					callbacks.onHeroDeleted(heroId);
				}
				continue;
			}

			const currentHero = localHeroes.find(hero => hero.id === heroId);
			if (JSON.stringify(currentHero) !== JSON.stringify(record.hero)) {
				await callbacks.dataService.saveHero(record.hero);
				callbacks.onHeroUpdated(record.hero);
			}
		}
	}

	private async createLocalDocument(metadata: LocalSyncMetadata): Promise<DriveHeroesDocument> {
		const heroes = await this.callbacks!.dataService.getHeroes();
		const records: Record<string, DriveHeroRecord> = {};
		const now = new Date().toISOString();

		for (const hero of heroes) {
			const updatedAt = metadata.heroUpdatedAt[hero.id] || now;
			records[hero.id] = {
				hero,
				updatedAt
			};
		}

		for (const [ heroId, deletedAt ] of Object.entries(metadata.heroDeletedAt)) {
			if (!records[heroId]) {
				records[heroId] = {
					updatedAt: deletedAt,
					deletedAt
				};
			}
		}

		return {
			schemaVersion: 1,
			updatedAt: now,
			clientId,
			heroes: records
		};
	}

	private async ensureMetadataForLocalHeroes(): Promise<LocalSyncMetadata> {
		const metadata = await this.getMetadata();
		const heroes = await this.callbacks!.dataService.getHeroes();
		const now = new Date().toISOString();
		let changed = false;

		for (const hero of heroes) {
			if (!metadata.heroUpdatedAt[hero.id] && !metadata.heroDeletedAt[hero.id]) {
				metadata.heroUpdatedAt[hero.id] = now;
				changed = true;
			}
		}

		if (changed) {
			await this.saveMetadata(metadata);
		}

		return metadata;
	}

	private queueUpload() {
		this.setStatus({
			kind: this.status.kind === 'unconfigured' ? 'unconfigured' : this.accessToken ? this.status.kind : 'signed-out',
			message: this.accessToken ? 'Google Drive sync has pending changes.' : this.status.message,
			pendingChanges: !!this.accessToken
		});

		if (!this.accessToken) {
			return;
		}

		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = window.setTimeout(() => {
			void this.syncNow();
		}, SYNC_DEBOUNCE_MS);
	}

	private startListeners() {
		if (!this.pollTimer) {
			this.pollTimer = window.setInterval(() => {
				void this.syncNow();
			}, SYNC_POLL_MS);
		}

		window.addEventListener('focus', this.syncOnActivity);
		window.addEventListener('online', this.syncOnActivity);
	}

	private stopListeners() {
		if (this.pollTimer) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}

		window.removeEventListener('focus', this.syncOnActivity);
		window.removeEventListener('online', this.syncOnActivity);
	}

	private readonly syncOnActivity = () => {
		void this.syncNow();
	};

	private async findDriveFile(existingFileId?: string): Promise<DriveFile | null> {
		if (existingFileId) {
			const response = await this.driveFetch(`${DRIVE_FILES_API}/${existingFileId}?fields=id,modifiedTime`);
			if (response.ok) {
				return response.json() as Promise<DriveFile>;
			}
			if (response.status !== 404) {
				throw new Error(await response.text());
			}
		}

		const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
		const url = `${DRIVE_FILES_API}?spaces=appDataFolder&pageSize=1&fields=files(id,name,modifiedTime)&q=${query}`;
		const response = await this.driveFetch(url);
		if (!response.ok) {
			throw new Error(await response.text());
		}

		const result = await response.json() as { files?: DriveFile[] };
		return result.files?.[0] || null;
	}

	private async downloadDocument(fileId: string): Promise<DriveHeroesDocument | null> {
		const response = await this.driveFetch(`${DRIVE_FILES_API}/${fileId}?alt=media`);
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(await response.text());
		}

		return parseDriveDocument(await response.json());
	}

	private async uploadDocument(document: DriveHeroesDocument, fileId?: string): Promise<DriveFile> {
		const body = JSON.stringify({
			...document,
			updatedAt: new Date().toISOString(),
			clientId
		});

		if (fileId) {
			const response = await this.driveFetch(
				`${DRIVE_UPLOAD_API}/${fileId}?uploadType=media&fields=id,modifiedTime`,
				{
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json'
					},
					body
				}
			);

			if (!response.ok) {
				throw new Error(await response.text());
			}

			return response.json() as Promise<DriveFile>;
		}

		const boundary = `forgesteel-${createID()}`;
		const metadata = {
			name: DRIVE_FILE_NAME,
			parents: [ 'appDataFolder' ],
			mimeType: 'application/json'
		};
		const multipartBody = [
			`--${boundary}`,
			'Content-Type: application/json; charset=UTF-8',
			'',
			JSON.stringify(metadata),
			`--${boundary}`,
			'Content-Type: application/json; charset=UTF-8',
			'',
			body,
			`--${boundary}--`
		].join('\r\n');

		const response = await this.driveFetch(
			`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,modifiedTime`,
			{
				method: 'POST',
				headers: {
					'Content-Type': `multipart/related; boundary=${boundary}`
				},
				body: multipartBody
			}
		);

		if (!response.ok) {
			throw new Error(await response.text());
		}

		return response.json() as Promise<DriveFile>;
	}

	private async driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
		let response = await fetch(url, {
			...init,
			headers: {
				...(init.headers || {}),
				Authorization: `Bearer ${this.accessToken}`
			}
		});

		if (response.status === 401) {
			this.accessToken = await this.requestAccessToken('');
			response = await fetch(url, {
				...init,
				headers: {
					...(init.headers || {}),
					Authorization: `Bearer ${this.accessToken}`
				}
			});
		}

		return response;
	}

	private async requestAccessToken(prompt: 'consent' | ''): Promise<string> {
		await this.loadGoogleIdentityScript();

		return new Promise((resolve, reject) => {
			const oauth2 = window.google?.accounts?.oauth2;
			if (!oauth2) {
				reject(new Error('Google Identity Services did not load.'));
				return;
			}

			const client = oauth2.initTokenClient({
				client_id: CLIENT_ID,
				scope: DRIVE_SCOPE,
				callback: response => {
					if (response.error || !response.access_token) {
						reject(new Error(response.error_description || response.error || 'No access token returned.'));
						return;
					}

					resolve(response.access_token);
				}
			});

			client.requestAccessToken({ prompt });
		});
	}

	private async loadGoogleIdentityScript(): Promise<void> {
		if (window.google?.accounts?.oauth2) {
			return;
		}

		if (this.identityScriptPromise) {
			return this.identityScriptPromise;
		}

		this.identityScriptPromise = new Promise((resolve, reject) => {
			const existingScript = document.querySelector<HTMLScriptElement>(
				`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`
			);

			if (existingScript) {
				existingScript.addEventListener('load', () => resolve(), { once: true });
				existingScript.addEventListener('error', () => reject(new Error('Google Identity script failed to load.')), { once: true });
				return;
			}

			const script = document.createElement('script');
			script.src = GOOGLE_IDENTITY_SCRIPT_URL;
			script.async = true;
			script.defer = true;
			script.addEventListener('load', () => resolve(), { once: true });
			script.addEventListener('error', () => reject(new Error('Google Identity script failed to load.')), { once: true });
			document.head.appendChild(script);
		});

		return this.identityScriptPromise;
	}

	private async getMetadata(): Promise<LocalSyncMetadata> {
		const stored = await localforage.getItem<LocalSyncMetadata>(LOCAL_METADATA_KEY);

		if (
			stored &&
			stored.schemaVersion === 1 &&
			stored.heroUpdatedAt &&
			stored.heroDeletedAt
		) {
			return stored;
		}

		return {
			schemaVersion: 1,
			clientId,
			heroUpdatedAt: {},
			heroDeletedAt: {}
		};
	}

	private async saveMetadata(metadata: LocalSyncMetadata): Promise<LocalSyncMetadata> {
		return localforage.setItem<LocalSyncMetadata>(LOCAL_METADATA_KEY, metadata);
	}

	private setStatus(patch: Partial<GoogleDriveSyncStatus>) {
		this.status = {
			...this.status,
			...patch
		};
		for (const listener of this.listeners) {
			listener(this.status);
		}
	}
}

export const GoogleDriveHeroSync = new GoogleDriveHeroSyncCoordinator();

function mergeDocuments(
	localDocument: DriveHeroesDocument,
	remoteDocument: DriveHeroesDocument | null
): DriveHeroesDocument {
	const ids = new Set([
		...Object.keys(localDocument.heroes),
		...Object.keys(remoteDocument?.heroes || {})
	]);
	const heroes: Record<string, DriveHeroRecord> = {};

	for (const id of ids) {
		const localRecord = localDocument.heroes[id];
		const remoteRecord = remoteDocument?.heroes[id];
		const winner = pickLatestRecord(localRecord, remoteRecord);
		if (winner) {
			heroes[id] = winner;
		}
	}

	return {
		schemaVersion: 1,
		updatedAt: new Date().toISOString(),
		clientId,
		heroes
	};
}

function pickLatestRecord(
	a: DriveHeroRecord | undefined,
	b: DriveHeroRecord | undefined
): DriveHeroRecord | null {
	if (!a && !b) {
		return null;
	}
	if (!a) {
		return b!;
	}
	if (!b) {
		return a;
	}

	return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
}

function metadataFromDocument(
	metadata: LocalSyncMetadata,
	document: DriveHeroesDocument
): LocalSyncMetadata {
	const heroUpdatedAt: Record<string, string> = {};
	const heroDeletedAt: Record<string, string> = {};

	for (const [ heroId, record ] of Object.entries(document.heroes)) {
		if (record.deletedAt) {
			heroDeletedAt[heroId] = record.deletedAt;
		} else {
			heroUpdatedAt[heroId] = record.updatedAt;
		}
	}

	return {
		...metadata,
		clientId,
		heroUpdatedAt,
		heroDeletedAt
	};
}

function parseDriveDocument(data: unknown): DriveHeroesDocument | null {
	if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.heroes)) {
		return null;
	}

	const heroes: Record<string, DriveHeroRecord> = {};

	for (const [ heroId, value ] of Object.entries(data.heroes)) {
		if (!isRecord(value) || typeof value.updatedAt !== 'string') {
			continue;
		}

		heroes[heroId] = {
			hero: isRecord(value.hero) ? value.hero as unknown as Hero : undefined,
			updatedAt: value.updatedAt,
			deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : undefined
		};
	}

	return {
		schemaVersion: 1,
		updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
		clientId: typeof data.clientId === 'string' ? data.clientId : 'unknown',
		heroes
	};
}

function createID(): string {
	if ('randomUUID' in crypto) {
		return crypto.randomUUID();
	}

	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
