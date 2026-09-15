/**
 * Where an unlocked identity lives on this device.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * The identity is cached as a **non-extractable** X25519 `CryptoKey`. That is
 * the point of the whole arrangement: `CryptoKey` is structured-cloneable, so
 * it round-trips through IndexedDB with no serialisation, and once stored there
 * is no API anywhere that turns it back into bytes. Script injected into the
 * page can use the key for as long as it runs, but cannot walk away with it.
 * (That narrows the blast radius. It is not a substitute for a CSP.)
 *
 * Two things are treated as normal rather than exceptional, because they are:
 *
 * - **Not every browser can store a `CryptoKey`.** Some WebKit builds throw
 *   `DataCloneError` on structured-cloning one, and Safari's private browsing
 *   restricts IndexedDB outright. So this probes by writing and reading back,
 *   once, and permanently falls back to memory if that fails.
 * - **Storage gets evicted.** iOS drops IndexedDB after about a week of
 *   inactivity, and any browser may evict under pressure. So the unlock prompt
 *   is a designed screen and not an error state.
 */

const DB_NAME = 'bound-up-keys';
const DB_VERSION = 1;
const IDENTITY_STORE = 'identity';
const PIN_STORE = 'pins';

export type CachedIdentity = {
	/** The user this identity belongs to, so a different login is not handed it. */
	userId: string;
	recipient: string;
	/**
	 * The private identity. A non-extractable `CryptoKey` where the browser can
	 * do X25519, otherwise the `AGE-SECRET-KEY-1…` string — which is only ever
	 * held in memory, never written here.
	 */
	key: CryptoKey | string;
};

export type PinRow = {
	/** `${userId}:${partnershipId}`, so one device can hold several accounts' pins. */
	id: string;
	userId: string;
	partnershipId: string;
	recipient: string;
	pinnedAt: number;
	verifiedAt: number | null;
};

export type KeyStore = {
	getIdentity(userId: string): Promise<CachedIdentity | undefined>;
	putIdentity(value: CachedIdentity): Promise<void>;
	getPins(userId: string): Promise<PinRow[]>;
	putPin(row: PinRow): Promise<void>;
	/** Everything for one user, on sign-out. */
	clear(userId: string): Promise<void>;
	/** Whether writes actually persist. False means memory-only for this session. */
	readonly durable: boolean;
};

// ── the memory backend ───────────────────────────────────────────────────────

function createMemoryStore(): KeyStore {
	const identities = new Map<string, CachedIdentity>();
	const pins = new Map<string, PinRow>();

	return {
		durable: false,
		async getIdentity(userId) {
			return identities.get(userId);
		},
		async putIdentity(value) {
			identities.set(value.userId, value);
		},
		async getPins(userId) {
			return [...pins.values()].filter((row) => row.userId === userId);
		},
		async putPin(row) {
			pins.set(row.id, row);
		},
		async clear(userId) {
			identities.delete(userId);
			for (const [id, row] of pins) if (row.userId === userId) pins.delete(id);
		}
	};
}

// ── the IndexedDB backend ────────────────────────────────────────────────────

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
				db.createObjectStore(IDENTITY_STORE, { keyPath: 'userId' });
			}
			if (!db.objectStoreNames.contains(PIN_STORE)) {
				const pins = db.createObjectStore(PIN_STORE, { keyPath: 'id' });
				pins.createIndex('userId', 'userId');
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		// A version change from another tab, or a blocked open, must not hang the
		// unlock screen forever.
		request.onblocked = () => reject(new Error('IndexedDB open was blocked'));
	});
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function createIndexedDbStore(db: IDBDatabase): KeyStore {
	function tx(store: string, mode: IDBTransactionMode) {
		return db.transaction(store, mode).objectStore(store);
	}

	return {
		durable: true,
		async getIdentity(userId) {
			return promisify<CachedIdentity | undefined>(tx(IDENTITY_STORE, 'readonly').get(userId));
		},
		async putIdentity(value) {
			await promisify(tx(IDENTITY_STORE, 'readwrite').put(value));
		},
		async getPins(userId) {
			return promisify<PinRow[]>(tx(PIN_STORE, 'readonly').index('userId').getAll(userId));
		},
		async putPin(row) {
			await promisify(tx(PIN_STORE, 'readwrite').put(row));
		},
		async clear(userId) {
			await promisify(tx(IDENTITY_STORE, 'readwrite').delete(userId));
			for (const row of await this.getPins(userId)) {
				await promisify(tx(PIN_STORE, 'readwrite').delete(row.id));
			}
		}
	};
}

let storePromise: Promise<KeyStore> | undefined;

/**
 * The store for this device, probed once.
 *
 * The probe writes a real `CryptoKey` and reads it back, because that is the
 * operation that actually fails on the browsers that fail — `indexedDB` being
 * defined says nothing about whether it will clone a key.
 */
export function keyStore(): Promise<KeyStore> {
	return (storePromise ??= (async () => {
		if (typeof indexedDB === 'undefined') return createMemoryStore();

		try {
			const db = await openDatabase();
			const store = createIndexedDbStore(db);
			const existingIdentityCount = await promisify(
				db.transaction(IDENTITY_STORE, 'readonly').objectStore(IDENTITY_STORE).count()
			);

			// A device that already has any cached identity has already proved that
			// this browser/profile can round-trip a CryptoKey through IndexedDB, so
			// there is no reason to burn another X25519 generate/write/read probe on
			// every cold start before the app can even see whether THIS user has one.
			if (existingIdentityCount > 0) return store;

			const probeKey = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
				'deriveBits'
			])) as CryptoKeyPair;
			const probe: CachedIdentity = {
				userId: '__probe__',
				recipient: 'probe',
				key: probeKey.privateKey
			};
			await store.putIdentity(probe);
			const readBack = await store.getIdentity('__probe__');
			await store.clear('__probe__');
			if (!readBack || !(readBack.key instanceof CryptoKey)) return createMemoryStore();

			return store;
		} catch {
			// DataCloneError, a blocked open, private browsing, a quota refusal —
			// all of them mean the same thing here, and all of them are survivable.
			return createMemoryStore();
		}
	})());
}

/** Test seam: forget the probed backend. */
export function resetKeyStore(): void {
	storePromise = undefined;
}

export { createMemoryStore };
