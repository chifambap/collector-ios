// sqljs.js — shared sql.js (SQLite compiled to WASM) singleton.
//
// Both local MBTiles basemaps and local GeoPackage overlays read SQLite files
// in the browser, so the WASM module is loaded once and reused.

let _SQL = null;
let _loading = null;

export async function getSqlJs() {
  if (_SQL) return _SQL;
  // Concurrent callers (e.g. two overlays toggled at once) must share one
  // in-flight load rather than each fetching and instantiating the WASM.
  if (_loading) return _loading;

  _loading = (async () => {
    if (!window.initSqlJs) throw new Error('sql.js not loaded');
    const wasmUrl = new URL('./src/vendor/sql-wasm.wasm', window.location.href).href;
    const wasmResponse = await fetch(wasmUrl);
    const wasmBinary = await wasmResponse.arrayBuffer();
    _SQL = await window.initSqlJs({ wasmBinary });
    return _SQL;
  })();

  try {
    return await _loading;
  } finally {
    _loading = null;
  }
}
