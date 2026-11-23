/**
 * store.js — состояние приложения и сохранение в localStorage.
 */

const KEY = "racion.v1";

export const DEFAULT_SETTINGS = {
  store: "magnit",
  budget: 4500,          // ₽ на неделю на всю семью
  adults: 1,
  kids: 0,
  kidAge: 7,
  meals: 3,
  allergens: [],
  dislikes: [],
  likes: [],
  meatlessDays: 0,
  maxTime: 60,
  equipment: ["плита", "сковорода", "духовка"],
  seed: 20261122,
  onboarded: false,
  pricesUrl: "./data/prices-live.json",   // откуда тянуть живые цены
  pricesAuto: true,                       // обновлять автоматически
};

const listeners = new Set();

export const state = {
  catalog: null,
  settings: { ...DEFAULT_SETTINGS },
  overrides: {},        // свои цены (важнее живых)
  checked: {},          // отметки в списке покупок
  pins: {},             // закреплённые блюда: "0:breakfast" -> recipeId
  plan: null,
  tab: "plan",
  day: 0,
  live: { ts: 0, stores: {} },   // живые цены, полученные по сети
  liveStatus: { state: "idle", ts: 0, count: 0, error: "" },
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      state.overrides = data.overrides || {};
      state.checked = data.checked || {};
      state.pins = data.pins || {};
    }
  } catch (e) {
    console.warn("Не удалось прочитать сохранённые настройки", e);
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      settings: state.settings,
      overrides: state.overrides,
      checked: state.checked,
      pins: state.pins,
    }));
  } catch (e) {
    console.warn("Не удалось сохранить настройки", e);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  save();
  listeners.forEach((fn) => fn());
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  notify();
}

export function resetAll() {
  state.settings = { ...DEFAULT_SETTINGS };
  state.overrides = {};
  state.checked = {};
  state.pins = {};
  state.live = { ts: 0, stores: {} };
  notify();
}

/* --------------------------- живые цены --------------------------- */

/**
 * Вносит цены, полученные с сайтов магазинов, в каталог.
 * Приоритет: ручные цены пользователя > живые цены > справочные из каталога.
 * @returns {number} сколько цен применено
 */
export function applyLivePrices(live) {
  if (!live || !live.stores || !state.catalog) return 0;
  const byId = {};
  state.catalog.products.forEach((p) => { byId[p.id] = p; });
  let count = 0;
  for (const [storeId, data] of Object.entries(live.stores)) {
    const items = data.items || data;
    for (const [pid, val] of Object.entries(items)) {
      const product = byId[pid];
      if (!product) continue;
      const price = typeof val === "number" ? val : val.pricePerUnit;
      if (!price || !isFinite(price) || price <= 0) continue;
      product.prices[storeId] = Math.round(price * 100) / 100;
      count++;
    }
  }
  state.live = live;
  state.liveStatus = { state: "ok", ts: live.ts || Date.now(), count, error: "" };
  return count;
}

/** Тянет живые цены по сети. Не роняет приложение, если источник недоступен. */
export async function refreshPrices(url) {
  const source = url || state.settings.pricesUrl;
  if (!source) return { ok: false, error: "источник не задан" };
  state.liveStatus = { ...state.liveStatus, state: "loading" };
  try {
    const res = await fetch(source, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const live = await res.json();
    const count = applyLivePrices(live);
    if (!count) throw new Error("в файле нет цен");
    return { ok: true, count };
  } catch (e) {
    state.liveStatus = { state: "error", ts: state.liveStatus.ts, count: 0, error: String(e.message || e) };
    return { ok: false, error: String(e.message || e) };
  }
}
