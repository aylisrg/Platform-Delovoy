type OutboxEntry = {
  id: string;
  chatId: string;
  body: string;
  createdAt: number;
};

const DB_NAME = "chat-outbox";
const STORE_NAME = "outbox";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IDB"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, mode);
    const store = t.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `out-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueMessage(chatId: string, body: string): Promise<string> {
  const db = await openDb();
  try {
    const entry: OutboxEntry = {
      id: generateId(),
      chatId,
      body,
      createdAt: Date.now(),
    };
    await tx(db, "readwrite", (store) => store.put(entry));
    return entry.id;
  } finally {
    db.close();
  }
}

async function getAll(db: IDBDatabase): Promise<OutboxEntry[]> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, "readonly");
    const store = t.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as OutboxEntry[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
  });
}

async function deleteEntry(db: IDBDatabase, id: string): Promise<void> {
  await tx(db, "readwrite", (store) => store.delete(id));
}

export async function flushOutbox(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }

  try {
    const entries = await getAll(db);
    for (const entry of entries) {
      try {
        const res = await fetch(`/api/messenger/chats/${entry.chatId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": entry.id,
          },
          credentials: "include",
          body: JSON.stringify({ body: entry.body, clientId: entry.id }),
        });
        if (res.ok) {
          await deleteEntry(db, entry.id);
        }
      } catch {
        // leave entry for next flush
      }
    }
  } finally {
    db.close();
  }
}
