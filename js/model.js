/**
 * model.js — чистые функции: цены, аллергены, порции, форматирование.
 * Без DOM — используется и приложением, и тестами.
 */

export const RUB = "₽";

/** Аллергены и запреты -> список id продуктов, которые их содержат. */
export const ALLERGENS = [
  { id: "gluten",  name: "Глютен",   products: ["p_flour", "p_pasta", "p_bread", "p_bread_rye", "p_baguette", "p_pita", "p_semolina"] },
  { id: "lactose", name: "Лактоза",  products: ["p_milk", "p_kefir", "p_sour_cream", "p_cream", "p_cottage", "p_cheese",
                                               "p_mozzarella", "p_feta", "p_butter", "p_cream_cheese", "p_yogurt"] },
  { id: "eggs",    name: "Яйца",     products: ["p_eggs"] },
  { id: "nuts",    name: "Орехи",    products: ["p_peanut", "p_walnut", "p_almond", "p_sesame"] },
  { id: "fish",    name: "Рыба",     products: ["p_cod", "p_pollock", "p_herring", "p_tuna", "p_mussel"] },
  { id: "meat",    name: "Мясо",     products: ["p_beef", "p_pork", "p_mince", "p_lard", "p_boiled_saus"] },
  { id: "poultry", name: "Птица",    products: ["p_chicken_breast", "p_chicken_thigh", "p_chicken_whole", "p_chicken_mince", "p_offal", "p_liver"] },
  { id: "pork",    name: "Свинина",  products: ["p_pork", "p_lard"] },
  { id: "soy",     name: "Соя",      products: ["p_soy"] },
  { id: "mushroom",name: "Грибы",    products: ["p_mushroom"] },
  { id: "seafood", name: "Морепродукты", products: ["p_mussel"] },
];

/** Коэффициент порции по возрасту ребёнка. */
export function kidPortion(age) {
  if (age <= 2) return 0.4;
  if (age <= 6) return 0.6;
  if (age <= 12) return 0.8;
  return 1.0;
}

/** Суммарное число порций на семью. */
export function familyPortions(settings) {
  const kid = kidPortion(settings.kidAge ?? 7);
  return (settings.adults || 0) + (settings.kids || 0) * kid;
}

/** Цена продукта с учётом пользовательских переопределений. */
export function priceOf(product, storeId, overrides) {
  const ov = overrides || {};
  const perStore = ov[storeId];
  if (perStore && typeof perStore[product.id] === "number") return perStore[product.id];
  if (typeof ov[product.id] === "number") return ov[product.id];
  return product.prices[storeId];
}

/** Стоимость одной порции рецепта в выбранном магазине. */
export function portionCost(recipe, storeId, productIndex, overrides) {
  let sum = 0;
  for (const ing of recipe.ingredients) {
    const p = productIndex[ing.p];
    if (!p) continue;
    const scale = p.unit === "pcs" ? 1 : ing.q / 1000;
    sum += priceOf(p, storeId, overrides) * scale;
  }
  return Math.round(sum);
}

/** Все продукты, которые рецепт не может содержать при заданных ограничениях. */
export function forbiddenProducts(settings) {
  const bad = new Set();
  for (const a of ALLERGENS) {
    if ((settings.allergens || []).includes(a.id)) a.products.forEach((p) => bad.add(p));
  }
  for (const d of settings.dislikes || []) bad.add(d);
  return bad;
}

/** Проверка: подходит ли рецепт под ограничения пользователя. */
export function fitsRecipe(recipe, settings, productIndex, opts = {}) {
  const forbidden = opts.forbidden || forbiddenProducts(settings);
  for (const ing of recipe.ingredients) {
    if (forbidden.has(ing.p)) return false;
  }
  const equip = settings.equipment || [];
  if (equip.length && recipe.equip.some((e) => !equip.includes(e))) return false;
  if (settings.maxTime && recipe.time > settings.maxTime) return false;
  if (opts.noMeat) {
    const meatish = recipe.ingredients.some((ing) => {
      const p = productIndex[ing.p];
      return p && (p.cat === "meat" || p.cat === "fish");
    });
    if (meatish) return false;
  }
  return true;
}

/** Основной белок блюда — для контроля разнообразия. */
export function mainKind(recipe, productIndex) {
  let best = null, bestCat = null;
  const order = { meat: 3, fish: 3, dairy: 2, veg: 1, grain: 1, other: 1 };
  for (const ing of recipe.ingredients) {
    const p = productIndex[ing.p];
    if (!p) continue;
    const w = order[p.cat] || 0;
    if (!bestCat || w > best) {
      if (w >= 2) { bestCat = p.cat; break; }
      if (!bestCat) { bestCat = p.cat; best = w; }
    }
  }
  return bestCat || "other";
}

/* --------------------------- форматирование --------------------------- */

const NBSP = " ";

export function rub(n, withSign = false) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = v < 0 ? "−" : (withSign && v > 0 ? "+" : "");
  return `${sign}${s}${NBSP}${RUB}`;
}

export function num(n, digits = 0) {
  const v = Number(n) || 0;
  return v.toFixed(digits).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Количество в человекочитаемом виде: 1250 г -> "1,25 кг". */
export function qty(value, unit) {
  if (unit === "kg") return `${num(value, value < 1 ? 2 : 2)}${NBSP}кг`;
  if (unit === "l") return `${num(value, 2)}${NBSP}л`;
  return `${Math.ceil(value - 1e-9)}${NBSP}шт`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/**
 * Разбор пользовательских цен.
 * Поддерживает:
 *   JSON плоский:  { "p_oats": 249 }
 *   JSON по магазинам: { "magnit": { "p_oats": 249 } }
 *   CSV:            "p_oats,249" (по id или по названию товара)
 * @returns {{overrides: object, count: number, error?: string}}
 */
export function parsePrices(raw, catalog) {
  if (!raw || !raw.trim()) return { error: "Пусто", overrides: {}, count: 0 };
  const overrides = {};
  let count = 0;

  const byId = {};
  const byName = {};
  catalog.products.forEach((p) => {
    byId[p.id] = p;
    byName[p.name.toLowerCase()] = p;
  });

  const setPrice = (target, key, value) => {
    const price = Number(String(value).replace(",", "."));
    if (!isFinite(price) || price < 0) return false;
    const p = byId[key] || byName[String(key).trim().toLowerCase()];
    if (!p) return false;
    target[p.id] = Math.round(price);
    count++;
    return true;
  };

  if (raw.trim().startsWith("{")) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { error: "Не разобрали JSON", overrides: {}, count: 0 };
    }
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object") {
        if (!catalog.stores.some((s) => s.id === key)) continue;
        overrides[key] = overrides[key] || {};
        for (const [pid, price] of Object.entries(value)) setPrice(overrides[key], pid, price);
      } else {
        setPrice(overrides, key, value);
      }
    }
  } else {
    // CSV: разделитель — последний перед числом, чтобы названия с запятыми не ломались
    for (const line of raw.split(/\r?\n/)) {
      const m = line.trim().match(/^(.*)[;,]\s*(\d+(?:[.,]\d+)?)\s*$/);
      if (!m) continue;
      setPrice(overrides, m[1], m[2]);
    }
  }

  if (!count) return { error: "Не нашли ни одной цены", overrides: {}, count: 0 };
  return { overrides, count };
}
