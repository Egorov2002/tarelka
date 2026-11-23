/**
 * app.js — точка входа: загрузка каталога, маршрутизация, события, мастер настройки.
 */

import { state, load, save, notify, updateSettings, resetAll, DEFAULT_SETTINGS, refreshPrices } from "./store.js";
import { buildPlan } from "./planner.js";
import { rub, num, plural, portionCost, parsePrices, fitsRecipe } from "./model.js";
import {
  renderPlan, renderList, renderDishes, renderSettings,
  openSheet, closeSheet, toast, esc, MEAL_NAMES, dayName, warnTone,
  storeColor, storeLetter,
} from "./ui.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
const sheetRoot = document.getElementById("sheetRoot");

let wizardState = null;

/* ------------------------------ запуск ------------------------------ */

async function boot() {
  load();
  try {
    state.catalog = await loadCatalog();
  } catch (e) {
    view.innerHTML = `
      <div class="empty">
        <div class="empty__icon">⚠️</div>
        <h3>Каталог не загрузился</h3>
        <p>Открой приложение по http-адресу (например, через локальный сервер) — файл каталога читается по сети.</p>
        <button class="btn btn--primary" onclick="location.reload()">Повторить</button>
      </div>`;
    return;
  }
  state.catalog.recipesCost = {};
  rebuild();
  render();

  if (!state.settings.onboarded) openWizard();
  registerSW();
  startPriceWatcher();
}

/**
 * Живые цены: тянем при старте, потом раз в полчаса и при возврате к вкладке.
 * Если источник недоступен — приложение работает на справочном каталоге.
 */
async function startPriceWatcher() {
  if (!state.settings.pricesAuto || !state.settings.pricesUrl) return;
  await pullPrices(true);
  setInterval(() => pullPrices(false), 30 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.settings.pricesAuto) pullPrices(false);
  });
}

async function pullPrices(silent) {
  const res = await refreshPrices();
  if (res.ok) {
    rebuild();
    render();
    if (!silent) toast(`Цены обновлены: ${res.count} позиций`);
  } else if (!silent) {
    toast(`Не удалось обновить цены: ${res.error}`);
  }
  return res;
}

async function loadCatalog() {
  const res = await fetch("data/catalog.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("catalog " + res.status);
  return res.json();
}

function rebuild() {
  state.plan = buildPlan(state.catalog, state.settings, state.overrides, state.pins);
  // цены порций для карточек блюд
  const productIndex = {};
  state.catalog.products.forEach((p) => { productIndex[p.id] = p; });
  state.catalog.recipesCost = {};
  for (const r of state.catalog.recipes) {
    state.catalog.recipesCost[r.id] = portionCost(r, state.settings.store, productIndex, state.overrides);
  }
}

function render() {
  const tab = state.tab;
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tab);
  });
  const store = state.catalog.stores.find((s) => s.id === state.settings.store);
  document.getElementById("storePillName").textContent = store ? store.name : "";
  document.getElementById("storePillBudget").textContent = rub(state.settings.budget);

  if (tab === "plan") view.innerHTML = renderPlan();
  else if (tab === "list") view.innerHTML = renderList();
  else if (tab === "dishes") view.innerHTML = renderDishes();
  else view.innerHTML = renderSettings();

  const badge = document.getElementById("listBadge");
  const left = state.plan ? state.plan.shopping.total : 0;
  badge.hidden = false;
  badge.textContent = "₽";
  badge.style.display = "none";
  void left;
}

/* ------------------------------ события ------------------------------ */

tabbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  render();
  view.scrollTop = 0;
  window.scrollTo({ top: 0 });
});

sheetRoot.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeSheet();
});

document.getElementById("storePill").addEventListener("click", () => {
  state.tab = "settings";
  render();
});

view.addEventListener("click", onAction);
view.addEventListener("input", onInput);
view.addEventListener("change", onInput);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheetRoot.hidden) closeSheet();
});

function onAction(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const act = el.dataset.action;

  switch (act) {
    case "pick-day":
      state.day = Number(el.dataset.day);
      render();
      break;

    case "regenerate": {
      // ручные замены (pins) сохраняем — уважаем выбор пользователя,
      // перемешиваем только остальное меню
      state.settings.seed = Math.floor(Math.random() * 1e9);
      rebuild();
      render();
      toast("Рацион пересобран — твои замены сохранены");
      break;
    }

    case "recipe":
      openRecipe(el.dataset.id);
      break;

    case "swap":
      openSwap(Number(el.dataset.day), el.dataset.meal, el.dataset.id);
      break;

    case "go-list":
      state.tab = "list";
      render();
      window.scrollTo({ top: 0 });
      break;

    case "edit-settings":
      state.tab = "settings";
      render();
      window.scrollTo({ top: 0 });
      break;

    case "check": {
      const pid = el.dataset.pid;
      if (state.checked[pid]) delete state.checked[pid];
      else state.checked[pid] = true;
      save();
      render();
      break;
    }

    case "export-list":
      copyToClipboard(listAsText(), "Список покупок скопирован");
      break;

    case "export-csv":
      downloadCSV();
      break;

    case "dish-meal":
      state.dishMeal = el.dataset.meal;
      render();
      break;

    case "pick-store": {
      const prev = state.plan ? state.plan.stats.total : 0;
      updateSettings({ store: el.dataset.store });
      rebuild();
      render();
      const now = state.plan.stats.total;
      const delta = now - prev;
      toast(delta === 0
        ? `Магазин: ${state.catalog.stores.find((s) => s.id === state.settings.store).name}`
        : `Магазин сменён — рацион ${delta < 0 ? "дешевле" : "дороже"} на ${rub(Math.abs(delta))}`);
      break;
    }

    case "toggle-allergen": {
      const id = el.dataset.allergen;
      const list = state.settings.allergens.includes(id)
        ? state.settings.allergens.filter((x) => x !== id)
        : [...state.settings.allergens, id];
      updateSettings({ allergens: list });
      rebuild();
      render();
      break;
    }

    case "toggle-like": {
      const id = el.dataset.like;
      const list = state.settings.likes.includes(id)
        ? state.settings.likes.filter((x) => x !== id)
        : [...state.settings.likes, id];
      updateSettings({ likes: list });
      rebuild();
      render();
      break;
    }

    case "toggle-equip": {
      const id = el.dataset.equip;
      const list = state.settings.equipment.includes(id)
        ? state.settings.equipment.filter((x) => x !== id)
        : [...state.settings.equipment, id];
      updateSettings({ equipment: list });
      rebuild();
      render();
      break;
    }

    case "toggle-dislike": {
      const id = el.dataset.pid;
      const list = state.settings.dislikes.includes(id)
        ? state.settings.dislikes.filter((x) => x !== id)
        : [...state.settings.dislikes, id];
      updateSettings({ dislikes: list });
      rebuild();
      render();
      break;
    }

    case "open-dislikes":
      openDislikes();
      break;

    case "family": {
      const key = el.dataset.key;
      const delta = Number(el.dataset.delta);
      const next = Math.max(0, Math.min(8, (state.settings[key] || 0) + delta));
      updateSettings({ [key]: next });
      rebuild();
      render();
      break;
    }

    case "meals":
      updateSettings({ meals: Number(el.dataset.meals) });
      rebuild();
      render();
      break;

    case "reload-prices": {
      const urlEl = document.getElementById("pricesUrl");
      const url = urlEl ? urlEl.value.trim() : state.settings.pricesUrl;
      updateSettings({ pricesUrl: url });
      pullPrices(false);
      break;
    }

    case "toggle-auto-prices":
      updateSettings({ pricesAuto: !state.settings.pricesAuto });
      render();
      toast(state.settings.pricesAuto ? "Цены будут обновляться автоматически" : "Автообновление выключено");
      break;

    case "open-prices":
      openPriceImport();
      break;

    case "export-catalog":
      exportCatalogTemplate();
      break;

    case "reset-prices":
      state.overrides = {};
      rebuild();
      render();
      toast("Свои цены сброшены");
      break;

    case "reset-all":
      if (confirm("Сбросить все настройки, цены и отметки?")) {
        resetAll();
        rebuild();
        render();
        toast("Настройки сброшены");
      }
      break;
  }
}

function onInput(e) {
  const t = e.target;

  if (t.id === "budgetRange") {
    updateSettings({ budget: Number(t.value) });
    rebuild();
    document.getElementById("storePillBudget").textContent = rub(state.settings.budget);
    const plan = state.plan;
    if (plan) {
      const card = view.querySelector(".budget");
      if (card) {
        const over = plan.stats.total > plan.stats.budget;
        card.querySelector(".budget__value").textContent = rub(plan.stats.total);
        card.querySelector(".budget__label").textContent =
          `весь рацион на неделю, ${state.catalog.stores.find((s) => s.id === plan.storeId).name}`;
        const side = card.querySelector(".budget__side b");
        side.textContent = `${plan.stats.left >= 0 ? "−" : "+"}${rub(Math.abs(plan.stats.left))}`;
        side.style.color = over ? "var(--danger)" : "var(--ok)";
        const fill = card.querySelector(".bar__fill");
        fill.style.width = `${Math.min(100, plan.stats.ratio * 100).toFixed(1)}%`;
        fill.className = "bar__fill" + (over ? " is-bad" : (plan.stats.ratio > 0.9 ? " is-warn" : ""));
        const m = card.querySelectorAll(".metric b");
        if (m[0]) m[0].textContent = rub(plan.stats.perDay);
        if (m[1]) m[1].textContent = rub(plan.stats.perPerson);
      }
    }
    return;
  }

  if (t.id === "kidAgeRange") {
    updateSettings({ kidAge: Number(t.value) });
    rebuild();
    render();
    return;
  }

  if (t.id === "meatlessRange") {
    updateSettings({ meatlessDays: Number(t.value) });
    rebuild();
    render();
    return;
  }

  if (t.id === "timeRange") {
    updateSettings({ maxTime: Number(t.value) });
    rebuild();
    render();
    return;
  }

  if (t.id === "dishSearch") {
    state.dishQuery = t.value;
    const pos = t.selectionStart;
    render();
    const again = document.getElementById("dishSearch");
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    return;
  }

  if (t.id === "pricesUrl") {
    // сохраняем адрес источника, но не дёргаем сеть на каждый символ
    clearTimeout(window._pricesUrlT);
    window._pricesUrlT = setTimeout(() => {
      updateSettings({ pricesUrl: t.value.trim() });
    }, 600);
    return;
  }
}

/* ------------------------------ листы ------------------------------ */

function openRecipe(recipeId) {
  const r = state.catalog.recipes.find((x) => x.id === recipeId);
  if (!r) return;
  const store = state.catalog.stores.find((s) => s.id === state.settings.store);
  const productIndex = {};
  state.catalog.products.forEach((p) => { productIndex[p.id] = p; });
  const portions = state.plan ? state.plan.stats.portions : 1;

  const ingRows = r.ingredients.map((ing) => {
    const p = productIndex[ing.p];
    if (!p) return "";
    const price = state.overrides[store.id]?.[p.id] ?? state.overrides[p.id] ?? p.prices[store.id];
    const scale = p.unit === "pcs" ? portions : (ing.q * portions) / 1000;
    const line = price * scale;
    const amount = p.unit === "pcs" ? `${num(Math.ceil(ing.q * portions - 1e-9), 0)} шт`
      : `${num(ing.q * portions, 0)} ${p.unit === "kg" ? "г" : "мл"}`;
    return `<div class="ing-row"><span>${esc(p.name)}</span><b class="num">${amount} · ${rub(line)}</b></div>`;
  }).join("");

  const portion = portionCost(r, store.id, productIndex, state.overrides);
  const steps = r.steps.map((s) => `<li>${esc(s)}</li>`).join("");

  openSheet(r.name, `
    <div class="recipe-hero">
      <img src="assets/food/${r.id}.jpg" alt="${esc(r.name)}" decoding="async" onerror="this.remove()">
      <div class="recipe-hero__cap">${esc(store.name)} · ${rub(portion)} за порцию</div>
    </div>
    <div class="dish__meta" style="margin-bottom:10px">
      <span class="tag tag--acc">${r.meals.map((m) => MEAL_NAMES[m]).join(" · ")}</span>
      <span class="tag">${r.kcal} ккал</span>
      <span class="tag">${r.time} мин</span>
      ${r.equip.length ? `<span class="tag">${esc(r.equip.join(", "))}</span>` : ""}
    </div>
    <div class="metrics">
      <div class="metric"><b class="num">${rub(portion)}</b><span>за порцию</span></div>
      <div class="metric"><b class="num">${rub(portion * portions)}</b><span>на семью (${num(portions, 1)} порц.)</span></div>
      <div class="metric"><b class="num">${r.ingredients.length}</b><span>продуктов</span></div>
    </div>
    <h3 class="section__title" style="margin:18px 0 6px">Продукты · ${esc(store.name)}</h3>
    ${ingRows}
    <h3 class="section__title" style="margin:18px 0 6px">Как готовить</h3>
    <ol class="step-list">${steps}</ol>
    <button class="btn btn--primary btn--block" style="margin-top:18px" data-close="1">Понятно</button>
  `);
}

function openSwap(dayIndex, meal, currentId) {
  const plan = state.plan;
  const productIndex = {};
  state.catalog.products.forEach((p) => { productIndex[p.id] = p; });

  // замена не должна ломать ограничения пользователя (аллергены, нелюбимое, техника, время)
  const candidates = state.catalog.recipes
    .filter((r) => r.meals.includes(meal))
    .filter((r) => fitsRecipe(r, state.settings, productIndex, {}))
    .map((r) => ({ r, cost: state.catalog.recipesCost[r.id] ?? 0 }))
    .filter((x) => x.r.id !== currentId)
    .sort((a, b) => a.cost - b.cost);

  const cur = state.catalog.recipesCost[currentId] ?? 0;
  const portions = plan ? plan.stats.portions : 1;

  const rows = candidates.map((x) => {
    const diff = (x.cost - cur) * portions;
    const diffLabel = diff === 0 ? "так же"
      : diff < 0 ? `дешевле на ${rub(Math.abs(diff))}` : `дороже на ${rub(diff)}`;
    const cls = diff < 0 ? "tag--ok" : diff > 0 ? "tag--warn" : "";
    return `
      <button class="swap" data-action="do-swap" data-day="${dayIndex}" data-meal="${meal}" data-id="${x.r.id}">
        <div class="swap__body">
          <b>${esc(x.r.name)}</b>
          <span>${x.r.kcal} ккал · ${x.r.time} мин · <span class="tag ${cls}">${diffLabel}</span></span>
        </div>
        <div class="swap__cost num">${rub(x.cost * portions)}</div>
      </button>`;
  }).join("");

  openSheet(`Заменить: ${MEAL_NAMES[meal]}`, `
    <p class="hint" style="margin-bottom:12px">
      Показываем от дешёвых к дорогим. Цена — за всю семью на этот приём пищи.
      Ваши ограничения (аллергены, нелюбимое, техника, время) действуют и здесь.
    </p>
    ${rows ? `<div class="swaps">${rows}</div>` : `
      <div class="empty">
        <h3>Нет подходящих вариантов</h3>
        <p>Все блюда для этого приёма пищи не проходят по ограничениям. Ослабьте их в настройках.</p>
      </div>`}
  `);

  sheetRoot.querySelector(".sheet__body").addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="do-swap"]');
    if (!btn) return;
    const key = `${btn.dataset.day}:${btn.dataset.meal}`;
    state.pins[key] = btn.dataset.id;
    rebuild();
    closeSheet();
    render();
    toast("Блюдо заменено");
  });
}

function openDislikes() {
  const products = state.catalog.products.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const rows = products.map((p) => `
    <div class="item" data-action="toggle-dislike" data-pid="${p.id}">
      <button class="item__check" aria-label="Выбрать">
        <svg viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="item__body">
        <div class="item__name">${esc(p.name)}</div>
        <div class="item__qty">${esc(state.catalog.categories.find((c) => c.id === p.cat)?.name || "")}</div>
      </div>
    </div>`).join("");

  openSheet("Нелюбимые продукты", `
    <input type="search" id="dislikeSearch" placeholder="Поиск по названию…" style="width:100%;height:44px;padding:0 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface-2);margin-bottom:12px">
    <div id="dislikeList">${rows}</div>
    <button class="btn btn--primary btn--block" style="margin-top:16px" data-close="1">Готово</button>
  `);

  const search = document.getElementById("dislikeSearch");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const list = document.getElementById("dislikeList");
    list.innerHTML = products.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => `
      <div class="item ${state.settings.dislikes.includes(p.id) ? "is-done" : ""}" data-action="toggle-dislike" data-pid="${p.id}">
        <button class="item__check"><svg viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="item__body"><div class="item__name">${esc(p.name)}</div></div>
      </div>`).join("");
  });
  // подсветка выбранных
  sheetRoot.querySelectorAll('[data-action="toggle-dislike"]').forEach((row) => {
    row.classList.toggle("is-done", state.settings.dislikes.includes(row.dataset.pid));
  });
}

function openPriceImport() {
  const sample = `{
  "p_oats": 249,
  "p_chicken_breast": 690,
  "magnit": { "p_milk": 89 },
  "chizhik": { "p_milk": 84 }
}`;
  openSheet("Свои цены", `
    <p class="hint" style="margin-bottom:10px">
      Вставь JSON или CSV (<code>id,цена</code>). Ключ — <code>id</code> товара из каталога,
      можно указать цену сразу для всех магазинов или отдельным блоком по магазину.
    </p>
    <textarea class="textarea" id="priceInput" placeholder="${esc(sample)}"></textarea>
    <p class="tiny" style="margin-top:8px">Пример id: p_oats, p_milk, p_chicken_breast, p_potato.</p>
    <button class="btn btn--primary btn--block" style="margin-top:14px" data-action="apply-prices">Применить цены</button>
  `);

  sheetRoot.querySelector(".sheet__body").addEventListener("click", (e) => {
    if (!e.target.closest('[data-action="apply-prices"]')) return;
    const raw = document.getElementById("priceInput").value.trim();
    const result = parsePrices(raw, state.catalog);
    if (result.error) { toast(result.error); return; }
    state.overrides = { ...state.overrides, ...result.overrides };
    rebuild();
    closeSheet();
    render();
    toast(`Цены применены: ${result.count} ${plural(result.count, "товар", "товара", "товаров")}`);
  });
}

/** Разбор цен — в model.js (чистая функция, покрыта тестами). */

/* ------------------------------ мастер ------------------------------ */

function openWizard() {
  wizardState = {
    step: 0,
    draft: { ...state.settings },
  };
  const el = document.createElement("div");
  el.className = "wizard";
  el.id = "wizard";
  document.body.appendChild(el);
  renderWizard();
}

function closeWizard() {
  const el = document.getElementById("wizard");
  if (el) el.remove();
  wizardState = null;
}

function renderWizard() {
  const el = document.getElementById("wizard");
  const d = wizardState.draft;
  const step = wizardState.step;
  const steps = ["Магазин и бюджет", "Семья", "Ограничения", "Готово"];

  let body = "";
  if (step === 0) {
    const stores = state.catalog.stores.map((s) => `
      <button class="store-card ${s.id === d.store ? "is-on" : ""}" data-w="store" data-store="${s.id}">
        <span class="store-card__logo" style="background:${storeColor(s.id)}">${esc(storeLetter(s.name))}</span>
        <span class="store-card__body">
          <b>${esc(s.name)}</b>
          <span class="store-card__text">${s.mult < 1 ? `дешевле на ${Math.round((1 - s.mult) * 100)}%` : s.mult > 1.1 ? `дороже на ${Math.round((s.mult - 1) * 100)}%` : "средние цены"}</span>
        </span>
      </button>`).join("");
    body = `
      <div class="wizard__photo">
        <img src="assets/food/produce.jpg" alt="" decoding="async" onerror="this.remove()">
      </div>
      <h1 class="wizard__title">Где покупаем?</h1>
      <p class="wizard__lead">Цены в рационе считаются по этому магазину. Менять можно в любой момент.</p>
      <div class="field">
        <span class="field__label">Магазин</span>
        <div class="store-grid">${stores}</div>
      </div>
      <div class="field">
        <span class="field__label">Бюджет на неделю: <b class="num">${rub(d.budget)}</b></span>
        <input type="range" id="wBudget" min="1500" max="30000" step="250" value="${d.budget}">
        <p class="field__help">Это на всю семью. Подберём меню так, чтобы уложиться — и честно скажем, если не получится.</p>
      </div>`;
  } else if (step === 1) {
    body = `
      <h1 class="wizard__title">Сколько вас?</h1>
      <p class="wizard__lead">Порции считаем на всех: детям — меньше, взрослым — полные.</p>
      <div class="field">
        <span class="field__label">Взрослых</span>
        <div class="stepper">
          <button data-w="adults" data-delta="-1">−</button><b class="num">${d.adults}</b><button data-w="adults" data-delta="1">+</button>
        </div>
      </div>
      <div class="field">
        <span class="field__label">Детей</span>
        <div class="stepper">
          <button data-w="kids" data-delta="-1">−</button><b class="num">${d.kids}</b><button data-w="kids" data-delta="1">+</button>
        </div>
      </div>
      ${d.kids ? `
      <div class="field">
        <span class="field__label">Возраст детей: <b class="num">${d.kidAge}</b> лет</span>
        <input type="range" id="wKidAge" min="1" max="16" step="1" value="${d.kidAge}">
      </div>` : ""}
      <div class="field">
        <span class="field__label">Приёмов пищи в день</span>
        <div class="chips">
          <button class="chip ${d.meals === 3 ? "is-on" : ""}" data-w="meals" data-meals="3">3</button>
          <button class="chip ${d.meals === 4 ? "is-on" : ""}" data-w="meals" data-meals="4">4 (с перекусом)</button>
        </div>
      </div>`;
  } else if (step === 2) {
    const allergens = [["gluten", "Глютен"], ["lactose", "Лактоза"], ["eggs", "Яйца"], ["nuts", "Орехи"],
      ["fish", "Рыба"], ["meat", "Мясо"], ["pork", "Свинина"], ["soy", "Соя"], ["mushroom", "Грибы"]]
      .map(([id, name]) => `<button class="chip ${d.allergens.includes(id) ? "is-on" : ""}" data-w="allergen" data-allergen="${id}">${name}</button>`).join("");
    const equip = ["плита", "сковорода", "духовка", "микроволновка", "блендер"]
      .map((e) => `<button class="chip ${d.equipment.includes(e) ? "is-on" : ""}" data-w="equip" data-equip="${e}">${esc(e)}</button>`).join("");
    body = `
      <h1 class="wizard__title">Что нельзя?</h1>
      <p class="wizard__lead">Аллергены исключают полностью. Остальное можно донастроить позже.</p>
      <div class="field">
        <span class="field__label">Аллергены</span>
        <div class="chips">${allergens}</div>
      </div>
      <div class="field">
        <span class="field__label">Дней без мяса и рыбы: <b class="num">${d.meatlessDays}</b></span>
        <input type="range" id="wMeatless" min="0" max="7" step="1" value="${d.meatlessDays}">
      </div>
      <div class="field">
        <span class="field__label">Время на блюдо: до <b class="num">${d.maxTime}</b> мин</span>
        <input type="range" id="wTime" min="10" max="90" step="5" value="${d.maxTime}">
      </div>
      <div class="field">
        <span class="field__label">Что есть на кухне</span>
        <div class="chips">${equip}</div>
      </div>`;
  } else {
    const plan = buildPlan(state.catalog, d, state.overrides, {});
    const store = state.catalog.stores.find((s) => s.id === d.store);
    const perPerson = d.adults + d.kids * 0.8;
    body = `
      <h1 class="wizard__title">Всё готово</h1>
      <p class="wizard__lead">Проверь расчёт — и вперёд. Платёжей здесь нет: стоимость рациона = стоимость продуктов.</p>
      <div class="card">
        <div class="metrics">
          <div class="metric"><b class="num">${rub(plan.stats.total)}</b><span>рацион на неделю</span></div>
          <div class="metric"><b class="num">${rub(plan.stats.perPerson)}</b><span>в день на человека</span></div>
          <div class="metric"><b class="num">${plan.stats.dishes}</b><span>блюд</span></div>
        </div>
        <p class="hint" style="margin-top:12px">
          Магазин: <b>${esc(store.name)}</b> · бюджет ${rub(d.budget)} ·
          семья: ${d.adults} взр.${d.kids ? `, ${d.kids} дет.` : ""}.
        </p>
        ${plan.warnings.length ? `<p class="hint" style="margin-top:8px;color:${warnTone(plan.warnings[0].tone)}">${esc(plan.warnings[0].text)}</p>` : ""}
      </div>
      <div class="plain-note" style="margin-top:12px">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7.5 3.5v5c0 4.4-3.1 8.3-7.5 9.5-4.4-1.2-7.5-5.1-7.5-9.5v-5L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Стоимость посчитана целиком: продукты по ценам магазина, без подписки и доплат.</span>
      </div>`;
  }

  el.innerHTML = `
    <div class="wizard__bar"><i style="width:${((step + 1) / 4 * 100).toFixed(0)}%"></i></div>
    <div class="wizard__head">
      <span class="wizard__step">Шаг ${step + 1} из 4 · ${esc(steps[step])}</span>
      ${step > 0 ? `<button class="btn btn--sm btn--ghost" data-w="back">Назад</button>` : ""}
    </div>
    <div class="wizard__body">${body}</div>
    <div class="wizard__foot">
      ${step > 0 ? `<button class="btn" data-w="back">Назад</button>` : ""}
      <button class="btn btn--primary" data-w="next">${step === 3 ? "Собрать рацион" : "Дальше"}</button>
    </div>`;

  el.addEventListener("click", onWizardClick);
  el.addEventListener("input", onWizardInput);
}

function onWizardInput(e) {
  const d = wizardState.draft;
  if (e.target.id === "wBudget") {
    d.budget = Number(e.target.value);
    renderWizard();
  } else if (e.target.id === "wKidAge") {
    d.kidAge = Number(e.target.value);
    renderWizard();
  } else if (e.target.id === "wMeatless") {
    d.meatlessDays = Number(e.target.value);
    renderWizard();
  } else if (e.target.id === "wTime") {
    d.maxTime = Number(e.target.value);
    renderWizard();
  }
}

function onWizardClick(e) {
  const el = e.target.closest("[data-w]");
  if (!el || !wizardState) return;
  const d = wizardState.draft;
  const act = el.dataset.w;

  switch (act) {
    case "store": d.store = el.dataset.store; renderWizard(); break;
    case "adults": d.adults = Math.max(0, Math.min(8, d.adults + Number(el.dataset.delta))); renderWizard(); break;
    case "kids": d.kids = Math.max(0, Math.min(8, d.kids + Number(el.dataset.delta))); renderWizard(); break;
    case "meals": d.meals = Number(el.dataset.meals); renderWizard(); break;
    case "allergen": {
      const id = el.dataset.allergen;
      d.allergens = d.allergens.includes(id) ? d.allergens.filter((x) => x !== id) : [...d.allergens, id];
      renderWizard(); break;
    }
    case "equip": {
      const id = el.dataset.equip;
      d.equipment = d.equipment.includes(id) ? d.equipment.filter((x) => x !== id) : [...d.equipment, id];
      renderWizard(); break;
    }
    case "back":
      wizardState.step = Math.max(0, wizardState.step - 1);
      renderWizard();
      break;
    case "next":
      if (wizardState.step === 3) {
        updateSettings({ ...d, onboarded: true });
        rebuild();
        closeWizard();
        render();
        toast("Рацион собран — всё посчитано сразу");
      } else {
        wizardState.step++;
        renderWizard();
      }
      break;
  }
}

/* ------------------------------ экспорт ------------------------------ */

function listAsText() {
  const shop = state.plan.shopping;
  const lines = [`Список покупок — ${state.catalog.stores.find((s) => s.id === state.plan.storeId).name}`, ""];
  for (const g of shop.groups) {
    lines.push(g.name.toUpperCase());
    for (const i of g.items) {
      const amount = i.unit === "kg" ? `${num(i.qty, 2)} кг` : i.unit === "l" ? `${num(i.qty, 2)} л` : `${i.qty} шт`;
      lines.push(`- ${i.name} — ${amount} — ${rub(i.price)}`);
    }
    lines.push("");
  }
  lines.push(`ИТОГО: ${rub(shop.total)}`);
  return lines.join("\n");
}

async function copyToClipboard(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    openSheet("Список покупок", `<textarea class="textarea" style="min-height:280px">${esc(text)}</textarea>`);
    toast("Скопируйте текст вручную");
  }
}

function downloadCSV() {
  const shop = state.plan.shopping;
  const rows = [["Категория", "Товар", "Количество", "Ед.", "Сумма, ₽"]];
  for (const g of shop.groups) {
    for (const i of g.items) {
      rows.push([g.name, i.name, String(i.qty).replace(".", ","), i.unit, String(i.price)]);
    }
  }
  rows.push(["", "ИТОГО", "", "", String(shop.total)]);
  const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "spisok-pokupok.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("CSV сохранён");
}

function exportCatalogTemplate() {
  const template = {};
  for (const p of state.catalog.products) template[p.id] = p.prices[state.settings.store];
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ceny-kataloga.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Шаблон цен выгружен");
}

/* ------------------------------ service worker ------------------------------ */

function registerSW() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

window.addEventListener("scroll", () => {
  const bar = document.getElementById("appbar");
  if (bar) bar.classList.toggle("is-scrolled", window.scrollY > 4);
});

boot();
