// Tiny history-aware view router. A route renderer returns an element or { el, destroy }.
import { emit } from './state.js';

const routes = {};
const hist = [];
let idx = -1;
let cleanup = null;

export const route = { name: 'home', param: null };
export const registerRoute = (name, render) => { routes[name] = render; };
export const canBack = () => idx > 0;
export const canForward = () => idx < hist.length - 1;

function mount({ keepScroll } = {}) {
  const view = document.getElementById('view');
  const entry = hist[idx];
  route.name = entry.name;
  route.param = entry.param;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const prevScroll = view.scrollTop;
  const out = (routes[entry.name] || routes.home)(entry.param);
  const el = out.el || out;
  cleanup = out.destroy || null;
  el.classList.add('page-enter');
  view.replaceChildren(el);
  view.scrollTop = keepScroll ? prevScroll : entry.scroll || 0;
  emit('route', { ...route, canBack: canBack(), canForward: canForward() });
}

function saveScroll() {
  const view = document.getElementById('view');
  if (hist[idx] && view) hist[idx].scroll = view.scrollTop;
}

export function navigate(name, param = null, { replace = false } = {}) {
  const cur = hist[idx];
  if (cur && cur.name === name && JSON.stringify(cur.param) === JSON.stringify(param) && !replace) return;
  saveScroll();
  if (replace && idx >= 0) hist[idx] = { name, param, scroll: 0 };
  else { hist.length = idx + 1; hist.push({ name, param, scroll: 0 }); idx = hist.length - 1; }
  mount();
}

export function back() { if (canBack()) { saveScroll(); idx--; mount(); } }
export function forward() { if (canForward()) { saveScroll(); idx++; mount(); } }
export function refresh() { if (idx >= 0) mount({ keepScroll: true }); }
