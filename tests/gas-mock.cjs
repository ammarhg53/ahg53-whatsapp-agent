// Minimal in-memory stand-in for the Google Apps Script services Code.gs uses,
// so the Sheets database can be tested without Google.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const data = []; // rows of strings, row 0 = header
  const sheet = {
    name,
    data,
    getLastRow: () => data.length,
    getMaxRows: () => Math.max(data.length, 1000),
    getMaxColumns: () => 26,
    setFrozenRows: () => {},
    deleteRow: (r) => data.splice(r - 1, 1),
    getRange(row, col, nRows = 1, nCols = 1) {
      const range = {
        getValues: () => {
          const out = [];
          for (let r = 0; r < nRows; r++) {
            const src = data[row - 1 + r] || [];
            out.push(Array.from({ length: nCols }, (_, c) => (src[col - 1 + c] ?? '')));
          }
          return out;
        },
        setValues: (vals) => {
          if (vals.length !== nRows || vals.some((v) => v.length !== nCols)) throw new Error('setValues dimension mismatch');
          vals.forEach((v, r) => {
            const idx = row - 1 + r;
            while (data.length <= idx) data.push([]);
            v.forEach((cell, c) => {
              if (typeof cell === 'string' && cell.startsWith('=')) throw new Error('formula written: ' + cell);
              data[idx][col - 1 + c] = cell;
            });
          });
          return range;
        },
        clearContent: () => {
          for (let r = 0; r < nRows; r++) if (data[row - 1 + r]) data[row - 1 + r] = data[row - 1 + r].map(() => '');
          // trim fully empty trailing rows like Sheets' getLastRow does
          while (data.length && data[data.length - 1].every((x) => x === '')) data.pop();
          return range;
        },
        setNumberFormat: () => range,
        setFontWeight: () => range,
        setBackground: () => range
      };
      return range;
    }
  };
  return sheet;
}

function createGas({ secret = 'test-secret-test-secret-123456' } = {}) {
  const sheets = new Map();
  const cache = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name)
  };
  const context = {
    SpreadsheetApp: { getActive: () => ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'API_SECRET' ? secret : null) }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    Logger: { log: () => {} },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), context);
  context.setup();
  const call = (ops, s = secret) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ secret: s, ops }) } }).text);
  return { call, sheets, context, secret };
}

module.exports = { createGas };
