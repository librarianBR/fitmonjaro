// Acesso ao IndexedDB. Cada parte do estado vira um registro (ver toRecords em logic.js).

const NAME = 'fitmonjaro';
const VERSION = 2; // 2: rascunhos do editor de planos.
export const STORES = ['meta', 'plans', 'sessions', 'measurements', 'injections', 'daily', 'drafts'];

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Banco de dados bloqueado por outra aba'));
  });
}

export async function readAll(db) {
  const tx = db.transaction(STORES, 'readonly');
  const records = [];
  for (const store of STORES) {
    const os = tx.objectStore(store);
    const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
    keys.forEach((key, i) => records.push({ store, key, value: values[i] }));
  }
  return records;
}

// Aplica gravações e exclusões numa única transação: ou tudo entra, ou nada muda.
export function applyOps(db, ops) {
  return new Promise((resolve, reject) => {
    if (!ops.length) {
      resolve();
      return;
    }
    const tx = db.transaction(STORES, 'readwrite', { durability: 'strict' });
    for (const op of ops) {
      const os = tx.objectStore(op.store);
      if (op.delete) os.delete(op.key);
      else os.put(op.value, op.key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Gravação cancelada'));
  });
}

export function deleteDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Banco de dados em uso'));
  });
}
