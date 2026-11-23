/**
 * ui.js — отрисовка экранов и нижних листов.
 */

import { state } from "./store.js";
import { rub, num, qty, plural } from "./model.js";

export const MEAL_NAMES = { breakfast: "Завтрак", lunch: "Обед", dinner: "Ужин", snack: "Перекус" };
const DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function dayName(i) {
  const d = (new Date().getDay() + i) % 7;
  return DOW[d];
}

export function dayLabel(i) {
  return i === 0 ? "Сегодня" : dayName(i);
}

/* ------------------------------ изображения ------------------------------ */

export function foodImg(id) {
  return `assets/food/${id}.jpg`;
}

export function thumbImg(id) {
  return `assets/food/t/${id}.jpg`;
}

/** Фото блюда: большое для карточек и рецепта, маленькое — для рациона. */
export function foodImgTag(id, cls = "dish__photo", lazy = true) {
  // в рационе — маленькая квадратная миниатюра, в карточках — полная
  const src = cls === "meal__photo" ? thumbImg(id) : foodImg(id);
  return `<span class="${cls}"><img src="${src}" alt="" ${lazy ? 'loading="lazy" decoding="async"' : ""} onerror="this.remove()"></span>`;
}

/** Цветовая метка магазина — одинаковая во всём приложении. */
export function storeColor(id) {
  const colors = {
    magnit: "#f43f5e", magnit_de: "#e11d48", lenta: "#0ea5e9", dixy: "#f59e0b",
    svetofor: "#22c55e", chizhik: "#16a34a", perekrestok: "#7c3aed", vkusvill: "#10b981",
    pyaterochka: "#eab308", azbuka: "#8b5cf6", auchan: "#6366f1", ok: "#ec4899",
  };
  return colors[id] || "#4f46e5";
}

export function storeLetter(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

/** Фото-заголовок группы покупок. */
const GROUP_PHOTO = {
  "Овощи": "cat_vegetables",
  "Фрукты и ягоды": "cat_fruit",
  "Мясо и птица": "cat_meat_fish",
  "Рыба и морепродукты": "cat_meat_fish",
  "Молочное и яйца": "cat_dairy",
  "Крупы, макароны, мука": "cat_grocery",
  "Хлеб и выпечка": "cat_bakery",
  "Бакалея, соусы, специи": "cat_grocery",
  "Сладости и напитки": "cat_sweets",
};

export function groupPhoto(name) {
  return GROUP_PHOTO[name] || "cat_grocery";
}

/* ------------------------------ экраны ------------------------------ */

export function renderPlan() {
  const plan = state.plan;
  if (!plan) return `<div class="empty"><h3>Рацион не собран</h3></div>`;
  const { stats } = plan;
  const day = plan.days[Math.min(state.day, plan.days.length - 1)];

  const over = stats.total > stats.budget;
  const fill = Math.min(100, stats.ratio * 100);
  const fillClass = over ? "is-bad" : (stats.ratio > 0.9 ? "is-warn" : "");

  const warnHtml = plan.warnings.length ? `
    <div class="card card--flat" style="border-color:${warnTone(plan.warnings[0].tone)};background:${warnBg(plan.warnings[0].tone)}">
      <div class="card__title" style="color:${warnTone(plan.warnings[0].tone)};font-size:13.5px">Нюансы подбора</div>
      ${plan.warnings.map((w) => `<p class="hint" style="margin-top:6px;color:${warnTone(w.tone || "warn")}">${esc(w.text)}</p>`).join("")}
    </div>` : "";

  const daysHtml = plan.days.map((d, i) => `
    <button class="day-chip ${i === state.day ? "is-on" : ""}" data-action="pick-day" data-day="${i}">
      <b>${i === 0 ? "сегодня" : dayName(i)}</b>
      <span class="num">${rub(d.items.reduce((s, it) => s + it.cost, 0) * stats.portions)}</span>
    </button>`).join("");

  const mealsHtml = day.items.map((it) => {
    const r = state.catalog.recipes.find((x) => x.id === it.recipeId);
    if (!r) return "";
    const familyCost = it.cost * stats.portions;
    const perPerson = stats.portions ? familyCost / stats.portions : familyCost;
    const tags = r.tags.map((t) => `<span class="tag">${esc(tagLabel(t))}</span>`).join("");
    return `
      <article class="meal">
        <div class="meal__slot" data-m="${it.meal}"></div>
        ${foodImgTag(r.id, "meal__photo")}
        <div class="meal__body">
          <div class="meal__slotname">${MEAL_NAMES[it.meal]}</div>
          <h3 class="meal__name">${esc(r.name)}</h3>
          <div class="meal__meta">
            <span><b class="num">${r.kcal}</b> ккал</span>
            <span><b class="num">${r.time}</b> мин</span>
            <span>${r.ingredients.length} ${plural(r.ingredients.length, "продукт", "продукта", "продуктов")}</span>
          </div>
          <div class="dish__meta" style="margin-top:7px">${tags}</div>
          <div class="meal__actions">
            <button class="btn btn--sm" data-action="recipe" data-id="${r.id}">Рецепт</button>
            <button class="btn btn--sm" data-action="swap" data-day="${day.index}" data-meal="${it.meal}" data-id="${r.id}">Заменить</button>
          </div>
        </div>
        <div class="meal__cost">
          <b class="num">${rub(familyCost)}</b>
          <span class="num">${rub(perPerson)} / чел.</span>
        </div>
      </article>`;
  }).join("");

  const storeName = state.catalog.stores.find((s) => s.id === plan.storeId)?.name || "";
  const heroHtml = `
    <div class="hero">
      <img class="hero__img" src="assets/food/hero_week.jpg" alt="" decoding="async" onerror="this.remove()">
      <div class="hero__veil"></div>
      <div class="hero__body">
        <div class="hero__kicker">${esc(storeName)} · рацион на неделю</div>
        <div class="hero__value num">${rub(stats.total)}</div>
        <div class="hero__label">${num(stats.kcalPerDay, 0)} ккал в день на человека · ${stats.dishes} ${plural(stats.dishes, "блюдо", "блюда", "блюд")}</div>
        <div class="hero__stats">
          <span class="hero__stat"><b class="num">${rub(stats.perDay)}</b> в день на семью</span>
          <span class="hero__stat"><b class="num">${rub(stats.perPerson)}</b> в день на человека</span>
          ${stats.left >= 0
            ? `<span class="hero__stat">в пределах бюджета на <b class="num">${rub(Math.abs(stats.left))}</b></span>`
            : `<span class="hero__stat">превышение на <b class="num">${rub(Math.abs(stats.left))}</b></span>`}
        </div>
      </div>
    </div>`;

  return `
    ${heroHtml}

    <section class="card card--accent">
      <div class="budget">
        <div class="budget__bar">
          <span>Потрачено ${rub(stats.total)} из ${rub(stats.budget)}</span>
          <b class="num" style="color:${over ? "var(--danger)" : "var(--ok)"}">
            ${stats.left >= 0 ? "−" : "+"}${rub(Math.abs(stats.left))}
          </b>
        </div>
        <div class="bar"><i class="bar__fill ${fillClass}" style="width:${fill.toFixed(1)}%"></i></div>
        <p class="hint" style="margin-top:8px">${over
          ? "Рацион дороже бюджета — честно показываем это, а не прячем."
          : "Уложились в бюджет: лишних денег в рационе нет."}</p>
      </div>
    </section>

    <div class="plain-note" style="margin-top:12px">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7.5 3.5v5c0 4.4-3.1 8.3-7.5 9.5-4.4-1.2-7.5-5.1-7.5-9.5v-5L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Это полная стоимость продуктов по ценам магазина. Без подписки, доплат и «разблокировок» — считаем честно сразу.</span>
    </div>

    <div class="price-strip">
      <span class="price-strip__dot ${state.liveStatus?.count ? "is-live" : ""}"></span>
      <span class="price-strip__text">${state.liveStatus?.count
        ? `Цены с сайтов магазинов · обновлено ${esc(timeAgo(state.liveStatus.ts))}`
        : `Справочные цены каталога · ${esc(state.catalog.version)}`}</span>
      <button class="price-strip__btn" data-action="reload-prices" data-tab-jump="settings">Обновить</button>
    </div>

    ${warnHtml}

    <div class="section">
      <div class="section__head"><h2 class="section__title">Неделя</h2>
        <button class="section__link" data-action="regenerate">Пересобрать</button></div>
      <div class="days">${daysHtml}</div>
      <div class="section__head" style="margin-top:2px">
        <h2 class="section__title">${esc(dayLabel(day.index))}, ${esc(dayName(day.index))}</h2>
        <span class="tiny">${num(stats.kcalPerDay, 0)} ккал в день на человека</span>
      </div>
      ${mealsHtml}
    </div>

    <div class="section" style="display:flex;gap:10px">
      <button class="btn btn--primary" style="flex:1" data-action="go-list">Список покупок</button>
      <button class="btn" data-action="edit-settings">Настроить</button>
    </div>`;
}

export function renderList() {
  const plan = state.plan;
  if (!plan) return `<div class="empty"><h3>Сначала соберём рацион</h3></div>`;
  const list = plan.shopping;
  const checked = state.checked;
  const totalItems = list.groups.reduce((s, g) => s + g.items.length, 0);
  const doneItems = list.groups.reduce((s, g) => s + g.items.filter((i) => checked[i.productId]).length, 0);
  const paid = list.groups.reduce(
    (s, g) => s + g.items.filter((i) => checked[i.productId]).reduce((x, i) => x + i.price, 0), 0);
  const left = list.total - paid;

  const groupsHtml = list.groups.map((g) => `
    <div class="group">
      <div class="group__head">
        <span class="group__photo">
          <img src="assets/food/${groupPhoto(g.name)}.jpg" alt="" loading="lazy" decoding="async" onerror="this.remove()">
        </span>
        <span class="group__name">${esc(g.name)}</span>
        <span class="num">${rub(g.sum)}</span>
      </div>
      ${g.items.map((i) => `
        <div class="item ${checked[i.productId] ? "is-done" : ""}" data-action="check" data-pid="${i.productId}">
          <button class="item__check" aria-label="Отметить">
            <svg viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="item__body">
            <div class="item__name">${esc(i.name)}</div>
            <div class="item__qty">${qtyLabel(i)}${i.packs ? ` · ${i.packs} ${plural(i.packs, "упаковка", "упаковки", "упаковок")}` : ""}</div>
          </div>
          <div class="item__price num">${rub(i.price)}<br><small class="num">${rub(i.unitPrice)}/${i.unit === "pcs" ? "шт" : i.unit}</small></div>
        </div>`).join("")}
    </div>`).join("");

  return `
    <section class="card">
      <div class="card__head">
        <div>
          <div class="card__title">Корзина на неделю</div>
          <div class="card__sub">${state.catalog.stores.find((s) => s.id === plan.storeId).name} · ${totalItems} ${plural(totalItems, "позиция", "позиции", "позиций")}</div>
        </div>
        <button class="btn btn--sm" data-action="export-list">Скопировать</button>
      </div>
      <div class="metrics">
        <div class="metric"><b class="num">${rub(list.total)}</b><span>вся корзина</span></div>
        <div class="metric"><b class="num">${rub(paid)}</b><span>куплено</span></div>
        <div class="metric"><b class="num" style="color:${left > 0 ? "var(--ok)" : "var(--ink)"}">${rub(left)}</b><span>осталось</span></div>
      </div>
      <p class="hint" style="margin-top:10px">
        ${doneItems} из ${totalItems} ${plural(totalItems, "позиции", "позиций", "позиций")} отмечено.
        Сумма корзины может отличаться от стоимости рациона: в списке объёмы округлены до целых упаковок и штук.
      </p>
    </section>

    <div class="section">${groupsHtml}</div>

    <div class="sticky-total">
      <div>
        <div class="tiny">Купить на неделю</div>
        <b class="num">${rub(list.total)}</b>
      </div>
      <button class="btn btn--sm" data-action="export-csv">Скачать CSV</button>
    </div>`;
}

export function renderDishes() {
  const q = (state.dishQuery || "").trim().toLowerCase();
  const meal = state.dishMeal || "all";
  const storeId = state.settings.store;
  const recipes = state.catalog.recipes.filter((r) => {
    if (meal !== "all" && !r.meals.includes(meal)) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q);
  });

  const cards = recipes.map((r) => {
    const cost = state.plan && state.plan.storeId === storeId
      ? (state.plan.costs?.[r.id] ?? null)
      : null;
    const price = cost ?? (state.catalog.recipesCost?.[r.id] ?? 0);
    return `
      <button class="dish" data-action="recipe" data-id="${r.id}">
        <span class="dish__photo">
          <img src="${foodImg(r.id)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">
          ${price ? `<span class="dish__badge num">${rub(price)}</span>` : ""}
          <span class="dish__kcalbadge num">${r.kcal} ккал</span>
        </span>
        <span class="dish__text">
          <span class="dish__name">${esc(r.name)}</span>
          <span class="dish__meta">
            <span class="tag">${esc(r.meals.map((m) => MEAL_NAMES[m]).join(" · "))}</span>
            <span class="tag">${r.time} мин</span>
          </span>
        </span>
      </button>`;
  }).join("");

  return `
    <section class="card card--flat" style="background:transparent;border:none;box-shadow:none;padding:0">
      <input type="search" id="dishSearch" class="text-input" placeholder="Поиск блюда…" value="${esc(state.dishQuery || "")}"
        style="width:100%;height:46px;padding:0 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface)">
      <div class="chips" style="margin-top:10px">
        ${["all", "breakfast", "lunch", "dinner", "snack"].map((m) => `
          <button class="chip ${meal === m ? "is-on" : ""}" data-action="dish-meal" data-meal="${m}">
            ${m === "all" ? "Все" : MEAL_NAMES[m]}
          </button>`).join("")}
      </div>
    </section>

    <div class="section">
      <div class="section__head"><h2 class="section__title">${recipes.length} ${plural(recipes.length, "блюдо", "блюда", "блюд")}</h2></div>
      ${recipes.length ? `<div class="grid-2">${cards}</div>` : `
        <div class="empty"><h3>Ничего не нашлось</h3><p>Попробуй другой запрос.</p></div>`}
    </div>`;
}

export function renderSettings() {
  const s = state.settings;
  const store = state.catalog.stores.find((x) => x.id === s.store);
  const perPerson = s.adults + s.kids * 0.8;

  const storeGrid = state.catalog.stores.map((st) => `
    <button class="store-card ${st.id === s.store ? "is-on" : ""}" data-action="pick-store" data-store="${st.id}">
      <span class="store-card__logo" style="background:${storeColor(st.id)}">${esc(storeLetter(st.name))}</span>
      <span class="store-card__body">
        <b>${esc(st.name)}</b>
        <span class="store-card__text">${st.mult < 1 ? `дешевле на ${Math.round((1 - st.mult) * 100)}%` : st.mult > 1.1 ? `дороже на ${Math.round((st.mult - 1) * 100)}%` : "средние цены"}</span>
      </span>
    </button>`).join("");

  const allergenChips = [
    ["gluten", "Глютен"], ["lactose", "Лактоза"], ["eggs", "Яйца"], ["nuts", "Орехи"],
    ["fish", "Рыба"], ["meat", "Мясо"], ["pork", "Свинина"], ["soy", "Соя"],
    ["mushroom", "Грибы"], ["seafood", "Морепродукты"],
  ].map(([id, name]) => `
    <button class="chip ${s.allergens.includes(id) ? "is-on" : ""}" data-action="toggle-allergen" data-allergen="${id}">${name}</button>`).join("");

  const likeChips = [
    ["fast", "Быстрые"], ["vegetarian", "Без мяса"], ["vegan", "Веганские"],
    ["no-cook", "Без готовки"], ["fish", "Рыба"], ["lowfat", "Лёгкие"],
  ].map(([id, name]) => `
    <button class="chip ${s.likes.includes(id) ? "is-on" : ""}" data-action="toggle-like" data-like="${id}">${name}</button>`).join("");

  const equipChips = ["плита", "сковорода", "духовка", "микроволновка", "блендер", "мультиварка"].map((e) => `
    <button class="chip ${s.equipment.includes(e) ? "is-on" : ""}" data-action="toggle-equip" data-equip="${e}">${esc(e)}</button>`).join("");

  const dislikes = (s.dislikes || []).map((id) => {
    const p = state.catalog.products.find((x) => x.id === id);
    if (!p) return "";
    return `<button class="chip is-on" data-action="toggle-dislike" data-pid="${id}">${esc(p.name)} <span class="chip__x">×</span></button>`;
  }).join("");

  return `
    <section class="card">
      <div class="card__head">
        <div class="card__title">Магазин</div>
        <span class="tiny">цены пересчитаются сразу</span>
      </div>
      <div class="store-grid">${storeGrid}</div>
      <p class="hint" style="margin-top:10px">Сейчас считаем по ценам «${esc(store.name)}»${store.note ? ` — ${esc(store.note.toLowerCase())}` : ""}.</p>
    </section>

    <section class="card">
      <div class="card__head">
        <div class="card__title">Бюджет на неделю</div>
        <span class="num" style="font-weight:700">${rub(s.budget)}</span>
      </div>
      <input type="range" id="budgetRange" min="1500" max="30000" step="250" value="${s.budget}">
      <div class="metrics">
        <div class="metric"><b class="num">${rub(Math.round(s.budget / 7))}</b><span>в день на семью</span></div>
        <div class="metric"><b class="num">${rub(Math.round(s.budget / 7 / Math.max(0.1, perPerson)))}</b><span>в день на человека</span></div>
        <div class="metric"><b class="num">${num(perPerson, 1)}</b><span>${plural(perPerson, "человек", "человека", "человек")}</span></div>
      </div>
    </section>

    <section class="card">
      <div class="card__title">Семья</div>
      <div class="field" style="margin-top:12px">
        <span class="field__label">Взрослых</span>
        <div class="stepper">
          <button data-action="family" data-key="adults" data-delta="-1">−</button>
          <b class="num">${s.adults}</b>
          <button data-action="family" data-key="adults" data-delta="1">+</button>
        </div>
      </div>
      <div class="field">
        <span class="field__label">Детей</span>
        <div class="stepper">
          <button data-action="family" data-key="kids" data-delta="-1">−</button>
          <b class="num">${s.kids}</b>
          <button data-action="family" data-key="kids" data-delta="1">+</button>
        </div>
      </div>
      ${s.kids ? `
      <div class="field">
        <span class="field__label">Возраст детей: <b class="num">${s.kidAge}</b> лет</span>
        <input type="range" id="kidAgeRange" min="1" max="16" step="1" value="${s.kidAge}">
        <p class="field__help">Порция ребёнка: ${num(s.kidAge <= 2 ? 0.4 : s.kidAge <= 6 ? 0.6 : s.kidAge <= 12 ? 0.8 : 1, 2)} от взрослой.</p>
      </div>` : ""}
      <div class="field">
        <span class="field__label">Приёмов пищи в день</span>
        <div class="chips">
          <button class="chip ${s.meals === 3 ? "is-on" : ""}" data-action="meals" data-meals="3">3 (завтрак, обед, ужин)</button>
          <button class="chip ${s.meals === 4 ? "is-on" : ""}" data-action="meals" data-meals="4">4 (с перекусом)</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card__title">Что нельзя</div>
      <p class="hint" style="margin:6px 0 10px">Аллергены убирают блюда полностью. Нелюбимое — по твоему выбору.</p>
      <div class="chips">${allergenChips}</div>
      <div style="margin-top:14px">
        <span class="field__label">Нелюбимые продукты</span>
        <div class="chips" style="margin-top:8px">
          ${dislikes}
          <button class="chip" data-action="open-dislikes">+ выбрать</button>
        </div>
      </div>
      <div class="field" style="margin-top:16px;margin-bottom:0">
        <span class="field__label">Дней без мяса и рыбы в неделю: <b class="num">${s.meatlessDays}</b></span>
        <input type="range" id="meatlessRange" min="0" max="7" step="1" value="${s.meatlessDays}">
      </div>
    </section>

    <section class="card">
      <div class="card__title">Что любим</div>
      <div class="chips" style="margin-top:10px">${likeChips}</div>
      <div class="field" style="margin:16px 0 0">
        <span class="field__label">Максимум времени на блюдо: <b class="num">${s.maxTime}</b> мин</span>
        <input type="range" id="timeRange" min="10" max="90" step="5" value="${s.maxTime}">
      </div>
      <div class="field" style="margin-bottom:0">
        <span class="field__label">Что есть на кухне</span>
        <div class="chips" style="margin-top:8px">${equipChips}</div>
      </div>
    </section>

    <section class="card">
      <div class="card__title">Цены</div>
      <p class="hint" style="margin:6px 0 10px">
        ${livePriceHint()}
      </p>
      <div class="field">
        <span class="field__label">Источник цен (JSON)</span>
        <input type="text" id="pricesUrl" value="${esc(state.settings.pricesUrl || "")}"
          placeholder="https://.../prices-live.json" spellcheck="false"
          style="width:100%;height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);font-size:13px">
        <p class="field__help">Файл собирает tools/collector.py с сайтов магазинов. Можно свой URL или путь рядом с приложением.</p>
      </div>
      <div class="chips" style="margin-bottom:12px">
        <button class="chip ${state.settings.pricesAuto ? "is-on" : ""}" data-action="toggle-auto-prices">Обновлять автоматически</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--sm btn--primary" data-action="reload-prices">Обновить цены сейчас</button>
        <button class="btn btn--sm" data-action="open-prices">Ввести свои цены</button>
        <button class="btn btn--sm" data-action="export-catalog">Выгрузить шаблон</button>
        ${Object.keys(state.overrides).length ? `<button class="btn btn--sm btn--danger" data-action="reset-prices">Сбросить свои</button>` : ""}
      </div>
      ${Object.keys(state.overrides).length ? `<p class="hint" style="margin-top:10px">Ручные цены применены к ${Object.keys(state.overrides).length} ${plural(Object.keys(state.overrides).length, "товару", "товарам", "товарам")} — они важнее живых.</p>` : ""}
    </section>

    <section class="card">
      <div class="card__title">О приложении</div>
      <p class="hint" style="margin-top:8px">
        «Тарелка» собирает рацион из обычных продуктов по ценам выбранного магазина.
        Здесь нет подписки, рекламы и скрытых платежей: всё, что ты видишь в рационе, — это цена продуктов.
      </p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn--sm" data-action="reset-all">Сбросить всё</button>
        <button class="btn btn--sm" data-action="regenerate">Пересобрать рацион</button>
      </div>
    </section>`;
}

/* ------------------------- нижние листы ------------------------- */

export function openSheet(title, html) {
  const root = document.getElementById("sheetRoot");
  document.getElementById("sheetTitle").textContent = title;
  document.getElementById("sheetBody").innerHTML = html;
  root.hidden = false;
  document.body.style.overflow = "hidden";
}

export function closeSheet() {
  document.getElementById("sheetRoot").hidden = true;
  document.body.style.overflow = "";
}

export function toast(msg, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------- утилиты ------------------------- */

export function tagLabel(t) {
  return {
    vegetarian: "без мяса", vegan: "веганское", fast: "быстро", "no-cook": "без готовки",
    lowfat: "лёгкое", fish: "с рыбой",
  }[t] || t;
}

export function warnTone(tone) {
  return { info: "var(--accent)", warn: "var(--warn)", bad: "var(--danger)" }[tone] || "var(--warn)";
}

export function warnBg(tone) {
  return { info: "var(--accent-soft)", warn: "var(--warn-soft)", bad: "var(--danger-soft)" }[tone] || "var(--warn-soft)";
}

/** Статус живых цен: что сейчас показываем и как давно обновляли. */
export function livePriceHint() {
  const st = state.liveStatus || { state: "idle" };
  const stores = Object.keys(state.live?.stores || {});
  if (st.state === "error") {
    return `Живые цены не загрузились (${st.error}). Показываем справочные цены каталога на ${esc(state.catalog.version)}.`;
  }
  if (!st.count) {
    return `Сейчас справочные цены каталога на ${esc(state.catalog.version)}. Подключи источник живых цен — и цены будут с сайтов магазинов.`;
  }
  const when = timeAgo(st.ts);
  const lines = stores.map((sid) => {
    const s = state.live.stores[sid];
    const store = state.catalog.stores.find((x) => x.id === sid);
    const n = Object.keys(s.items || {}).length;
    return `${esc(store ? store.name : sid)} — ${n} позиций`;
  }).join(", ");
  return `Живые цены с сайтов магазинов: ${lines}. Обновлено ${when}.`;
}

export function timeAgo(ts) {
  if (!ts) return "никогда";
  const diff = Math.max(0, Date.now() - ts * 1000);
  const min = Math.round(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} ${plural(min, "минуту", "минуты", "минут")} назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${plural(h, "час", "часа", "часов")} назад`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, "день", "дня", "дней")} назад`;
}

function qtyLabel(i) {
  if (i.unit === "kg") return `${num(i.qty, 2)} кг`;
  if (i.unit === "l") return `${num(i.qty, 2)} л`;
  return `${i.qty} шт`;
}
