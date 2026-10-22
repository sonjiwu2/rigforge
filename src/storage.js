// Хранение текущей сборки и сохранённых сборок в localStorage.
// Всё, что прочитали из хранилища, проверяем: туда мог попасть мусор
// (старая версия сайта, ручная правка, обрезанная запись).
import { CATEGORIES } from './data/catalog.js';

const STORAGE_KEY = 'rigforge:state:v1';
const VERSION = 1;
const NAME_MAX = 80;
const SLOT_IDS = CATEGORIES.map((category) => category.id);

const WARNING_UNAVAILABLE = 'Хранилище браузера недоступно — сборки не сохранятся после закрытия вкладки';
const WARNING_BROKEN = 'Сохранённые данные повреждены и были сброшены';
const WARNING_PARTLY_BROKEN = 'Часть сохранённых данных повреждена и была удалена';

export function createEmptyBuild(name = 'Сборка №1') {
  const slots = {};
  for (const id of SLOT_IDS) slots[id] = null;
  return {
    id: 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    name,
    budgetMinor: null,
    currency: 'GBP',
    slots,
    updatedAt: new Date().toISOString(),
  };
}

function getStorage() {
  try {
    const storage = window.localStorage;
    // в некоторых режимах браузера localStorage есть, но запись бросает ошибку
    const testKey = 'rigforge:test';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return storage;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 500;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && value.length <= 500 ? value : undefined;
}

function isDateString(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

function cleanSpecs(value) {
  if (!Array.isArray(value)) return null;
  const specs = [];
  for (const spec of value.slice(0, 2)) {
    if (!isPlainObject(spec)) return null;
    const { key, label, value: specValue, scope } = spec;
    if (!isText(key) || !isText(label) || !isText(specValue)) return null;
    const cleanScope = textOrNull(scope);
    if (cleanScope === undefined) return null;
    specs.push({ key, label, value: specValue, scope: cleanScope });
  }
  return specs;
}

// Snapshot детали: только известные поля, остальное отбрасываем.
// Возвращает null, если форма неправильная.
function cleanSnapshot(value, slotId) {
  if (!isPlainObject(value)) return null;
  if (value.category !== slotId) return null;
  if (!isText(value.id) || !isText(value.name)) return null;

  const optional = {};
  for (const key of ['provider', 'providerId', 'slug', 'manufacturer', 'model']) {
    const text = textOrNull(value[key]);
    if (text === undefined) return null;
    optional[key] = text;
  }

  const priceMinor = value.priceMinor === undefined ? null : value.priceMinor;
  if (priceMinor !== null && !isMoney(priceMinor)) return null;

  const currency = value.currency === undefined ? null : value.currency;
  if (currency !== null && !(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency))) return null;

  const specs = value.specs === undefined ? [] : cleanSpecs(value.specs);
  if (!specs) return null;

  const priceAsOf = value.priceAsOf === undefined || value.priceAsOf === null ? null : value.priceAsOf;
  if (priceAsOf !== null && !isDateString(priceAsOf)) return null;

  return {
    id: value.id,
    provider: optional.provider,
    providerId: optional.providerId,
    slug: optional.slug,
    category: slotId,
    manufacturer: optional.manufacturer,
    name: value.name,
    model: optional.model,
    priceMinor,
    currency,
    specs,
    priceAsOf,
  };
}

// Сборка целиком. isSaved — для сохранённых обязательна дата savedAt.
// problems.count увеличивается, если пришлось выбросить испорченную деталь.
function cleanBuild(value, isSaved, problems) {
  if (!isPlainObject(value)) return null;
  if (!isText(value.id)) return null;
  const name = cleanName(value.name);
  if (!name) return null;

  const budgetMinor = value.budgetMinor === undefined ? null : value.budgetMinor;
  if (budgetMinor !== null && !(isMoney(budgetMinor) && budgetMinor > 0)) return null;

  if (value.currency !== 'GBP') return null;
  if (!isPlainObject(value.slots)) return null;

  // слоты неизвестных категорий просто не переносим
  const slots = {};
  for (const id of SLOT_IDS) {
    const raw = value.slots[id];
    if (raw === null || raw === undefined) {
      slots[id] = null;
      continue;
    }
    slots[id] = cleanSnapshot(raw, id);
    if (!slots[id]) problems.count++;
  }

  const build = {
    id: value.id,
    name,
    budgetMinor,
    currency: 'GBP',
    slots,
    updatedAt: isDateString(value.updatedAt) ? value.updatedAt : new Date().toISOString(),
  };

  if (isSaved) {
    if (!isDateString(value.savedAt)) return null;
    build.savedAt = value.savedAt;
  }
  return build;
}

function cleanState(data, problems) {
  if (!isPlainObject(data) || data.version !== VERSION) return null;
  const build = cleanBuild(data.build, false, problems);
  if (!build || !Array.isArray(data.saved)) return null;

  const saved = [];
  const ids = new Set();
  for (const item of data.saved) {
    const savedBuild = cleanBuild(item, true, problems);
    if (!savedBuild || ids.has(savedBuild.id)) {
      problems.count++;
      continue;
    }
    ids.add(savedBuild.id);
    saved.push(savedBuild);
  }
  return { build, saved };
}

export function loadAppState() {
  const empty = () => ({ build: createEmptyBuild(), saved: [] });

  const storage = getStorage();
  if (!storage) {
    return { ...empty(), storageOk: false, warning: WARNING_UNAVAILABLE };
  }

  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ...empty(), storageOk: false, warning: WARNING_UNAVAILABLE };
  }
  if (raw === null) {
    return { ...empty(), storageOk: true, warning: null };
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  const problems = { count: 0 };
  const state = data ? cleanState(data, problems) : null;
  if (!state) {
    // испорченную запись удаляем, чтобы предупреждение не повторялось
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ничего страшного, перезапишется при следующем сохранении
    }
    return { ...empty(), storageOk: true, warning: WARNING_BROKEN };
  }

  return {
    ...state,
    storageOk: true,
    warning: problems.count > 0 ? WARNING_PARTLY_BROKEN : null,
  };
}

export function persistAppState({ build, saved }) {
  const storage = getStorage();
  if (!storage) return false;

  // пишем только проверенные поля, лишнее (например, состояние каталога) не храним
  const problems = { count: 0 };
  const cleanCurrent = cleanBuild(build, false, problems);
  if (!cleanCurrent) return false;
  const cleanSaved = [];
  for (const item of Array.isArray(saved) ? saved : []) {
    const savedBuild = cleanBuild(item, true, problems);
    if (savedBuild) cleanSaved.push(savedBuild);
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, build: cleanCurrent, saved: cleanSaved }));
    return true;
  } catch {
    return false;
  }
}
