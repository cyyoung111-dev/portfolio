// 공용 DOM/Storage 유틸
const $el = id => document.getElementById(id);
const lsSave   = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {} };
const lsGet    = (key, def) => { try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) : def; } catch(e) { return def; } };
const lsRemove = (key) => { try { localStorage.removeItem(key); } catch(e) {} };
