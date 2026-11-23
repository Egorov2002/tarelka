/**
 * planner.js — сборка рациона и списка покупок.
 *
 * Алгоритм:
 *  1) кандидаты по типу приёма пищи, отфильтрованные по аллергиям,
 *     нелюбимым продуктам, технике, времени готовки и дням без мяса;
 *  2) базовый выбор — самое дешёвое из ещё не использованного;
 *  3) балансировка дня: если дороже суточной нормы — меняем на дешёвые
 *     альтернативы, если дешевле — «улучшаем» блюда по счёту разнообразия;
 *  4) недельный баланс: если неделя дороже бюджета — точечная замена;
 *  5) список покупок: агрегация ингредиентов с округлением до покупных
 *     объёмов и ценами выбранного магазина.
 *
 * Модуль чистый: без DOM, детерминирован по seed.
 */

import {
  familyPortions, forbiddenProducts, fitsRecipe, mainKind,
  portionCost, priceOf,
} from "./model.js";

export const MEALS = ["breakfast", "lunch", "dinner"];

/** Детерминированный ГПСЧ. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meatlessDayIndexes(count) {
  const n = Math.max(0, Math.min(7, count | 0));
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * 7) / n) % 7);
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * @param {object} catalog  — каталог (products, recipes, stores, categories)
 * @param {object} settings — настройки пользователя
 * @param {object} [overrides] — свои цены: {productId: price} или {storeId: {productId: price}}
 * @param {object} [pins] — закреплённые блюда: {"0:breakfast": "r_id"}
 */
export function buildPlan(catalog, settings, overrides = {}, pins = {}) {
  const storeId = settings.store || catalog.stores[0].id;
  const productIndex = {};
  catalog.products.forEach((p) => { productIndex[p.id] = p; });
  const recipeIndex = {};
  catalog.recipes.forEach((r) => { recipeIndex[r.id] = r; });

  const rnd = mulberry32(settings.seed || 42);
  const portions = familyPortions(settings);
  const budget = Math.max(0, Number(settings.budget) || 0);
  const dayBudget = budget / 7;
  // внутри балансировки считаем в «порциях», а не в деньгах на семью:
  // стоимость блюда в плане — за одну порцию, бюджет — на всю семью
  const dayBudgetPerPortion = portions > 0 ? dayBudget / portions : dayBudget;

  const costs = {};
  for (const r of catalog.recipes) {
    costs[r.id] = portionCost(r, storeId, productIndex, overrides);
  }

  const slots = settings.meals === 4 ? [...MEALS, "snack"] : [...MEALS];
  const shares = settings.meals === 4
    ? { breakfast: 0.26, lunch: 0.32, dinner: 0.30, snack: 0.12 }
    : { breakfast: 0.28, lunch: 0.36, dinner: 0.36 };
  const shareSum = slots.reduce((s, m) => s + shares[m], 0);

  const forbidden = forbiddenProducts(settings);
  const vegDays = meatlessDayIndexes(settings.meatlessDays || 0);
  const warnings = [];

  // --- кандидаты ------------------------------------------------------------
  const candidatesByMeal = {};
  for (const meal of slots) {
    candidatesByMeal[meal] = catalog.recipes.filter(
      (r) => r.meals.includes(meal) && fitsRecipe(r, settings, productIndex, { forbidden })
    );
  }
  for (const meal of slots) {
    if (!candidatesByMeal[meal].length) {
      // мягкий откат: снимаем время и технику, но НЕ аллергены и нелюбимое
      const relaxed = catalog.recipes.filter(
        (r) => r.meals.includes(meal) &&
          fitsRecipe(r, { ...settings, maxTime: 0, equipment: [] }, productIndex, { forbidden })
      );
      if (relaxed.length) {
        candidatesByMeal[meal] = relaxed;
        warnings.push({ tone: "warn", text: `Для «${mealLabel(meal)}» не нашлось блюд под ваши ограничения по времени и технике — смягчили их.` });
      } else {
        warnings.push({ tone: "bad", text: `Для «${mealLabel(meal)}» нет ни одного подходящего блюда — этот приём пищи пропущен.` });
      }
    }
  }

  const ctx = { used: {}, lastUsed: {}, kindUse: {}, day: 0, recipeIndex, caps: {} };
  // мягкие потолки по типам основного белка: мясо ~35% основных блюд, рыба ~20%
  const mainSlots = 14;
  ctx.caps = {
    meat: Math.max(2, Math.round(mainSlots * 0.35)),
    fish: Math.max(1, Math.round(mainSlots * 0.2)),
    dairy: Math.max(2, Math.round(mainSlots * 0.2)),
    veg: mainSlots,
    grain: mainSlots,
    other: mainSlots,
  };
  const days = [];

  const kindOf = (recipe) => mainKind(recipe, productIndex);

  for (let d = 0; d < 7; d++) {
    ctx.day = d;
    const noMeat = vegDays.includes(d);
    const items = [];

    // кандидаты именно для этого дня: в дни без мяса мясо не попадает
    // даже через последующую балансировку
    const dayPool = {};
    for (const meal of slots) {
      const pool = candidatesByMeal[meal].filter(
        (r) => fitsRecipe(r, settings, productIndex, { forbidden, noMeat })
      );
      dayPool[meal] = pool.length ? pool : candidatesByMeal[meal];
    }

    for (const meal of slots) {
      const key = `${d}:${meal}`;
      const usable = dayPool[meal];
      if (!usable.length) continue;

      let chosen = null;
      const pinned = pins[key];
      if (pinned && recipeIndex[pinned]) {
        chosen = usable.find((r) => r.id === pinned) || null;
        if (!chosen) {
          warnings.push({ tone: "info", text: `Блюдо «${recipeIndex[pinned].name}» не подходит под текущие ограничения — заменили.` });
        }
      }

      if (!chosen) {
        // базовый выбор: сначала то, что ещё не использовалось и не превышает
        // потолок по типу основного белка, затем — цена
        const sorted = [...usable].sort((a, b) => {
          const ka = kindOf(a), kb = kindOf(b);
          const overA = (ctx.kindUse[ka] || 0) >= (ctx.caps[ka] || 99) ? 1 : 0;
          const overB = (ctx.kindUse[kb] || 0) >= (ctx.caps[kb] || 99) ? 1 : 0;
          if (overA !== overB) return overA - overB;
          const ua = ctx.used[a.id] || 0, ub = ctx.used[b.id] || 0;
          if (ua !== ub) return ua - ub;
          if (costs[a.id] !== costs[b.id]) return costs[a.id] - costs[b.id];
          return rnd() - 0.5;
        });
        const minUsed = Math.min(...sorted.map((r) => ctx.used[r.id] || 0));
        const fresh = sorted.filter((r) => (ctx.used[r.id] || 0) === minUsed);
        chosen = fresh[Math.floor(rnd() * fresh.length)];
      }

      items.push({ meal, recipeId: chosen.id, cost: costs[chosen.id], pinned: !!pins[key] });
      registerUse(ctx, chosen, d, productIndex, meal === "lunch" || meal === "dinner");
    }

    balanceDay(items, dayPool, costs, ctx, dayBudgetPerPortion, settings, productIndex, d,
      recipeIndex, shares, shareSum);
    days.push({ index: d, items });
  }

  // --- недельный баланс ------------------------------------------------------
  let total = days.reduce((s, day) => s + day.items.reduce((x, it) => x + it.cost, 0), 0);
  total = total * portions;

  if (total > budget && budget > 0) {
    const before = total;
    let guard = 0;
    while (total > budget && guard++ < 60) {
      let changed = false;
      for (const day of days) {
        for (const it of day.items) {
          const familyCost = it.cost * portions;
          if (familyCost < total - budget) continue;
          const cheaper = candidatesByMeal[it.meal]
            .filter((r) => r.id !== it.recipeId && (ctx.used[r.id] || 0) === 0)
            .sort((a, b) => costs[a.id] - costs[b.id])[0];
          if (!cheaper) continue;
          const diff = (costs[cheaper.id] - it.cost) * portions;
          if (diff >= 0) continue;
          it.recipeId = cheaper.id;
          it.cost = costs[cheaper.id];
          total += diff;
          changed = true;
          if (total <= budget) break;
        }
        if (total <= budget) break;
      }
      if (!changed) break;
    }
    if (total > budget) {
      warnings.push({ tone: "bad", text: `Минимальный рацион стоит ${Math.round(total)} ₽ — это на ${Math.round(total - budget)} ₽ больше бюджета. Уменьшите бюджет или смягчите ограничения.` });
    } else {
      warnings.push({ tone: "info", text: `Итог подогнан под бюджет: ${Math.round(before)} ₽ → ${Math.round(total)} ₽.` });
    }
  }

  // --- показатели ------------------------------------------------------------
  const perDay = total / 7;
  const perPersonPerDay = portions > 0 ? perDay / portions : perDay;
  const kcalPerDay = days.reduce(
    (s, day) => s + day.items.reduce((x, it) => x + (recipeIndex[it.recipeId]?.kcal || 0), 0), 0
  ) / 7;

  const stats = {
    total: Math.round(total),
    perDay: Math.round(perDay),
    perPerson: Math.round(perPersonPerDay),
    perWeekPerPerson: Math.round(portions > 0 ? total / portions : total),
    perMeal: Math.round(total / Math.max(1, slots.length * 7)),
    portions: Math.round(portions * 100) / 100,
    budget: Math.round(budget),
    left: Math.round(budget - total),
    ratio: budget > 0 ? total / budget : 0,
    kcalPerDay: Math.round(kcalPerDay),
    dishes: days.reduce((s, d) => s + d.items.length, 0),
    vegDays,
  };

  const shopping = buildShoppingList(catalog, days, recipeIndex, productIndex, storeId, overrides, portions);

  return { storeId, days, stats, shopping, warnings, slots, days_: days };
}

/** Балансировка одного дня: вниз по цене и вверх по разнообразию. */
function balanceDay(items, candidatesByMeal, costs, ctx, dayBudget, settings, productIndex, dayIndex,
                    recipeIndex, shares, shareSum) {
  const dayTotal = () => items.reduce((s, it) => s + it.cost, 0);
  // на что ориентируемся по слоту: завтрак дешевле обеда и ужина
  const targetFor = (meal) => (dayBudget * (shares[meal] || 0)) / shareSum;

  // 1) убрать перерасход: меняем самое дорогое блюдо на самое дешёвое из доступных
  //    (закреплённые пользователем блюда не трогаем)
  let guard = 0;
  while (dayTotal() > dayBudget && guard++ < 40) {
    let worst = null;
    for (const it of items) {
      if (it.pinned) continue;
      if (!worst || it.cost > worst.cost) worst = it;
    }
    if (!worst) break;
    const alts = candidatesByMeal[worst.meal]
      .filter((r) => r.id !== worst.recipeId)
      .sort((a, b) => costs[a.id] - costs[b.id]);
    const cheapest = alts[0];
    if (!cheapest || costs[cheapest.id] >= worst.cost) break;
    const oldId = worst.recipeId;
    worst.recipeId = cheapest.id;
    worst.cost = costs[cheapest.id];
    swapUsage(ctx, oldId, cheapest.id, productIndex,
      isMainSlot(worst.meal), isMainSlot(worst.meal));
  }

  // 2) потратить остаток бюджета: двигаем блюда к их «слотовой» цене.
  //    Деньги тратятся не сами по себе — блюдо должно стать и разнообразнее,
  //    и ближе к своей доле бюджета.
  let slack = dayBudget - dayTotal();
  let rounds = 0;
  while (slack > 0 && rounds++ < 40) {
    let best = null;
    for (const it of items) {
      if (it.pinned) continue;
      const target = targetFor(it.meal);
      const main = isMainSlot(it.meal);
      const curValue = dishValue(it.recipeId, ctx, settings, productIndex, dayIndex, {
        cost: it.cost, target, count: ctx.used[it.recipeId] || 0, main,
      });
      const alts = candidatesByMeal[it.meal]
        .filter((r) => r.id !== it.recipeId)
        .map((r) => ({
          r,
          cost: costs[r.id],
          v: dishValue(r.id, ctx, settings, productIndex, dayIndex, {
            cost: costs[r.id], target, count: (ctx.used[r.id] || 0) + 1, main,
          }),
        }))
        .filter((x) => x.cost - it.cost <= slack)
        .filter((x) => x.cost <= target * 1.4 + 20)
        .filter((x) => x.v > curValue + 1)
        .sort((a, b) => b.v - a.v);
      if (!alts.length) continue;
      const pick = alts[0];
      const gain = pick.v - curValue;
      if (!best || gain > best.gain) best = { it, pick, gain, delta: pick.cost - it.cost };
    }
    if (!best) break;
    if (best.delta > slack) break;
    const oldId = best.it.recipeId;
    best.it.recipeId = best.pick.r.id;
    best.it.cost = best.pick.cost;
    swapUsage(ctx, oldId, best.pick.r.id, productIndex,
      isMainSlot(best.it.meal), isMainSlot(best.it.meal));
    slack -= best.delta;
  }
}

/** Основные приёмы пищи — для них следим за балансом белка. */
function isMainSlot(meal) {
  return meal === "lunch" || meal === "dinner";
}

/** Перенос счётчиков повторов при замене блюда. */
function swapUsage(ctx, oldId, newId, productIndex, oldMain, newMain) {
  if (oldId === newId) return;
  ctx.used[oldId] = Math.max(0, (ctx.used[oldId] || 1) - 1);
  ctx.used[newId] = (ctx.used[newId] || 0) + 1;
  if (oldMain) {
    const oldRecipe = ctx.recipeIndex[oldId];
    if (oldRecipe) {
      const kind = mainKind(oldRecipe, productIndex);
      ctx.kindUse[kind] = Math.max(0, (ctx.kindUse[kind] || 0) - 1);
    }
  }
  if (newMain) {
    const newRecipe = ctx.recipeIndex[newId];
    if (newRecipe) {
      const kind = mainKind(newRecipe, productIndex);
      ctx.kindUse[kind] = (ctx.kindUse[kind] || 0) + 1;
    }
  }
}

/**
 * Ценность блюда в плане. Больше — лучше.
 *  • расстояние до «доли» своего приёма пищи (в рублях) — балансируем бюджет;
 *  • повторные появления блюда — штрафуем (первое появление бесплатно);
 *  • предпочтения пользователя — плюс;
 *  • однообразие основного белка — штрафуем для обеда и ужина.
 */
function dishValue(recipeId, ctx, settings, productIndex, dayIndex, opts) {
  const recipe = ctx.recipeIndex[recipeId];
  const count = opts.count !== undefined ? opts.count : (ctx.used[recipeId] || 0);
  let v = -Math.abs(opts.cost - opts.target);
  v -= Math.max(0, count - 1) * 40;
  const last = ctx.lastUsed[recipeId];
  if (last !== undefined) v -= Math.max(0, (dayIndex - last - 1)) * 3;
  if (recipe) {
    if (opts.main) {
      const kind = mainKind(recipe, productIndex);
      const kindCount = ctx.kindUse[kind] || 0;
      const cap = (ctx.caps && ctx.caps[kind]) || 3;
      if (kindCount >= cap) v -= 70;
      else if (kindCount === cap - 1) v -= 25;
    }
    for (const t of settings.likes || []) {
      if (recipe.tags.includes(t)) v += 45;
    }
  }
  return v;
}

function registerUse(ctx, recipe, day, productIndex, isMain) {
  ctx.used[recipe.id] = (ctx.used[recipe.id] || 0) + 1;
  ctx.lastUsed[recipe.id] = day;
  if (!isMain) return;   // баланс белка следим только за обедом и ужином
  const kind = mainKind(recipe, productIndex);
  ctx.kindUse[kind] = (ctx.kindUse[kind] || 0) + 1;
}

/** Список покупок: агрегация, округление до покупных объёмов, цены магазина. */
export function buildShoppingList(catalog, days, recipeIndex, productIndex, storeId, overrides, portions) {
  const agg = new Map();
  for (const day of days) {
    for (const it of day.items) {
      const recipe = recipeIndex[it.recipeId];
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        const p = productIndex[ing.p];
        if (!p) continue;
        const key = p.id;
        const entry = agg.get(key) || { product: p, qty: 0, from: new Set() };
        entry.qty += ing.q * portions;
        entry.from.add(recipe.name);
        agg.set(key, entry);
      }
    }
  }

  const catOrder = {};
  catalog.categories.forEach((c, i) => { catOrder[c.id] = c.order ?? i; });
  const groups = new Map();

  let total = 0;
  for (const entry of agg.values()) {
    const p = entry.product;
    const price = priceOf(p, storeId, overrides);
    let qty, unit, lineTotal, packs = null;
    if (p.unit === "kg") {
      qty = Math.ceil((entry.qty / 1000) * 20) / 20;   // шаг 50 г
      unit = "kg";
      lineTotal = price * qty;
      if (p.pack) packs = Math.ceil(qty / p.pack);
    } else if (p.unit === "l") {
      qty = Math.ceil((entry.qty / 1000) * 20) / 20;   // шаг 50 мл
      unit = "l";
      lineTotal = price * qty;
      if (p.pack) packs = Math.ceil(qty / p.pack);
    } else {
      qty = Math.ceil(entry.qty - 1e-9);
      unit = "pcs";
      lineTotal = price * qty;
      if (p.pack) packs = Math.ceil(qty / p.pack);
    }
    const rounded = Math.round(lineTotal);
    total += rounded;
    const g = groups.get(p.cat) || { cat: p.cat, name: catName(catalog, p.cat), items: [], sum: 0 };
    g.items.push({
      productId: p.id, name: p.name, qty, unit, price: rounded,
      unitPrice: price, packs, count: entry.from.size,
    });
    g.sum += rounded;
    groups.set(p.cat, g);
  }

  const list = [...groups.values()].sort(
    (a, b) => (catOrder[a.cat] ?? 99) - (catOrder[b.cat] ?? 99)
  );
  for (const g of list) {
    g.items.sort((a, b) => b.price - a.price);
    g.sum = Math.round(g.sum);
  }

  return { groups: list, total: Math.round(total) };
}

function catName(catalog, id) {
  const c = catalog.categories.find((x) => x.id === id);
  return c ? c.name : id;
}

function mealLabel(meal) {
  return { breakfast: "завтрак", lunch: "обед", dinner: "ужин", snack: "перекус" }[meal] || meal;
}
