/*
 * db.js
 * -----
 * Offline-first storage using IndexedDB.
 *
 * This file exposes a small API on `window.ExpenseDB` so app.js can:
 *  - save/load expenses
 *  - save/load settings
 *  - save/load premium entitlement
 *
 * Why IndexedDB?
 *  - It persists offline
 *  - It scales better than localStorage
 */

(() => {
  if (!('indexedDB' in window)) {
    const err = () => Promise.reject(new Error('IndexedDB not available'));
    window.ExpenseDB = {
      getAllExpenses: err,
      saveExpense: err,
      deleteExpense: err,
      getSettings: err,
      saveSettings: err,
      getEntitlement: err,
      setEntitlement: err,
    };
    return;
  }

  const DB_NAME = 'expense_guard_db';
  const DB_VERSION = 1;

  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        // Stores all expenses and subscriptions.
        // keyPath: numeric id
        if (!db.objectStoreNames.contains('expenses')) {
          const store = db.createObjectStore('expenses', { keyPath: 'id' });
          store.createIndex('byDate', 'date');
          store.createIndex('byMonth', 'monthKey');
          store.createIndex('byIsSub', 'isSubscription');
        }

        // Stores one settings object (id = 'settings').
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }

        // Stores one entitlement object (id = 'premium').
        if (!db.objectStoreNames.contains('entitlements')) {
          db.createObjectStore('entitlements', { keyPath: 'id' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getDb() {
    if (!dbPromise) dbPromise = openDb();
    return dbPromise;
  }

  function store(db, name, mode = 'readonly') {
    return db.transaction(name, mode).objectStore(name);
  }

  // -------- Expenses --------

  async function getAllExpenses() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'expenses').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveExpense(expense) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'expenses', 'readwrite').put(expense);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function replaceAllExpenses(items) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('expenses', 'readwrite');
      const s = tx.objectStore('expenses');
      const clearReq = s.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        for (const item of items || []) s.put(item);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function deleteExpense(id) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'expenses', 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // -------- Settings --------

  async function getSettings() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'settings').get('settings');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSettings(settings) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'settings', 'readwrite').put({ id: 'settings', ...settings });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // -------- Entitlement --------

  async function getEntitlement() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'entitlements').get('premium');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function setEntitlement(isPremium) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const req = store(db, 'entitlements', 'readwrite').put({
        id: 'premium',
        isPremium: Boolean(isPremium),
        updatedAt: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Expose API
  window.ExpenseDB = {
    getAllExpenses,
    saveExpense,
    replaceAllExpenses,
    deleteExpense,
    getSettings,
    saveSettings,
    getEntitlement,
    setEntitlement,
  };
})();
