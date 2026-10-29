import './styles/catalog.css';
import { CATEGORIES, getCategory } from './data/catalog.js';
import { icon } from './icons.js';
import { formatPrice, convertFromGbp, convertToGbp, parseMoneyInput, pluralRu } from './format.js';
import { CURRENCIES } from './currency.js';
import { getSpec } from './products.js';
import { createProductImage } from './assets.js';

const SLOT_IDS = ['cpu', 'motherboard', 'gpu', 'ram', 'ssd', 'hdd', 'psu', 'case', 'cooler'];
const DESKTOP_FILTERS = '(min-width: 1200px)';

// Для каждого контейнера храним ссылки на элементы, чтобы не пересоздавать каркас
const views = new WeakMap();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// Пенсы -> текст для поля ввода в выбранной валюте: 12000 -> '120', 12050 -> '120.50'
function minorToInput(valueGbp, money) {
  if (valueGbp === null || valueGbp === undefined) return '';
  const { minor, currency } = convertFromGbp(valueGbp, money);
  // рубли без копеек
  if (CURRENCIES[currency] && CURRENCIES[currency].digits === 0) return String(Math.round(minor / 100));
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

// В какой валюте реально показываем цены (без курса — в фунтах)
function shownCurrency(money) {
  return convertFromGbp(0, money).currency;
}

function moneyKey(money) {
  const currency = shownCurrency(money);
  const rate = money && money.rates ? money.rates[currency] : 1;
  return `${currency}:${rate}`;
}

function countActiveFilters(catalog) {
  let count = (catalog.brands || []).length;
  for (const values of Object.values(catalog.specs || {})) count += values.length;
  if (catalog.priceMin !== null && catalog.priceMin !== undefined) count += 1;
  if (catalog.priceMax !== null && catalog.priceMax !== undefined) count += 1;
  return count;
}

function getCardSpecs(product) {
  const category = getCategory(product.category);
  const keys = category ? category.cardSpecs : [];
  const values = [];
  for (const key of keys) {
    const value = getSpec(product, key);
    if (!value) continue;
    // голое число («6») без подписи непонятно, поэтому добавляем название
    if (/^\d+$/.test(value)) {
      const spec = (product.specs || []).find((item) => item.key === key);
      values.push(`${spec && spec.label ? spec.label : key}: ${value}`);
    } else {
      values.push(value);
    }
  }
  return values.slice(0, 2);
}

function buildFrame(container) {
  const root = el('div', 'page catalog');
  root.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Каталог</h1>
    </div>
    <div class="catalog-replace" hidden>
      <p class="catalog-replace-text"></p>
      <button type="button" class="btn btn-secondary btn-sm" data-action="cancel-replace">Отмена</button>
    </div>
    <form class="catalog-search" role="search" novalidate>
      <label class="visually-hidden" for="catalog-query">Поиск по названию или модели</label>
      <div class="catalog-search-field">
        ${icon('search')}
        <input class="input catalog-search-input" id="catalog-query" name="query" type="search"
               placeholder="Название или модель" autocomplete="off" enterkeyhint="search">
      </div>
      <button type="submit" class="btn btn-primary catalog-search-btn">
        ${icon('search')}<span class="catalog-search-btn-text">Найти</span>
      </button>
    </form>
    <div class="catalog-cats" role="group" aria-label="Категория"></div>
    <div class="field catalog-cat-select">
      <label class="visually-hidden" for="catalog-category">Категория</label>
      <select class="select" id="catalog-category" name="category"></select>
    </div>
    <div class="catalog-body">
      <div class="catalog-toolbar">
        <p class="catalog-count" aria-live="polite"></p>
        <button type="button" class="btn btn-secondary btn-sm catalog-filters-btn" data-action="open-filters" aria-haspopup="dialog">
          ${icon('filter')}<span class="catalog-filters-btn-text">Фильтры</span>
        </button>
        <div class="catalog-sort">
          <label class="visually-hidden" for="catalog-sort">Сортировка</label>
          <select class="select" id="catalog-sort" name="sort">
            <option value="relevance">По популярности</option>
            <option value="price-asc">Сначала дешевле</option>
            <option value="price-desc">Сначала дороже</option>
          </select>
        </div>
      </div>
      <aside class="panel catalog-sidebar" aria-labelledby="catalog-sidebar-title">
        <h2 class="catalog-sidebar-title" id="catalog-sidebar-title">Фильтры</h2>
        <form class="catalog-filter-form" data-filters="sidebar" novalidate>
          <div class="catalog-filter-fields"></div>
          <p class="field-error catalog-price-error" hidden></p>
          <button type="button" class="link catalog-sidebar-reset" data-action="reset-filters" hidden>Сбросить фильтры</button>
        </form>
      </aside>
      <div class="catalog-results">
        <p class="catalog-loading-line" hidden>Загрузка…</p>
        <div class="catalog-state-slot"></div>
        <ul class="catalog-grid" aria-label="Модели"></ul>
        <p class="catalog-attribution">
          <a href="https://vantaspec.com" target="_blank" rel="noopener noreferrer">Данные: VantaSpec</a>
        </p>
      </div>
    </div>
    <section class="catalog-buildbar" aria-label="Текущая сборка">
      <div class="catalog-buildbar-info">
        <p class="catalog-buildbar-total"></p>
        <p class="catalog-buildbar-sub"></p>
      </div>
      <button type="button" class="btn btn-light catalog-buildbar-btn" data-action="go-build">К сборке</button>
    </section>
    <dialog class="filters-dialog" aria-labelledby="filters-dialog-title">
      <form class="filters-dialog-inner" data-filters="dialog" method="dialog" novalidate>
        <header class="filters-dialog-head">
          <h2 class="filters-dialog-title" id="filters-dialog-title">Фильтры</h2>
          <button type="button" class="btn-icon" data-action="close-filters" aria-label="Закрыть фильтры">${icon('close')}</button>
        </header>
        <div class="filters-dialog-body">
          <div class="panel filters-dialog-panel">
            <div class="catalog-filter-fields"></div>
          </div>
          <p class="field-error catalog-price-error" hidden></p>
          <p class="filters-dialog-note"></p>
          <button type="button" class="link" data-action="reset-draft">Сбросить фильтры</button>
        </div>
        <footer class="filters-dialog-foot">
          <button type="button" class="btn btn-primary" data-action="apply-filters">Показать результаты</button>
        </footer>
      </form>
    </dialog>
  `;

  // кнопки и select категорий — один раз
  const cats = root.querySelector('.catalog-cats');
  const select = root.querySelector('#catalog-category');
  for (const category of CATEGORIES) {
    const button = el('button', 'catalog-cat', category.title);
    button.type = 'button';
    button.dataset.action = 'category';
    button.dataset.category = category.id;
    button.setAttribute('aria-pressed', 'false');
    cats.append(button);
    const option = el('option', '', category.title);
    option.value = category.id;
    select.append(option);
  }

  container.replaceChildren(root);

  const view = {
    root,
    callbacks: {},
    state: null,
    lastQuery: null,
    fieldsKey: '',
    gridKey: '',
    stateKey: '',
    searchInput: root.querySelector('#catalog-query'),
    categorySelect: select,
    sortSelect: root.querySelector('#catalog-sort'),
    catButtons: [...cats.children],
    replaceBox: root.querySelector('.catalog-replace'),
    replaceText: root.querySelector('.catalog-replace-text'),
    count: root.querySelector('.catalog-count'),
    filtersBtnText: root.querySelector('.catalog-filters-btn-text'),
    filtersBtn: root.querySelector('.catalog-filters-btn'),
    sidebarForm: root.querySelector('[data-filters="sidebar"]'),
    sidebarReset: root.querySelector('.catalog-sidebar-reset'),
    loadingLine: root.querySelector('.catalog-loading-line'),
    stateSlot: root.querySelector('.catalog-state-slot'),
    grid: root.querySelector('.catalog-grid'),
    buildTotal: root.querySelector('.catalog-buildbar-total'),
    buildSub: root.querySelector('.catalog-buildbar-sub'),
    dialog: root.querySelector('.filters-dialog'),
    dialogForm: root.querySelector('[data-filters="dialog"]'),
    dialogNote: root.querySelector('.filters-dialog-note'),
  };

  bindEvents(view);
  return view;
}

// ---------- события (навешиваются один раз) ----------

function bindEvents(view) {
  const { root } = view;
  const cb = (name, ...args) => {
    const fn = view.callbacks[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  };

  root.querySelector('.catalog-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = view.searchInput.value.trim();
    view.lastQuery = query;
    cb('onSearch', query);
  });

  view.categorySelect.addEventListener('change', () => cb('onCategory', view.categorySelect.value));
  view.sortSelect.addEventListener('change', () => cb('onSort', view.sortSelect.value));

  // на desktop фильтры в боковой панели применяются сразу
  view.sidebarForm.addEventListener('change', (event) => {
    if (event.target.matches('[data-price]')) return;
    applyFromForm(view, view.sidebarForm, cb);
  });
  view.sidebarForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applyFromForm(view, view.sidebarForm, cb);
  });
  // цену применяем по Enter или при уходе из поля
  view.sidebarForm.addEventListener('focusout', (event) => {
    if (event.target.matches('[data-price]')) applyFromForm(view, view.sidebarForm, cb, true);
  });

  // в форме нет кнопки submit, поэтому Enter в поле цены обрабатываем сами
  view.sidebarForm.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-price]')) {
      event.preventDefault();
      applyFromForm(view, view.sidebarForm, cb, true);
    }
  });
  view.dialogForm.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-price]')) {
      event.preventDefault();
      applyDialog(view, cb);
    }
  });

  view.dialogForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applyDialog(view, cb);
  });

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;
    const card = target.closest('.product-card');
    const product = card ? findItem(view, card.dataset.id) : null;

    if (action === 'category') cb('onCategory', target.dataset.category);
    else if (action === 'cancel-replace') cb('onCancelReplace');
    else if (action === 'go-build') cb('onGoToBuild');
    else if (action === 'retry') cb('onRetry');
    else if (action === 'reset-filters') cb('onResetFilters');
    else if (action === 'open-filters') openFiltersDialog(view);
    else if (action === 'close-filters') view.dialog.close();
    else if (action === 'reset-draft') resetDraft(view);
    else if (action === 'apply-filters') applyDialog(view, cb);
    else if (action === 'details' && product) {
      // фото не фокусируется, поэтому возвращать фокус будем на название
      const trigger = target.matches('button') ? target : card.querySelector('.product-card-name');
      cb('onOpenDetails', product, trigger);
    } else if (action === 'add' && product) {
      if (target.getAttribute('aria-disabled') === 'true') return;
      cb('onAdd', product);
    }
  });

  // если окно расширили до desktop — диалог фильтров не нужен
  const media = window.matchMedia(DESKTOP_FILTERS);
  media.addEventListener('change', () => {
    if (media.matches && view.dialog.open) view.dialog.close();
  });
}

function findItem(view, id) {
  const items = (view.state && view.state.catalog.items) || [];
  return items.find((item) => item.id === id) || null;
}

// ---------- фильтры ----------

function renderFilterFields(form, options, prefix, money) {
  const box = form.querySelector('.catalog-filter-fields');
  box.replaceChildren();

  const brands = (options && options.brands) || [];
  if (brands.length) {
    box.append(makeCheckboxGroup('Производитель', 'brand', '', brands, prefix));
  }

  const specs = (options && options.specs) || {};
  const specKeys = Object.keys(specs).filter((key) => specs[key].values && specs[key].values.length);
  for (const key of specKeys.slice(0, 2)) {
    box.append(makeCheckboxGroup(specs[key].label || key, 'spec', key, specs[key].values, prefix));
  }

  const price = el('fieldset', 'filter-group filter-price');
  const symbol = CURRENCIES[shownCurrency(money)].symbol;
  price.append(el('legend', 'filter-legend', `Цена, ${symbol}`));
  const row = el('div', 'filter-price-row');
  for (const [name, text] of [['min', 'Цена от'], ['max', 'Цена до']]) {
    const field = el('div', 'field');
    const id = `${prefix}-price-${name}`;
    const label = el('label', 'field-label', text);
    label.htmlFor = id;
    const input = el('input', 'input');
    input.id = id;
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.dataset.price = name;
    field.append(label, input);
    row.append(field);
  }
  price.append(row);
  box.append(price);
}

function makeCheckboxGroup(title, kind, key, values, prefix) {
  const group = el('fieldset', 'filter-group');
  group.append(el('legend', 'filter-legend', title));
  values.forEach((value, index) => {
    const label = el('label', 'checkbox');
    const input = el('input');
    input.type = 'checkbox';
    input.value = value;
    input.dataset.kind = kind;
    if (key) input.dataset.key = key;
    input.id = `${prefix}-${kind}-${key ? key.replace(/\W+/g, '') + '-' : ''}${index}`;
    label.append(input, el('span', '', value));
    group.append(label);
  });
  return group;
}

// Проставить значения в уже отрисованные поля
function fillFilterFields(form, values, skipFocused, money) {
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    if (input.dataset.kind === 'brand') {
      input.checked = (values.brands || []).includes(input.value);
    } else {
      const list = (values.specs || {})[input.dataset.key] || [];
      input.checked = list.includes(input.value);
    }
  }
  for (const input of form.querySelectorAll('[data-price]')) {
    if (skipFocused && input === document.activeElement) continue;
    input.value = minorToInput(input.dataset.price === 'min' ? values.priceMin : values.priceMax, money);
    // запоминаем показанный текст: если его не меняли, берём точную цену в фунтах,
    // чтобы округление при пересчёте не меняло фильтр
    input.dataset.shown = input.value;
    input.removeAttribute('aria-invalid');
  }
  showPriceError(form, '');
}

function showPriceError(form, message) {
  const box = form.querySelector('.catalog-price-error');
  box.textContent = message;
  box.hidden = !message;
  const errorId = form.dataset.filters + '-price-error';
  box.id = errorId;
  for (const input of form.querySelectorAll('[data-price]')) {
    if (message) {
      input.setAttribute('aria-describedby', errorId);
    } else {
      input.removeAttribute('aria-describedby');
      input.removeAttribute('aria-invalid');
    }
  }
}

// Прочитать форму. null — если в цене ошибка (сообщение уже показано)
function readFilterForm(form, catalog, money) {
  const result = { brands: [], specs: {}, priceMin: null, priceMax: null };
  for (const input of form.querySelectorAll('input[type="checkbox"]:checked')) {
    if (input.dataset.kind === 'brand') result.brands.push(input.value);
    else {
      const key = input.dataset.key;
      if (!result.specs[key]) result.specs[key] = [];
      result.specs[key].push(input.value);
    }
  }

  let error = '';
  for (const input of form.querySelectorAll('[data-price]')) {
    const text = input.value.trim();
    const isMin = input.dataset.price === 'min';
    let value = null;
    if (text && catalog && text === (input.dataset.shown || '').trim()) {
      value = isMin ? catalog.priceMin ?? null : catalog.priceMax ?? null;
    } else if (text) {
      // ввод в выбранной валюте, в фильтр уходят пенсы
      const minor = parseMoneyInput(text);
      value = minor === null ? null : convertToGbp(minor, money);
    }
    if (text && value === null) {
      input.setAttribute('aria-invalid', 'true');
      error = 'Введите цену числом, например 150 или 149.99';
    } else {
      input.removeAttribute('aria-invalid');
    }
    if (isMin) result.priceMin = value;
    else result.priceMax = value;
  }
  if (!error && result.priceMin !== null && result.priceMax !== null && result.priceMin > result.priceMax) {
    error = '«Цена от» не может быть больше «Цена до»';
  }
  showPriceError(form, error);
  return error ? null : result;
}

function sameFilters(a, catalog) {
  return (
    JSON.stringify([a.brands, a.specs, a.priceMin, a.priceMax]) ===
    JSON.stringify([catalog.brands || [], catalog.specs || {}, catalog.priceMin ?? null, catalog.priceMax ?? null])
  );
}

function applyFromForm(view, form, cb, onlyIfChanged = false) {
  const values = readFilterForm(form, view.state && view.state.catalog, view.state && view.state.money);
  if (!values) return;
  if (onlyIfChanged && view.state && sameFilters(values, view.state.catalog)) return;
  cb('onApplyFilters', values);
}

function openFiltersDialog(view) {
  const catalog = view.state.catalog;
  const category = getCategory(catalog.category);
  // черновик: открываем с текущими применёнными значениями
  renderFilterFields(view.dialogForm, catalog.options, 'dlg', view.state.money);
  fillFilterFields(view.dialogForm, catalog, false, view.state.money);
  view.dialogNote.textContent = category ? `Выбрана категория: ${category.title.toLowerCase()}` : '';
  view.dialog.showModal();
}

function resetDraft(view) {
  fillFilterFields(view.dialogForm, { brands: [], specs: {}, priceMin: null, priceMax: null }, false, view.state.money);
}

function applyDialog(view, cb) {
  const values = readFilterForm(view.dialogForm, view.state.catalog, view.state.money);
  if (!values) {
    const invalid = view.dialogForm.querySelector('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    return;
  }
  view.dialog.close();
  cb('onApplyFilters', values);
}

function updateSidebar(view, catalog, money) {
  const options = catalog.options;
  // поля перерисовываем только при смене категории/набора значений/валюты
  const key = options
    ? JSON.stringify([catalog.category, options.brands, options.specs, shownCurrency(money)])
    : view.fieldsKey;
  if (key !== view.fieldsKey || !view.fieldsKey) {
    const focused = document.activeElement;
    const focusId = view.sidebarForm.contains(focused) ? focused.id : null;
    renderFilterFields(view.sidebarForm, options, 'side', money);
    view.fieldsKey = key || 'empty';
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) again.focus();
    }
  }
  fillFilterFields(view.sidebarForm, catalog, true, money);

  const active = countActiveFilters(catalog);
  view.sidebarReset.hidden = active === 0;
  view.filtersBtnText.textContent = active ? `Фильтры (${active})` : 'Фильтры';
}

// ---------- карточки ----------

function getCardLabel(product, callbacks) {
  const inBuild = typeof callbacks.isInBuild === 'function' && callbacks.isInBuild(product);
  if (inBuild) return { inBuild, label: 'В сборке' };
  const label = (typeof callbacks.getAddLabel === 'function' && callbacks.getAddLabel(product)) || 'В сборку';
  return { inBuild, label };
}

function renderCard(product, { inBuild, label }, money) {
  const item = el('li', 'product-card-item');
  const card = el('article', 'product-card');
  card.dataset.id = product.id;

  const photo = el('div', 'product-card-photo');
  photo.dataset.action = 'details';
  const { img, art } = createProductImage(product);
  photo.append(img);
  photo.classList.toggle('is-placeholder', art.isPlaceholder);
  if (art.isPlaceholder) {
    // alt уже говорит об отсутствии фото, подпись дублирует его для зрячих
    const note = el('span', 'product-card-nophoto', 'Фото отсутствует');
    note.setAttribute('aria-hidden', 'true');
    photo.append(note);
  }

  const body = el('div', 'product-card-body');
  const title = el('h3', 'product-card-title');
  const nameBtn = el('button', 'product-card-name', product.name);
  nameBtn.type = 'button';
  nameBtn.dataset.action = 'details';
  title.append(nameBtn);
  body.append(title);

  const specs = getCardSpecs(product);
  if (specs.length) body.append(el('p', 'product-card-specs', specs.join(' · ')));

  const price = el('p', 'product-card-price');
  if (product.priceMinor === null || product.priceMinor === undefined) {
    price.classList.add('is-unknown');
    price.textContent = 'Цена не указана';
  } else {
    if (product.priceKind === 'from') price.append(el('span', 'product-card-from', 'от '));
    price.append(document.createTextNode(formatPrice(product.priceMinor, money)));
  }
  body.append(price);

  const actions = el('div', 'product-card-actions');
  const more = el('button', 'link product-card-more', 'Подробнее');
  more.type = 'button';
  more.dataset.action = 'details';
  more.append(el('span', 'visually-hidden', `: ${product.name}`));

  const cta = el('button', 'btn btn-sm product-card-cta');
  cta.type = 'button';
  cta.dataset.action = 'add';
  if (inBuild) {
    cta.classList.add('is-in-build');
    cta.setAttribute('aria-disabled', 'true');
    cta.innerHTML = icon('check');
  } else {
    cta.classList.add('btn-primary');
    cta.innerHTML = icon(label.startsWith('Заменить') ? 'refresh' : 'plus');
  }
  cta.append(el('span', 'product-card-cta-text', label));
  cta.append(el('span', 'visually-hidden', `: ${product.name}`));
  actions.append(more, cta);
  body.append(actions);

  card.append(photo, body);
  item.append(card);
  return item;
}

function updateGrid(view, catalog, callbacks, money) {
  const items = catalog.items || [];
  const labels = items.map((product) => getCardLabel(product, callbacks));
  const key =
    moneyKey(money) + '\n' + items.map((product, i) => `${product.id}|${labels[i].label}|${product.priceMinor}`).join('\n');
  if (key === view.gridKey) return;
  view.gridKey = key;

  // после перерисовки возвращаем фокус на ту же кнопку той же карточки
  const focused = document.activeElement;
  let focusId = null;
  let focusAction = null;
  if (view.grid.contains(focused)) {
    const card = focused.closest('.product-card');
    focusId = card ? card.dataset.id : null;
    focusAction = focused.classList.contains('product-card-cta') ? 'cta' : focused.classList.contains('product-card-more') ? 'more' : 'name';
  }

  view.grid.replaceChildren(...items.map((product, i) => renderCard(product, labels[i], money)));

  if (focusId) {
    const card = [...view.grid.querySelectorAll('.product-card')].find((node) => node.dataset.id === focusId);
    const selector = focusAction === 'cta' ? '.product-card-cta' : focusAction === 'more' ? '.product-card-more' : '.product-card-name';
    if (card) card.querySelector(selector).focus();
  }
}

// ---------- состояния ----------

function makeState(kind, title, text, buttonLabel, action) {
  const box = el('div', `state state-${kind}`);
  if (kind === 'error') box.setAttribute('role', 'alert');
  box.append(el('p', 'state-title', title));
  if (text) box.append(el('p', 'state-text', text));
  if (buttonLabel) {
    const button = el('button', 'btn btn-secondary', buttonLabel);
    button.type = 'button';
    button.dataset.action = action;
    box.append(button);
  }
  return box;
}

function updateStatus(view, catalog) {
  const status = catalog.status;
  const hasItems = (catalog.items || []).length > 0;
  const loading = status === 'loading';
  let stateKey = status;
  let node = null;

  if (loading && !hasItems) {
    node = makeState('loading', 'Загрузка…', 'Загружаем комплектующие.');
  } else if (status === 'empty' || (status === 'success' && !hasItems)) {
    node = makeState('empty', 'Ничего не найдено', 'Измените запрос или сбросьте фильтры.', 'Сбросить фильтры', 'reset-filters');
    stateKey = 'empty';
  } else if (status === 'error') {
    const error = catalog.error || {};
    const isRate = error.kind === 'rate' || (error.retryAfter !== null && error.retryAfter !== undefined);
    const title = isRate ? 'Слишком много запросов. Попробуйте позже' : 'Не удалось загрузить каталог';
    let text = isRate ? '' : error.message || 'Попробуйте ещё раз.';
    if (isRate && error.retryAfter) text = `Повторить можно примерно через ${error.retryAfter} с.`;
    const canRetry = error.canRetry !== false;
    node = makeState('error', title, text, canRetry ? 'Повторить' : '', 'retry');
    stateKey = `error|${title}|${text}|${canRetry}`;
  } else if (loading) {
    stateKey = 'loading-stale';
  }

  if (stateKey !== view.stateKey) {
    view.stateKey = stateKey;
    view.stateSlot.replaceChildren(...(node ? [node] : []));
  }

  // при ошибке старые карточки не показываем, при загрузке — затемняем
  const showGrid = hasItems && status !== 'error' && status !== 'empty';
  view.grid.hidden = !showGrid;
  const stale = loading && hasItems;
  view.loadingLine.hidden = !stale;
  view.grid.classList.toggle('is-stale', stale);
  view.grid.inert = stale;
  view.root.querySelector('.catalog-results').setAttribute('aria-busy', loading ? 'true' : 'false');

  const total = catalog.total ?? (catalog.items || []).length;
  if (loading && !hasItems) view.count.textContent = 'Загрузка…';
  else if (status === 'error') view.count.textContent = '';
  else view.count.textContent = `${total} ${pluralRu(total, ['модель', 'модели', 'моделей'])}`;
}

// ---------- полоса сборки ----------

function updateBuildBar(view, build, money) {
  const slots = (build && build.slots) || {};
  let count = 0;
  let unknown = 0;
  let total = 0;
  for (const id of SLOT_IDS) {
    const part = slots[id];
    if (!part) continue;
    count += 1;
    if (Number.isFinite(part.priceMinor)) total += part.priceMinor;
    else unknown += 1;
  }

  if (count === 0) {
    view.buildTotal.textContent = 'В сборке пока нет деталей';
  } else {
    // если ни у одной детали нет цены, £0.00 не показываем
    const sum = unknown === count ? 'цена не указана' : formatPrice(total, money);
    view.buildTotal.textContent = `${count} ${pluralRu(count, ['деталь', 'детали', 'деталей'])} · ${sum}`;
  }

  const sub = [];
  if (unknown) sub.push(`из них ${unknown} без цены`);
  if (build && Number.isFinite(build.budgetMinor)) sub.push(`Бюджет ${formatPrice(build.budgetMinor, money)}`);
  view.buildSub.textContent = sub.join(' · ');
  view.buildSub.hidden = sub.length === 0;
}

// ---------- главная функция ----------

export function renderCatalog(container, state, callbacks = {}) {
  let view = views.get(container);
  if (!view || !container.contains(view.root)) {
    view = buildFrame(container);
    views.set(container, view);
  }
  view.state = state;
  view.callbacks = callbacks;

  const catalog = state.catalog;
  const category = getCategory(catalog.category);

  // поле поиска трогаем только если запрос поменялся снаружи
  if (catalog.query !== view.lastQuery) {
    view.lastQuery = catalog.query;
    if (view.searchInput.value.trim() !== catalog.query) view.searchInput.value = catalog.query || '';
  }

  for (const button of view.catButtons) {
    button.setAttribute('aria-pressed', button.dataset.category === catalog.category ? 'true' : 'false');
  }
  view.categorySelect.value = catalog.category;

  view.sortSelect.value = catalog.sort || 'relevance';
  view.sortSelect.options[0].textContent = catalog.query ? 'По релевантности' : 'По популярности';

  const target = catalog.targetSlot ? getCategory(catalog.targetSlot) : null;
  view.replaceBox.hidden = !target;
  if (target) {
    view.replaceText.replaceChildren(
      document.createTextNode('Выбери '),
      el('strong', '', target.accusative),
      document.createTextNode(' для замены')
    );
  }

  updateSidebar(view, catalog, state.money);
  updateStatus(view, catalog);
  updateGrid(view, catalog, callbacks, state.money);
  updateBuildBar(view, state.build, state.money);

  view.grid.setAttribute('aria-label', category ? category.title : 'Модели');
}
