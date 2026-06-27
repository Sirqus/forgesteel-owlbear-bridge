const SCHEMA_VERSION = 1;

type ForgeSteelBridgeMessageType =
	| 'FORGESTEEL_READY'
	| 'FORGESTEEL_ROLL_RESULT';

type OwlbearBridgeMessageType =
	| 'OWLBEAR_APPLY_DEFAULT_OPTIONS';

interface ForgeSteelBaseMessage {
	type: ForgeSteelBridgeMessageType;
	schemaVersion: 1;
	messageId: string;
	timestamp: string;
	source: 'forgesteel';
}

interface OwlbearBaseMessage {
	type: OwlbearBridgeMessageType;
	schemaVersion: 1;
	messageId: string;
	timestamp: string;
	source: 'forgesteel-owlbear';
}

interface ForgeSteelRollPayload {
	actorName: string;
	label: string;
	formula: string;
	total: number;
	breakdown?: string;
	context?: ForgeSteelRollContext;
}

export interface ForgeSteelRollContext {
	kind?: 'ability' | 'characteristic' | 'savingThrow' | 'manual';
	details?: {
		name?: string;
		description?: string;
		type?: string;
		cost?: string;
		distance?: string;
		target?: string;
		trigger?: string;
		keywords?: string[];
		sections?: {
			label: string;
			text: string;
		}[];
		tiers?: {
			tier: 1 | 2 | 3;
			text: string;
		}[];
	};
}

export interface OwlbearDefaultOptionsPayload {
	shownStandardAbilities?: 'all' | string[];
	compactView?: boolean;
	abilityWidth?: string;
}

interface ForgeSteelReadyMessage extends ForgeSteelBaseMessage {
	type: 'FORGESTEEL_READY';
}

interface ForgeSteelRollResultMessage extends ForgeSteelBaseMessage {
	type: 'FORGESTEEL_ROLL_RESULT';
	payload: ForgeSteelRollPayload;
}

interface OwlbearApplyDefaultOptionsMessage extends OwlbearBaseMessage {
	type: 'OWLBEAR_APPLY_DEFAULT_OPTIONS';
	payload: OwlbearDefaultOptionsPayload;
}

type ForgeSteelBridgeMessage =
	| ForgeSteelReadyMessage
	| ForgeSteelRollResultMessage;

type OwlbearBridgeMessage =
	| OwlbearApplyDefaultOptionsMessage;

type ExtensionMessageRejectReason =
	| 'origin'
	| 'shape'
	| 'schema'
	| 'duplicate';

interface ExtensionMessageRejectEvent {
	reason: ExtensionMessageRejectReason;
	origin: string;
	data: unknown;
}

export class OwlbearBridge {
	static sendReady = () => {
		OwlbearBridge.post({
			...OwlbearBridge.createBaseMessage('FORGESTEEL_READY'),
			type: 'FORGESTEEL_READY'
		});
	};

	static sendRollResult = (payload: ForgeSteelRollPayload) => {
		OwlbearBridge.post({
			...OwlbearBridge.createBaseMessage('FORGESTEEL_ROLL_RESULT'),
			type: 'FORGESTEEL_ROLL_RESULT',
			payload: payload
		});
	};

	static listenForExtensionMessages = (props: {
		onApplyDefaultOptions: (payload: OwlbearDefaultOptionsPayload) => void;
		onReject?: (event: ExtensionMessageRejectEvent) => void;
	}) => {
		const sourceOrigin = OwlbearBridge.getTargetOrigin();
		if (!sourceOrigin) {
			return () => undefined;
		}

		const seenMessageIDs = new Set<string>();

		const handleMessage = (event: MessageEvent<unknown>) => {
			if (event.origin !== sourceOrigin) {
				props.onReject?.({ reason: 'origin', origin: event.origin, data: event.data });
				return;
			}

			const message = OwlbearBridge.parseExtensionMessage(event.data);
			if (!message) {
				props.onReject?.({ reason: 'shape', origin: event.origin, data: event.data });
				return;
			}

			if (message.schemaVersion !== SCHEMA_VERSION) {
				props.onReject?.({ reason: 'schema', origin: event.origin, data: event.data });
				return;
			}

			if (seenMessageIDs.has(message.messageId)) {
				props.onReject?.({ reason: 'duplicate', origin: event.origin, data: event.data });
				return;
			}

			seenMessageIDs.add(message.messageId);

			switch (message.type) {
				case 'OWLBEAR_APPLY_DEFAULT_OPTIONS':
					props.onApplyDefaultOptions(message.payload);
					break;
			}
		};

		window.addEventListener('message', handleMessage);

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	};

	private static post = (message: ForgeSteelBridgeMessage) => {
		const targetOrigin = OwlbearBridge.getTargetOrigin();
		if (!targetOrigin) {
			return;
		}

		window.parent.postMessage(message, targetOrigin);
	};

	private static createBaseMessage = (
		type: ForgeSteelBridgeMessageType
	): ForgeSteelBaseMessage => {
		return {
			type: type,
			schemaVersion: SCHEMA_VERSION,
			messageId: OwlbearBridge.createMessageID(),
			timestamp: new Date().toISOString(),
			source: 'forgesteel'
		};
	};

	private static getTargetOrigin = (): string | null => {
		if (window.parent === window) {
			return null;
		}

		const params = new URLSearchParams(window.location.search);
		const enabled = params.get('owlbearBridge');
		if (enabled !== '1' && enabled !== 'true') {
			return null;
		}

		const targetOrigin = params.get('owlbearOrigin');
		if (!targetOrigin) {
			return null;
		}

		try {
			return new URL(targetOrigin).origin;
		} catch (error) {
			console.warn('Ignoring invalid Owlbear bridge target origin.', error);
			return null;
		}
	};

	private static createMessageID = (): string => {
		if ('randomUUID' in crypto) {
			return crypto.randomUUID();
		}

		return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	};

	private static parseExtensionMessage = (data: unknown): OwlbearBridgeMessage | null => {
		if (!OwlbearBridge.isRecord(data)) {
			return null;
		}

		if (
			data.source !== 'forgesteel-owlbear' ||
			typeof data.messageId !== 'string' ||
			typeof data.timestamp !== 'string'
		) {
			return null;
		}

		if (data.type !== 'OWLBEAR_APPLY_DEFAULT_OPTIONS') {
			return null;
		}

		if (!OwlbearBridge.isDefaultOptionsPayload(data.payload)) {
			return null;
		}

		return data as OwlbearApplyDefaultOptionsMessage;
	};

	private static isDefaultOptionsPayload = (payload: unknown): payload is OwlbearDefaultOptionsPayload => {
		if (!OwlbearBridge.isRecord(payload)) {
			return false;
		}

		const shownStandardAbilities = payload.shownStandardAbilities;
		const compactView = payload.compactView;
		const abilityWidth = payload.abilityWidth;

		return (
			(
				shownStandardAbilities === undefined ||
				shownStandardAbilities === 'all' ||
				(
					Array.isArray(shownStandardAbilities) &&
					shownStandardAbilities.every(item => typeof item === 'string')
				)
			) &&
			(compactView === undefined || typeof compactView === 'boolean') &&
			(abilityWidth === undefined || typeof abilityWidth === 'string')
		);
	};

	private static isRecord = (value: unknown): value is Record<string, unknown> => {
		return typeof value === 'object' && value !== null;
	};
}
