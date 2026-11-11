/*!
 * storage-shim.js  —  ACOMAACAP (index.html + caja.html)
 *
 * Reemplaza window.localStorage por una versión con el MISMO API
 * (getItem / setItem / removeItem / clear / key / length) pero guardada en
 * IndexedDB, así se acaba el límite de ~5 MB de localStorage.
 *
 * Cómo funciona:
 *  - Al arrancar abre IndexedDB y carga todo en memoria (lecturas síncronas).
 *  - Cada setItem/removeItem/clear actualiza la memoria al instante y se
 *    escribe en IndexedDB en segundo plano (varias escrituras seguidas se
 *    juntan en una sola transacción).
 *  - La primera vez copia automáticamente lo que ya había en el localStorage
 *    nativo. Esa copia vieja se borra recién a los DIAS_ANTES_LIMPIAR_NATIVO
 *    días (por si algún dispositivo abre una versión vieja de la app).
 *  - index.html y caja.html usan la misma base, así que comparten datos
 *    (caja_movimientos, etc.) igual que antes, y se avisan entre sí los cambios.
 *  - Si IndexedDB no está disponible o falla, no toca nada y la app sigue
 *    con el localStorage nativo.
 *  - sessionStorage NO se toca.
 *
 * Como IndexedDB es asíncrono, los <script> de la app llevan
 * type="text/plain" data-after-storage y este archivo los ejecuta, en orden,
 * cuando el almacenamiento ya está listo.
 */
(function () {
  'use strict';

  var DB_NAME = 'acomaacap_storage';
  var DB_VER = 1;
  var STORE = 'kv';
  var META = 'meta';
  var CANAL = 'acomaacap_storage_sync';
  var DIAS_ANTES_LIMPIAR_NATIVO = 3;
  var TIMEOUT_ABRIR_MS = 10000;

  var nativo = null;
  try { nativo = window.localStorage; } catch (e) { nativo = null; }

  var cache = new Map();
  var db = null;
  var activo = false;
  var ops = [];
  var agendado = false;
  var cadena = Promise.resolve();
  var avisoError = false;
  var canal = null;
  try { if (window.BroadcastChannel) canal = new BroadcastChannel(CANAL); } catch (e) { canal = null; }

  /* ---------- parche: listeners de carga registrados "tarde" ---------- */
  // Como los scripts de la app se ejecutan después de que el DOM ya cargó,
  // los listeners de DOMContentLoaded / load que registren se disparan igual.
  var addDoc = document.addEventListener;
  var addWin = window.addEventListener;
  function llamar(f, tipo, objetivo) {
    setTimeout(function () {
      try {
        var ev = new Event(tipo);
        if (typeof f === 'function') f.call(objetivo, ev);
        else if (f && typeof f.handleEvent === 'function') f.handleEvent(ev);
      } catch (err) { console.error(err); }
    }, 0);
  }
  document.addEventListener = function (tipo, f) {
    if (tipo === 'DOMContentLoaded' && f && document.readyState !== 'loading') {
      llamar(f, tipo, document);
      return;
    }
    return addDoc.apply(this, arguments);
  };
  window.addEventListener = function (tipo, f) {
    if (tipo === 'load' && f && document.readyState === 'complete') {
      llamar(f, tipo, window);
      return;
    }
    return addWin.apply(this, arguments);
  };

  /* ---------- utilidades ---------- */
  function enviar(msg) { try { if (canal) canal.postMessage(msg); } catch (e) {} }

  function avisarError(err) {
    console.error('[storage-shim] No se pudo guardar en IndexedDB:', err);
    try { window.dispatchEvent(new CustomEvent('storage-shim-error', { detail: err })); } catch (e) {}
    if (!avisoError) {
      avisoError = true;
      try {
        alert('⚠️ No se pudo guardar en el almacenamiento del dispositivo. ' +
              'Puede que esté lleno. Haz un respaldo y libera espacio.');
      } catch (e) {}
    }
  }

  function encolar(op) {
    if (op.o === 'c') {
      ops = [op];
    } else {
      ops = ops.filter(function (x) { return x.o === 'c' || x.k !== op.k; });
      ops.push(op);
    }
    if (!agendado) {
      agendado = true;
      Promise.resolve().then(vaciar);
    }
  }

  function vaciar() {
    agendado = false;
    if (!db || !ops.length) return;
    var lote = ops;
    ops = [];
    cadena = cadena.then(function () { return escribir(lote); }).catch(avisarError);
  }

  function escribir(lote) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, 'readwrite');
      var st = tx.objectStore(STORE);
      lote.forEach(function (x) {
        if (x.o === 'c') st.clear();
        else if (x.o === 'p') st.put(x.v, x.k);
        else st.delete(x.k);
      });
      tx.oncomplete = function () { res(); };
      tx.onerror = tx.onabort = function () { rej(tx.error || new Error('Transacción fallida')); };
    });
  }

  /* ---------- API tipo Storage ---------- */
  function getItem(k) {
    k = String(k);
    return cache.has(k) ? cache.get(k) : null;
  }
  function setItem(k, v) {
    k = String(k); v = String(v);
    cache.set(k, v);
    encolar({ o: 'p', k: k, v: v });
    enviar({ t: 's', k: k, v: v });
  }
  function removeItem(k) {
    k = String(k);
    if (!cache.has(k)) return;
    cache.delete(k);
    encolar({ o: 'd', k: k });
    enviar({ t: 'd', k: k });
  }
  function clear() {
    cache.clear();
    encolar({ o: 'c' });
    enviar({ t: 'c' });
  }
  function key(i) {
    var ks = Array.from(cache.keys());
    return i >= 0 && i < ks.length ? ks[i] : null;
  }

  var metodos = { getItem: getItem, setItem: setItem, removeItem: removeItem, clear: clear, key: key };

  var proxy = new Proxy({}, {
    get: function (_, p) {
      if (p === 'length') return cache.size;
      if (typeof p === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(metodos, p)) return metodos[p];
      return cache.has(p) ? cache.get(p) : undefined;
    },
    set: function (_, p, v) { if (typeof p === 'string') setItem(p, v); return true; },
    deleteProperty: function (_, p) { if (typeof p === 'string') removeItem(p); return true; },
    has: function (_, p) { return typeof p === 'string' && (cache.has(p) || p in metodos || p === 'length'); },
    ownKeys: function () { return Array.from(cache.keys()); },
    getOwnPropertyDescriptor: function (_, p) {
      if (typeof p === 'string' && cache.has(p)) {
        return { value: cache.get(p), writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    }
  });

  /* ---------- cambios que vienen de otra pestaña / página (caja ↔ facturación) ---------- */
  if (canal) {
    canal.onmessage = function (e) {
      var d = e && e.data;
      if (!d || !activo) return;
      var viejo = null;
      if (d.t === 's') { viejo = cache.has(d.k) ? cache.get(d.k) : null; cache.set(d.k, d.v); }
      else if (d.t === 'd') { viejo = cache.has(d.k) ? cache.get(d.k) : null; cache.delete(d.k); }
      else if (d.t === 'c') { cache.clear(); }
      else return;
      try {
        window.dispatchEvent(new StorageEvent('storage', {
          key: d.t === 'c' ? null : d.k,
          oldValue: viejo,
          newValue: d.t === 's' ? d.v : null
        }));
      } catch (err) {}
    };
  }

  /* ---------- IndexedDB: abrir, leer, migrar ---------- */
  function abrir() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('IndexedDB no disponible')); return; }
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error('Apertura bloqueada')); };
    });
  }

  function leerTodo(d) {
    return new Promise(function (res, rej) {
      var datos = [];
      var tx = d.transaction([STORE, META], 'readonly');
      var c = tx.objectStore(STORE).openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (cur) { datos.push([cur.key, cur.value]); cur.continue(); }
      };
      var m = tx.objectStore(META).get('migracion');
      tx.oncomplete = function () { res({ datos: datos, meta: m.result }); };
      tx.onerror = tx.onabort = function () { rej(tx.error); };
    });
  }

  function guardarMeta(d, meta) {
    return new Promise(function (res, rej) {
      var tx = d.transaction(META, 'readwrite');
      tx.objectStore(META).put(meta, 'migracion');
      tx.oncomplete = function () { res(); };
      tx.onerror = tx.onabort = function () { rej(tx.error); };
    });
  }

  function migrarDesdeNativo(d, meta) {
    // Primera vez: copiar lo que hubiera en el localStorage nativo.
    if (!meta) {
      var lote = [];
      if (nativo) {
        try {
          for (var i = 0; i < nativo.length; i++) {
            var k = nativo.key(i);
            if (k !== null && !cache.has(k)) {
              var v = nativo.getItem(k);
              if (v !== null) { cache.set(k, v); lote.push({ o: 'p', k: k, v: v }); }
            }
          }
        } catch (e) { console.warn('[storage-shim] No se pudo leer el localStorage nativo:', e); }
      }
      meta = { en: Date.now(), limpio: false, copiadas: lote.length };
      var p = lote.length ? escribirEn(d, lote) : Promise.resolve();
      return p.then(function () { return guardarMeta(d, meta); });
    }
    // Más adelante: liberar el espacio del localStorage nativo.
    if (!meta.limpio && nativo && (Date.now() - meta.en) > DIAS_ANTES_LIMPIAR_NATIVO * 86400000) {
      try {
        var borrar = [];
        for (var j = 0; j < nativo.length; j++) {
          var kk = nativo.key(j);
          if (kk !== null && cache.has(kk)) borrar.push(kk);
        }
        borrar.forEach(function (x) { nativo.removeItem(x); });
        meta.limpio = true;
        return guardarMeta(d, meta);
      } catch (e) { console.warn('[storage-shim] No se pudo limpiar el nativo:', e); }
    }
    return Promise.resolve();
  }

  function escribirEn(d, lote) {
    return new Promise(function (res, rej) {
      var tx = d.transaction(STORE, 'readwrite');
      var st = tx.objectStore(STORE);
      lote.forEach(function (x) { st.put(x.v, x.k); });
      tx.oncomplete = function () { res(); };
      tx.onerror = tx.onabort = function () { rej(tx.error); };
    });
  }

  function instalarProxy() {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      get: function () { return proxy; }
    });
  }

  var listoStorage = new Promise(function (resolve) {
    var terminado = false;
    function fin(ok, motivo) {
      if (terminado) return;
      terminado = true;
      clearTimeout(t);
      if (!ok) console.warn('[storage-shim] Usando localStorage nativo:', motivo);
      resolve(ok);
    }
    var t = setTimeout(function () { fin(false, 'IndexedDB tardó demasiado'); }, TIMEOUT_ABRIR_MS);

    abrir().then(function (d) {
      if (terminado) { try { d.close(); } catch (e) {} return; }
      return leerTodo(d).then(function (r) {
        r.datos.forEach(function (p) { cache.set(p[0], p[1]); });
        return migrarDesdeNativo(d, r.meta);
      }).then(function () {
        if (terminado) return;
        instalarProxy();
        db = d;
        activo = true;
        vaciar();
        try {
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        } catch (e) {}
        fin(true);
      });
    }).catch(function (err) {
      cache.clear();
      fin(false, err && err.message ? err.message : err);
    });
  });

  /* ---------- ejecutar los scripts de la app cuando todo está listo ---------- */
  var domListo = new Promise(function (res) {
    if (document.readyState !== 'loading') res();
    else addDoc.call(document, 'DOMContentLoaded', function () { res(); });
  });

  Promise.all([listoStorage, domListo]).then(function () {
    var lista = document.querySelectorAll('script[type="text/plain"][data-after-storage]');
    Array.prototype.forEach.call(lista, function (n) {
      var s = document.createElement('script');
      if (n.hasAttribute('data-module')) s.type = 'module';
      s.textContent = n.textContent;
      n.parentNode.insertBefore(s, n);
      n.parentNode.removeChild(n);
    });
  });

  /* ---------- API pública ---------- */
  window.StorageShim = {
    ready: listoStorage,
    get activo() { return activo; },
    // Uso y cuota del almacenamiento del dispositivo (bytes)
    info: function () {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
      return Promise.resolve({});
    },
    claves: function () { return Array.from(cache.keys()); }
  };
})();
