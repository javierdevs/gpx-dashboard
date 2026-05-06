const GPX_CACHE = (() => {
    const DB_NAME    = 'gpx-dashboard';
    const DB_VERSION = 1;
    const STORE      = 'gpx-files';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'storage_path' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function get(storagePath) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(storagePath);
            req.onsuccess = (e) => resolve(e.target.result || null);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function put(storagePath, gpxText, meta = {}) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(STORE, 'readwrite');
            const entry = {
                storage_path: storagePath,
                gpxText,
                displayName: meta.displayName || null,
                color:       meta.color       || null,
                cachedAt:    Date.now(),
            };
            const req = tx.objectStore(STORE).put(entry);
            req.onsuccess = () => resolve(entry);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function remove(storagePath) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readwrite');
            const req = tx.objectStore(STORE).delete(storagePath);
            req.onsuccess = () => resolve();
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function keys() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx  = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAllKeys();
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    async function pruneOrphans(activeStoragePaths) {
        const cached = await keys();
        const active = new Set(activeStoragePaths);
        for (const key of cached) {
            if (!active.has(key)) {
                await remove(key);
                console.log('[GPX Cache] pruned orphan:', key);
            }
        }
    }

    async function updateMeta(storagePath, meta = {}) {
        const existing = await get(storagePath);
        if (!existing) return;
        await put(storagePath, existing.gpxText, {
            displayName: meta.displayName ?? existing.displayName,
            color:       meta.color       ?? existing.color,
        });
    }

    return { get, put, remove, keys, pruneOrphans, updateMeta };
})();