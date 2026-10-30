import './styles/fonts.css';
import './styles/tokens.css';
import { getCategory } from './data/catalog.js';
import { ApiError, loadCategory, searchProducts, isAbortError } from './api/vantaspec.js';
import { toSnapshot, getFilterOptions } from './core/products.js';
import { getProductArtwork } from './components/artwork.js';
import { renderCatalog } from './features/catalog/view.js';
import { createDetailsDialog } from './features/details/dialog.js';
import { createEmptyBuild, renderBuild } from './features/build/view.js';
import { renderSaved } from './features/saved/view.js';
import { loadAppState, persistAppState } from './core/storage.js';
import { loadRates } from './api/currency.js';
import { createReview, addReview, removeReview, getRatingSummary, getRatingsMap } from './core/reviews.js';
import { downloadBuild, downloadAllBuilds } from './features/build/export.js';

const VIEWS = ['build', 'catalog', 'saved'];

// Всё состояние приложения хранится здесь, модули только рисуют его и вызывают callbacks
const stored = loadAppState();
const state = {
  view: getViewFromHash(),
  build: stored.build || createEmptyBuild('Сборка №1'),
  saved: stored.saved || [],
  currentSavedId: null,
  storageWarning: stored.warning,
  reviews: stored.reviews || {},
  money: {
    currency: stored.settings?.currency || 'GBP',
    rates: null,
    date: null,
    status: 'idle',
  },
  catalog: {
    category: 'cpu',
    query: '',
    brands: [],
    priceMin: null,
    priceMax: null,
    specs: {},
    sort: 'popular',
    status: 'idle',
    items: [],
    total: 0,
    error: null,
    targetSlot: null,
    options: null,
  },
};

const containers = {
  build: document.querySelector('#view-build'),
  catalog: document.querySelector('#view-catalog'),
  saved: document.querySelector('#view-saved'),
};

let catalogController = null;
let catalogRequestId = 0;
let catalogStarted = false;
let lastRemoved = null;

// ---------- вспомогательное ----------

function getViewFromHash() {
  const view = location.hash.replace('#', '');
  return VIEWS.includes(view) ? view : 'build';
}

function makeId() {
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function copyBuild(build) {
  return JSON.parse(JSON.stringify(build));
}

function buildContent(build) {
  return JSON.stringify({ name: build.name, budgetMinor: build.budgetMinor, slots: build.slots });
}

function hasParts(build) {
  return Object.values(build.slots).some(Boolean);
}

function getCurrentSaved() {
  return state.saved.find((item) => item.id === state.build.id) || null;
}

// Есть ли изменения, которых нет в сохранённых
function isDirty() {
  const saved = getCurrentSaved();
  if (!saved) return hasParts(state.build);
  return buildContent(saved) !== buildContent(state.build);
}

function nextBuildName() {
  const names = new Set(state.saved.map((item) => item.name));
  names.add(state.build.name);
  let number = state.saved.length + 1;
  while (names.has('Сборка №' + number)) number += 1;
  return 'Сборка №' + number;
}

function save() {
  const ok = persistAppState({
    build: state.build,
    saved: state.saved,
    reviews: state.reviews,
    settings: { currency: state.money.currency },
  });
  if (!ok && !state.storageWarning) {
    state.storageWarning = 'Хранилище браузера недоступно — сборки не сохранятся после закрытия вкладки';
  }
  return ok;
}

function touchBuild() {
  state.build.updatedAt = new Date().toISOString();
  save();
  render();
}

// ---------- статус внизу экрана ----------

const statusRegion = document.querySelector('#status');
let toastTimer = null;

function announce(text, options = {}) {
  clearTimeout(toastTimer);
  statusRegion.textContent = '';

  const toast = document.createElement('div');
  toast.className = 'toast';
  const message = document.createElement('p');
  message.className = 'toast-text';
  message.textContent = text;
  toast.append(message);

  if (options.actionLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = options.actionLabel;
    button.addEventListener('click', () => {
      statusRegion.textContent = '';
      options.onAction();
    });
    toast.append(button);
  }

  statusRegion.append(toast);
  toastTimer = setTimeout(() => {
    statusRegion.textContent = '';
  }, 7000);
}

// ---------- простое подтверждение ----------

const confirmDialog = document.createElement('dialog');
confirmDialog.className = 'confirm-dialog panel';
confirmDialog.innerHTML = `
  <form method="dialog">
    <h2 class="confirm-title"></h2>
    <p class="confirm-text"></p>
    <div class="confirm-actions">
      <button class="btn btn-secondary" value="cancel" autofocus>Отмена</button>
      <button class="btn btn-primary confirm-ok" value="ok"></button>
    </div>
  </form>`;
document.body.append(confirmDialog);

function askConfirm(title, text, okLabel) {
  confirmDialog.querySelector('.confirm-title').textContent = title;
  confirmDialog.querySelector('.confirm-text').textContent = text;
  confirmDialog.querySelector('.confirm-ok').textContent = okLabel;
  confirmDialog.returnValue = 'cancel';
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
  });
}

// ---------- сборка ----------

function isInBuild(product) {
  return state.build.slots[product.category]?.id === product.id;
}

function getAddLabel(product) {
  if (isInBuild(product)) return 'В сборке';
  if (state.build.slots[product.category]) return 'Заменить';
  return 'В сборку';
}

function getAction(product) {
  const category = getCategory(product.category);
  if (isInBuild(product)) return { label: 'В сборке', inBuild: true, disabled: true };
  if (state.build.slots[product.category]) {
    return { label: 'Заменить ' + category.accusative, inBuild: false, disabled: false };
  }
  return { label: 'В сборку', inBuild: false, disabled: false };
}

function addProduct(product) {
  if (isInBuild(product)) return;
  const category = getCategory(product.category);
  const replaced = Boolean(state.build.slots[product.category]);

  state.build.slots[product.category] = toSnapshot(product);
  if (state.catalog.targetSlot === product.category) state.catalog.targetSlot = null;
  touchBuild();

  const text = replaced
    ? 'Заменили ' + category.accusative + ': ' + product.name
    : 'Добавлено в сборку: ' + product.name;
  announce(text, { actionLabel: 'К сборке', onAction: goToBuild });
}

function removeSlot(slotId) {
  const snapshot = state.build.slots[slotId];
  if (!snapshot) return;
  lastRemoved = { buildId: state.build.id, slotId, snapshot };
  state.build.slots[slotId] = null;
  touchBuild();
  announce('Убрано из сборки: ' + snapshot.name, {
    actionLabel: 'Отменить',
    onAction: () => {
      if (!lastRemoved || lastRemoved.buildId !== state.build.id) return;
      if (state.build.slots[lastRemoved.slotId]) return;
      state.build.slots[lastRemoved.slotId] = lastRemoved.snapshot;
      lastRemoved = null;
      touchBuild();
    },
  });
}

function goToBuild() {
  location.hash = '#build';
}

function chooseForSlot(slotId, replace) {
  state.catalog.targetSlot = replace ? slotId : null;
  if (state.catalog.category !== slotId) {
    state.catalog.category = slotId;
    resetCatalogFilters();
    state.catalog.query = '';
  }
  location.hash = '#catalog';
  runCatalogQuery();
}

async function startNewBuild() {
  if (isDirty()) {
    const ok = await askConfirm('Создать новую сборку?', 'Текущие изменения не сохранены.', 'Создать');
    if (!ok) return;
  }
  state.build = createEmptyBuild(nextBuildName());
  touchBuild();
  goToBuild();
  announce('Создана новая сборка');
}

function saveCurrentBuild() {
  const copy = copyBuild(state.build);
  copy.savedAt = new Date().toISOString();
  const index = state.saved.findIndex((item) => item.id === copy.id);
  if (index >= 0) state.saved[index] = copy;
  else state.saved.unshift(copy);

  if (save()) {
    announce('Сборка сохранена');
  } else {
    announce('Не удалось сохранить сборку. Скачайте список, чтобы не потерять его', {
      actionLabel: 'Скачать',
      onAction: () => downloadBuild(state.build, state.money),
    });
  }
  render();
}

// ---------- сохранённые ----------

async function openSaved(id) {
  const saved = state.saved.find((item) => item.id === id);
  if (!saved) return;
  if (saved.id !== state.build.id && isDirty()) {
    const ok = await askConfirm('Открыть другую сборку?', 'Текущие изменения не сохранены.', 'Открыть');
    if (!ok) return;
  }
  state.build = copyBuild(saved);
  delete state.build.savedAt;
  touchBuild();
  goToBuild();
}

function renameSaved(id, name) {
  const saved = state.saved.find((item) => item.id === id);
  if (!saved) return;
  saved.name = name;
  if (state.build.id === id) state.build.name = name;
  save();
  render();
  announce('Сборка переименована');
}

function duplicateSaved(id) {
  const index = state.saved.findIndex((item) => item.id === id);
  if (index < 0) return;
  const copy = copyBuild(state.saved[index]);
  copy.id = makeId();
  copy.name = (copy.name + ' (копия)').slice(0, 80);
  copy.savedAt = new Date().toISOString();
  state.saved.splice(index + 1, 0, copy);
  save();
  render();
  announce('Создана копия: ' + copy.name);
}

function deleteSaved(id) {
  const index = state.saved.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = state.saved.splice(index, 1);
  save();
  render();
  announce('Сборка удалена', {
    actionLabel: 'Отменить',
    onAction: () => {
      if (state.saved.some((item) => item.id === removed.id)) return;
      state.saved.splice(Math.min(index, state.saved.length), 0, removed);
      save();
      render();
    },
  });
}

// ---------- отзывы ----------

function getRating(productId) {
  return getRatingSummary(state.reviews, productId);
}

function onAddReview(productId, data) {
  let review;
  try {
    review = createReview(data);
  } catch (error) {
    announce(error.message);
    return false;
  }
  state.reviews = addReview(state.reviews, productId, review);
  save();
  afterReviewsChange();
  announce('Отзыв добавлен');
  return true;
}

function onDeleteReview(productId, reviewId) {
  state.reviews = removeReview(state.reviews, productId, reviewId);
  save();
  afterReviewsChange();
  announce('Отзыв удалён');
}

// от отзывов зависит порядок при сортировке по оценке и популярности
function afterReviewsChange() {
  if (catalogStarted && state.catalog.status !== 'error') runCatalogQuery();
  else render();
}

// ---------- валюта ----------

const currencySelect = document.querySelector('#currency-select');
const rateNote = document.querySelector('#rate-note');

function formatRateDate(date) {
  const [year, month, day] = String(date).split('-');
  return day && month ? `${day}.${month}.${year}` : date;
}

function updateRateNote() {
  if (!rateNote) return;
  const money = state.money;
  if (money.currency === 'GBP') rateNote.textContent = '';
  else if (money.status === 'loading') rateNote.textContent = 'Загрузка курса…';
  else if (money.status === 'error') rateNote.textContent = 'Курс недоступен';
  else if (money.date) rateNote.textContent = 'Курс на ' + formatRateDate(money.date);
}

async function loadMoneyRates() {
  if (state.money.status === 'loading' || state.money.status === 'ready') return;
  state.money.status = 'loading';
  updateRateNote();
  try {
    const result = await loadRates();
    state.money.rates = result.rates;
    state.money.date = result.date;
    state.money.status = 'ready';
  } catch (error) {
    state.money.status = 'error';
    if (state.money.currency !== 'GBP') announce(error.message || 'Не удалось загрузить курсы валют');
  }
  render();
}

if (currencySelect) {
  currencySelect.value = state.money.currency;
  currencySelect.addEventListener('change', () => {
    state.money.currency = currencySelect.value;
    save();
    if (state.money.status === 'error') state.money.status = 'idle';
    loadMoneyRates();
    render();
  });
}

// У старых сохранённых деталей могло не быть фото — дополняем из свежих данных каталога
function refreshSnapshots(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  let changed = false;
  const builds = [state.build, ...state.saved];
  for (const build of builds) {
    for (const [slotId, snapshot] of Object.entries(build.slots)) {
      const fresh = snapshot && byId.get(snapshot.id);
      if (fresh && fresh.imageUrl && !snapshot.imageUrl) {
        build.slots[slotId] = { ...snapshot, imageUrl: fresh.imageUrl };
        changed = true;
      }
    }
  }
  if (changed) save();
}

// ---------- каталог ----------

function resetCatalogFilters() {
  Object.assign(state.catalog, { brands: [], priceMin: null, priceMax: null, specs: {}, sort: 'popular' });
}

async function runCatalogQuery() {
  catalogStarted = true;
  if (catalogController) catalogController.abort();
  const controller = new AbortController();
  catalogController = controller;
  const requestId = ++catalogRequestId;

  const catalog = state.catalog;
  catalog.status = 'loading';
  catalog.error = null;
  render();

  try {
    const all = await loadCategory(catalog.category, { signal: controller.signal });
    const result = await searchProducts(
      {
        category: catalog.category,
        query: catalog.query,
        brands: catalog.brands,
        priceMin: catalog.priceMin,
        priceMax: catalog.priceMax,
        specs: catalog.specs,
        sort: catalog.sort,
        ratings: getRatingsMap(state.reviews),
      },
      { signal: controller.signal },
    );
    if (requestId !== catalogRequestId) return;

    catalog.options = getFilterOptions(all.items, catalog.category);
    refreshSnapshots(all.items);
    catalog.items = result.items;
    catalog.total = result.total;
    catalog.status = result.items.length ? 'success' : 'empty';
  } catch (error) {
    if (isAbortError(error) || requestId !== catalogRequestId) return;
    catalog.status = 'error';
    catalog.error = {
      message: error instanceof ApiError ? error.message : 'Попробуйте ещё раз.',
      kind: error.kind || 'network',
      canRetry: true,
      retryAfter: error.retryAfter || null,
    };
  } finally {
    if (requestId === catalogRequestId) catalogController = null;
  }
  render();
}

const catalogCallbacks = {
  onSearch(query) {
    if (query === state.catalog.query && state.catalog.status === 'success') return;
    state.catalog.query = query;
    runCatalogQuery();
  },
  onCategory(categoryId) {
    if (categoryId === state.catalog.category) return;
    state.catalog.category = categoryId;
    state.catalog.query = '';
    if (state.catalog.targetSlot !== categoryId) state.catalog.targetSlot = null;
    resetCatalogFilters();
    runCatalogQuery();
  },
  onApplyFilters(filters) {
    Object.assign(state.catalog, filters);
    runCatalogQuery();
  },
  onResetFilters() {
    const sort = state.catalog.sort;
    resetCatalogFilters();
    state.catalog.sort = sort;
    runCatalogQuery();
  },
  onSort(sort) {
    state.catalog.sort = sort;
    runCatalogQuery();
  },
  onRetry: runCatalogQuery,
  onAdd: addProduct,
  onOpenDetails: (product, trigger) => details.open(product, trigger),
  onGoToBuild: goToBuild,
  onCancelReplace() {
    state.catalog.targetSlot = null;
    render();
  },
  isInBuild,
  getAddLabel,
  getRating,
};

const buildCallbacks = {
  onRenameBuild(name) {
    state.build.name = name;
    touchBuild();
  },
  onBudgetChange(budgetMinor) {
    state.build.budgetMinor = budgetMinor;
    touchBuild();
  },
  onReplace: (slotId) => chooseForSlot(slotId, true),
  onChoose: (slotId) => chooseForSlot(slotId, false),
  onRemove: removeSlot,
  onOpenDetails: (snapshot, trigger) => details.open(snapshot, trigger),
  onSave: saveCurrentBuild,
  onNewBuild: startNewBuild,
  onDownload: () => downloadBuild(state.build, state.money),
  getArtwork: getProductArtwork,
};

const savedCallbacks = {
  onOpenSaved: openSaved,
  onRenameSaved: renameSaved,
  onDuplicateSaved: duplicateSaved,
  onDeleteSaved: deleteSaved,
  onDownloadSaved(id) {
    const saved = state.saved.find((item) => item.id === id);
    if (saved) downloadBuild(saved, state.money);
  },
  onDownloadAll: () => downloadAllBuilds(state.saved, state.money),
  onNewBuild: startNewBuild,
  onGoToBuild: goToBuild,
  getArtwork: getProductArtwork,
};

const details = createDetailsDialog({
  getAction,
  onAction: addProduct,
  getMoney: () => state.money,
  getReviews: (productId) => state.reviews[productId] || [],
  getRating,
  onAddReview,
  onDeleteReview,
  onGoToBuild() {
    details.close();
    goToBuild();
  },
});

// ---------- отрисовка и навигация ----------

function render() {
  state.currentSavedId = getCurrentSaved()?.id || null;
  for (const view of VIEWS) containers[view].hidden = view !== state.view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === state.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  renderBuild(containers.build, state, buildCallbacks);
  if (catalogStarted) renderCatalog(containers.catalog, state, catalogCallbacks);
  renderSaved(containers.saved, state, savedCallbacks);
  details.refresh();
  updateRateNote();
}

function onRoute() {
  const view = getViewFromHash();
  const changed = view !== state.view;
  state.view = view;
  if (view === 'catalog' && !catalogStarted) runCatalogQuery();
  render();
  if (changed) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', onRoute);
onRoute();
loadMoneyRates();

if (state.storageWarning) announce(state.storageWarning);
