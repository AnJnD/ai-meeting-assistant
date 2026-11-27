// rec-db.js — kho lưu bản ghi trên máy (IndexedDB của extension).
//
// Store 'recs'   : metadata mỗi bản ghi (id, title, durationMs, timeline, minutes…)
// Store 'chunks' : các đoạn ~5s của file ghi, khoá [recId, kind, seq]
//                  kind = 'main' (video/âm thanh chính) | 'aux' (âm thanh mono nhẹ)
//
// Ghi theo đoạn thay vì giữ cả file trong RAM: cuộc họp dài vài GB không làm
// tràn bộ nhớ, và Chrome có crash thì các đoạn đã ghi vẫn còn.
// Manifest có "unlimitedStorage" nên Chrome không tự xoá dữ liệu này.

(function (root) {
  'use strict';

  const DB_NAME = 'mt_recordings';
  const DB_VER  = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) {
          const s = db.createObjectStore('chunks', { keyPath: ['recId', 'kind', 'seq'] });
          s.createIndex('byRec', 'recId');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // Chạy fn trong một transaction, resolve khi transaction COMMIT xong
  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      Promise.resolve(fn(tx)).then(v => { result = v; }, err => { try { tx.abort(); } catch (_) {} reject(err); });
    });
  }

  const RecDB = {
    putRec(rec) {
      return run(['recs'], 'readwrite', tx => { tx.objectStore('recs').put(rec); });
    },

    getRec(id) {
      return run(['recs'], 'readonly', tx => reqP(tx.objectStore('recs').get(id)));
    },

    // Gộp patch vào bản ghi hiện có (trong cùng 1 transaction → không ghi đè lẫn nhau)
    updateRec(id, patch) {
      return run(['recs'], 'readwrite', async tx => {
        const store = tx.objectStore('recs');
        const cur = await reqP(store.get(id));
        if (!cur) return null;
        const next = Object.assign({}, cur, typeof patch === 'function' ? patch(cur) : patch);
        store.put(next);
        return next;
      });
    },

    // Mới nhất trước
    async listRecs() {
      const all = await run(['recs'], 'readonly', tx => reqP(tx.objectStore('recs').getAll()));
      return (all || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },

    async countRecs() {
      return run(['recs'], 'readonly', tx => reqP(tx.objectStore('recs').count()));
    },

    putChunk(recId, kind, seq, blob) {
      return run(['chunks'], 'readwrite', tx => {
        tx.objectStore('chunks').put({ recId, kind, seq, blob, size: blob.size });
      });
    },

    // Các Blob theo đúng thứ tự seq (khoá tổng hợp đã sắp xếp sẵn)
    async getChunks(recId, kind) {
      const range = IDBKeyRange.bound([recId, kind, 0], [recId, kind, Infinity]);
      const rows = await run(['chunks'], 'readonly', tx => reqP(tx.objectStore('chunks').getAll(range)));
      return (rows || []).map(r => r.blob);
    },

    // Xoá dữ liệu của một loại (vd. 'main' = video) mà vẫn giữ bản ghi
    deleteChunks(recId, kind) {
      const range = IDBKeyRange.bound([recId, kind, 0], [recId, kind, Infinity]);
      return run(['chunks'], 'readwrite', tx => { tx.objectStore('chunks').delete(range); });
    },

    async hasChunks(recId, kind) {
      const range = IDBKeyRange.bound([recId, kind, 0], [recId, kind, Infinity]);
      const n = await run(['chunks'], 'readonly', tx => reqP(tx.objectStore('chunks').count(range)));
      return n > 0;
    },

    // Chỉ giữ `keep` bản ghi mới nhất, xoá phần còn lại (cả metadata lẫn file).
    // maxAgeMs (tuỳ chọn): xoá thêm các bản ghi tạo cách đây quá maxAgeMs.
    // exceptIds: bản ghi KHÔNG bao giờ bị xoá (đang ghi / vừa lưu) — vẫn tính vào số giữ.
    async pruneKeep(keep, exceptIds, maxAgeMs) {
      const skip = new Set((exceptIds || []).filter(Boolean));
      const all  = await this.listRecs();                       // mới nhất trước
      const cutoff = maxAgeMs > 0 ? Date.now() - maxAgeMs : -Infinity;
      const old  = all.filter((r, i) => !skip.has(r.id) &&
        (i >= Math.max(0, keep) || (r.createdAt || 0) < cutoff));
      for (const r of old) { try { await this.deleteRec(r.id); } catch (_) {} }
      return old.length;
    },

    deleteRec(id) {
      return run(['recs', 'chunks'], 'readwrite', async tx => {
        tx.objectStore('recs').delete(id);
        const idx  = tx.objectStore('chunks').index('byRec');
        const keys = await reqP(idx.getAllKeys(id));
        const cs   = tx.objectStore('chunks');
        (keys || []).forEach(k => cs.delete(k));
      });
    }
  };

  root.RecDB = RecDB;
})(typeof globalThis !== 'undefined' ? globalThis : self);
