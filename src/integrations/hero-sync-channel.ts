import { Hero } from '@/models/hero';

const CHANNEL_NAME = 'net.forgesteel.hero-sync.v1';
const SCHEMA_VERSION = 1;
const SOURCE = 'forgesteel';
const clientId = createMessageID();

type HeroSyncMessage =
	| HeroUpdatedMessage
	| HeroDeletedMessage;

interface HeroSyncBaseMessage {
	type: HeroSyncMessage['type'];
	schemaVersion: 1;
	messageId: string;
	timestamp: string;
	source: typeof SOURCE;
	clientId: string;
}

interface HeroUpdatedMessage extends HeroSyncBaseMessage {
	type: 'FORGESTEEL_HERO_UPDATED';
	hero: Hero;
}

interface HeroDeletedMessage extends HeroSyncBaseMessage {
	type: 'FORGESTEEL_HERO_DELETED';
	heroId: string;
}

export type HeroSyncEvent =
	| {
		kind: 'updated';
		hero: Hero;
	}
	| {
		kind: 'deleted';
		heroId: string;
	};

let channel: BroadcastChannel | null | undefined;

export class HeroSyncChannel {
	static broadcastHeroUpdated = (hero: Hero) => {
		HeroSyncChannel.post({
			...createBaseMessage('FORGESTEEL_HERO_UPDATED'),
			type: 'FORGESTEEL_HERO_UPDATED',
			hero: hero
		});
	};

	static broadcastHeroDeleted = (heroId: string) => {
		HeroSyncChannel.post({
			...createBaseMessage('FORGESTEEL_HERO_DELETED'),
			type: 'FORGESTEEL_HERO_DELETED',
			heroId: heroId
		});
	};

	static listen = (onEvent: (event: HeroSyncEvent) => void) => {
		const broadcastChannel = getChannel();
		if (!broadcastChannel) {
			return () => undefined;
		}

		const seenMessageIDs = new Set<string>();

		const handleMessage = (event: MessageEvent<unknown>) => {
			const message = parseMessage(event.data);
			if (!message) {
				return;
			}

			if (message.clientId === clientId || seenMessageIDs.has(message.messageId)) {
				return;
			}

			seenMessageIDs.add(message.messageId);

			switch (message.type) {
				case 'FORGESTEEL_HERO_UPDATED':
					onEvent({ kind: 'updated', hero: message.hero });
					break;
				case 'FORGESTEEL_HERO_DELETED':
					onEvent({ kind: 'deleted', heroId: message.heroId });
					break;
			}
		};

		broadcastChannel.addEventListener('message', handleMessage);

		return () => {
			broadcastChannel.removeEventListener('message', handleMessage);
		};
	};

	private static post = (message: HeroSyncMessage) => {
		const broadcastChannel = getChannel();
		if (!broadcastChannel) {
			return;
		}

		broadcastChannel.postMessage(message);
	};
}

function getChannel(): BroadcastChannel | null {
	if (channel !== undefined) {
		return channel;
	}

	if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
		channel = null;
		return channel;
	}

	channel = new BroadcastChannel(CHANNEL_NAME);
	return channel;
}

function createBaseMessage(type: HeroSyncMessage['type']): HeroSyncBaseMessage {
	return {
		type: type,
		schemaVersion: SCHEMA_VERSION,
		messageId: createMessageID(),
		timestamp: new Date().toISOString(),
		source: SOURCE,
		clientId: clientId
	};
}

function createMessageID(): string {
	if ('randomUUID' in crypto) {
		return crypto.randomUUID();
	}

	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseMessage(data: unknown): HeroSyncMessage | null {
	if (!isRecord(data)) {
		return null;
	}

	if (
		data.schemaVersion !== SCHEMA_VERSION ||
		data.source !== SOURCE ||
		typeof data.messageId !== 'string' ||
		typeof data.timestamp !== 'string' ||
		typeof data.clientId !== 'string'
	) {
		return null;
	}

	if (data.type === 'FORGESTEEL_HERO_UPDATED' && isRecord(data.hero)) {
		return data as unknown as HeroUpdatedMessage;
	}

	if (data.type === 'FORGESTEEL_HERO_DELETED' && typeof data.heroId === 'string') {
		return data as unknown as HeroDeletedMessage;
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
