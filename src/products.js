// Приводим ответ VantaSpec к общей модели Product и работаем со списком товаров.
import { getCategory } from './data/catalog.js';

export const SPEC_LABELS = {
  Architecture: 'Архитектура',
  'Base Clock': 'Базовая частота',
  'Boost Clock': 'Частота в бусте',
  Cores: 'Ядра',
  Threads: 'Потоки',
  'E-Cores': 'Энергоэффективные ядра',
  'P-Cores': 'Производительные ядра',
  'L3 Cache': 'Кеш L3',
  Socket: 'Сокет',
  TDP: 'Теплопакет',
  'Integrated Graphics': 'Встроенная графика',
  'Form Factor': 'Форм-фактор',
  Memory: 'Память',
  Chipset: 'Чипсет',
  'Memory Slots': 'Слоты памяти',
  'Max Memory': 'Макс. память',
  Colour: 'Цвет',
  PCIe: 'PCIe',
  'Memory Bus': 'Шина памяти',
  Length: 'Длина',
  'GPU Cores': 'Ядра GPU',
  Capacity: 'Объём',
  'CAS Latency': 'Задержка CAS',
  Kit: 'Комплект',
  Type: 'Тип',
  Speed: 'Частота',
  Voltage: 'Напряжение',
  Interface: 'Интерфейс',
  'Sequential Read': 'Чтение',
  'Sequential Write': 'Запись',
  TBW: 'Ресурс записи (TBW)',
  Cache: 'Кеш',
  RPM: 'Скорость вращения',
  Wattage: 'Мощность',
  Efficiency: 'Сертификат',
  Modular: 'Модульность',
  'ATX Version': 'Версия ATX',
  'Motherboard Support': 'Поддержка плат',
  'Side Panel': 'Боковая панель',
  'Tempered Glass': 'Закалённое стекло',
  '3.5" Bays': 'Отсеки 3.5"',
  'External Volume': 'Объём корпуса',
  'Fans Included': 'Вентиляторы в комплекте',
  'Max CPU Cooler Height': 'Макс. высота кулера',
  'Max GPU Length': 'Макс. длина видеокарты',
  'Fan Size': 'Размер вентилятора',
  'Noise Level': 'Уровень шума',
  Height: 'Высота',
  'Radiator Size': 'Радиатор',
  'Radiator Support': 'Поддержка радиаторов',
};

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Фото берём только с CDN VantaSpec и только по https
function cleanImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.vantaspec.com' ? url.href : null;
  } catch {
    return null;
  }
}

function toCount(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function toMinor(price) {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0
    ? Math.round(price * 100)
    : null;
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

// Значение характеристики -> строка или null (объекты и пустые значения выкидываем)
function specValueToText(value, unit) {
  let text = null;
  if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  else if (typeof value === 'boolean') text = value ? 'Да' : 'Нет';
  else text = cleanText(value);
  if (!text) return null;

  if (/^(true|yes)$/i.test(text)) return 'Да';
  if (/^(false|no)$/i.test(text)) return 'Нет';
  // '16GB' и '16 GB' должны быть одним значением в фильтрах
  text = text.replace(/(\d)(GB|TB|MB)\b/g, '$1 $2');
  // у дисков '3000 GB' и '3 TB' — одно и то же
  text = text.replace(/^(\d+)000 GB$/, '$1 TB');
  if (unit && !text.includes(unit)) text = `${text} ${unit}`;
  return text;
}

function normalizeOffers(prices) {
  if (!Array.isArray(prices)) return [];
  const offers = [];
  for (const price of prices) {
    const priceMinor = toMinor(price && price.price);
    if (priceMinor === null) continue;
    offers.push({
      retailer: cleanText(price.retailer) || 'Магазин',
      priceMinor,
      currency: cleanText(price.currency) || 'GBP',
      url: isHttpUrl(price.url) ? price.url : null,
    });
  }
  return offers.sort((a, b) => a.priceMinor - b.priceMinor);
}

export function normalizeCompareResponse(json, categoryId) {
  if (!json || !Array.isArray(json.products)) return [];
  const matrix = Array.isArray(json.specMatrix) ? json.specMatrix : [];
  const priceAsOf = new Date().toISOString();
  const result = [];

  json.products.forEach((raw, index) => {
    if (!raw || typeof raw.id !== 'string' || typeof raw.slug !== 'string') return;

    // values в specMatrix идут в том же порядке, что и products
    const specs = [];
    for (const row of matrix) {
      if (!row || typeof row.name !== 'string' || !Array.isArray(row.values)) continue;
      const value = specValueToText(row.values[index], cleanText(row.unit));
      if (value === null) continue;
      specs.push({ key: row.name, label: SPEC_LABELS[row.name] || row.name, value, scope: 'exact' });
    }

    const offers = normalizeOffers(raw.prices);
    const priceMinor = offers.length ? offers[0].priceMinor : toMinor(raw.lowestPrice);
    const currency = offers.length ? offers[0].currency : priceMinor === null ? null : 'GBP';

    let priceKind = 'unknown';
    if (offers.length > 1) priceKind = 'from';
    else if (priceMinor !== null) priceKind = 'exact';

    const description = cleanText(raw.description);

    result.push({
      id: `vantaspec:${raw.id}`,
      provider: 'vantaspec',
      providerId: raw.id,
      slug: raw.slug,
      category: categoryId,
      manufacturer: cleanText(raw.brand),
      name: cleanText(raw.name) || raw.slug,
      model: cleanText(raw.model),
      mpn: null,
      priceMinor,
      currency,
      priceKind,
      offers,
      imageUrl: cleanImageUrl(raw.imageUrl),
      gallery: [],
      specs,
      description,
      descriptionScope: description ? 'exact' : null,
      sourceUrl: `https://vantaspec.com/products/${encodeURIComponent(raw.slug)}`,
      priceAsOf,
      // популярность: в скольких магазинах продаётся и сколько раз добавили в избранное на VantaSpec
      popularity: { offers: offers.length, favorites: toCount(raw.favorites) },
    });
  });

  return result;
}

export function getSpec(product, key) {
  if (!product || !Array.isArray(product.specs)) return null;
  const spec = product.specs.find((item) => item.key === key);
  return spec ? spec.value : null;
}

// То, что сохраняется в сборке: только основное и 2 характеристики для карточки
export function toSnapshot(product) {
  const category = getCategory(product.category);
  const cardSpecs = category ? category.cardSpecs : [];
  const specs = [];
  for (const key of cardSpecs) {
    const spec = (product.specs || []).find((item) => item.key === key);
    if (spec) specs.push({ key: spec.key, label: spec.label, value: spec.value, scope: spec.scope });
    if (specs.length === 2) break;
  }
  return {
    id: product.id,
    provider: product.provider,
    providerId: product.providerId,
    slug: product.slug,
    category: product.category,
    manufacturer: product.manufacturer,
    name: product.name,
    model: product.model,
    priceMinor: product.priceMinor,
    currency: product.currency,
    imageUrl: product.imageUrl || null,
    specs,
    priceAsOf: product.priceAsOf,
  };
}

// Значения для фильтров приводим к одному виду (в карточке и окне подробностей specs не меняются).
// Не распознали — оставляем как есть.
export function filterValue(key, value, categoryId) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  const lower = text.toLowerCase();

  if (key === 'Form Factor' && categoryId === 'case') {
    if (lower.includes('full tower')) return 'Full Tower';
    if (lower.includes('mid tower') || lower.includes('midi tower')) return 'Mid Tower';
    if (lower.includes('mini tower')) return 'Mini Tower';
    return text;
  }
  if (key === 'Form Factor' && categoryId === 'motherboard') {
    if (/e-?atx/.test(lower)) return 'E-ATX';
    if (/mini[\s-]?itx/.test(lower)) return 'Mini-ITX';
    if (/\bmatx\b|\bm-atx\b|micro[\s-]?atx/.test(lower)) return 'Micro-ATX';
    if (/\batx\b/.test(lower)) return 'ATX';
    return text;
  }
  if (key === 'Memory' && categoryId === 'gpu') {
    const match = text.match(/(\d+)\s*GB/i);
    return match ? `${match[1]} GB` : text;
  }
  if (key === 'Type' && categoryId === 'ram') {
    const match = text.match(/DDR(\d)/i);
    return match ? `DDR${match[1]}` : text;
  }
  if (key === 'Capacity' && categoryId === 'ram') {
    // '32 GB (2 x 16 GB)' -> общий объём '32 GB'
    const match = text.match(/^(\d+)\s*GB/i);
    return match ? `${match[1]} GB` : text;
  }
  if (key === 'Type' && categoryId === 'cooler') {
    if (/aio|all-in-one|liquid|hydro|water/.test(lower)) return 'Жидкостное';
    if (/\bair\b/.test(lower)) return 'Воздушное';
    return text;
  }
  if (key === 'Modular' && categoryId === 'psu') {
    if (/semi/.test(lower)) return 'Полумодульный';
    if (/non|^нет$|^false$/.test(lower)) return 'Немодульный';
    // просто 'Modular' у VantaSpec — это полностью модульные блоки
    if (/full|^modular$|^да$/.test(lower)) return 'Полностью модульный';
    return text;
  }
  return text;
}

// 'WD', 'Western Digital', 'WD_BLACK' и SanDisk с моделью WD Black — один производитель
export function filterBrand(product) {
  const brand = product.manufacturer;
  if (!brand) return null;
  if (/^(wd|wd_black|western digital)$/i.test(brand)) return 'WD';
  if (/^sandisk/i.test(brand) && /\bwd\b|wd_black/i.test(`${brand} ${product.model || ''}`)) return 'WD';
  return brand;
}

function getFilterSpec(product, key) {
  return filterValue(key, getSpec(product, key), product.category);
}

function normalizeQuery(text) {
  return String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
}

// Все слова запроса должны встретиться в названии, бренде, модели или артикуле
function matchesQuery(product, words) {
  if (!words.length) return true;
  const haystack = [product.name, product.manufacturer, filterBrand(product), product.model, product.mpn]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterProducts(items, filters = {}) {
  const words = normalizeQuery(filters.query);
  const brands = filters.brands || [];
  const specs = filters.specs || {};
  const priceMin = Number.isInteger(filters.priceMin) ? filters.priceMin : null;
  const priceMax = Number.isInteger(filters.priceMax) ? filters.priceMax : null;

  return items.filter((product) => {
    if (!matchesQuery(product, words)) return false;
    if (brands.length && !brands.includes(filterBrand(product))) return false;

    // при фильтре по цене товары без цены не показываем
    if (priceMin !== null || priceMax !== null) {
      if (product.priceMinor === null) return false;
      if (priceMin !== null && product.priceMinor < priceMin) return false;
      if (priceMax !== null && product.priceMinor > priceMax) return false;
    }

    for (const [key, values] of Object.entries(specs)) {
      if (!Array.isArray(values) || !values.length) continue;
      if (!values.includes(getFilterSpec(product, key))) return false;
    }
    return true;
  });
}

function comparePrice(a, b) {
  if (a.priceMinor === null && b.priceMinor === null) return 0;
  if (a.priceMinor === null) return 1;
  if (b.priceMinor === null) return -1;
  return a.priceMinor - b.priceMinor;
}

// sort: 'popular' | 'price-asc' | 'price-desc' | 'rating'
// ratings: { [productId]: { average, count } } — отзывы пользователя из этого браузера
export function sortProducts(items, sort = 'popular', ratings = {}) {
  const list = items.slice();
  const rating = (product) => (ratings && ratings[product.id]) || { average: null, count: 0 };
  const reviewCount = (product) => rating(product).count || 0;

  // sort стабильный, поэтому при равенстве остаётся исходный порядок
  if (sort === 'price-asc') return list.sort(comparePrice);
  if (sort === 'price-desc') {
    // товары без цены всё равно в конце
    return list.sort((a, b) => {
      if (a.priceMinor === null || b.priceMinor === null) return comparePrice(a, b);
      return b.priceMinor - a.priceMinor;
    });
  }
  if (sort === 'rating') {
    return list.sort((a, b) => {
      const avgA = rating(a).average;
      const avgB = rating(b).average;
      if (avgA === null && avgB === null) return 0;
      if (avgA === null) return 1;
      if (avgB === null) return -1;
      return avgB - avgA || reviewCount(b) - reviewCount(a);
    });
  }

  // по популярности: число магазинов, потом избранное на VantaSpec, потом число отзывов
  const popularity = (product) => product.popularity || { offers: (product.offers || []).length, favorites: 0 };
  return list.sort((a, b) => {
    const popA = popularity(a);
    const popB = popularity(b);
    return popB.offers - popA.offers || popB.favorites - popA.favorites || reviewCount(b) - reviewCount(a);
  });
}

// '500 GB' < '1 TB' < '2 TB', '650W' < '850W', остальное по алфавиту
function specSortValue(value) {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB)?/i);
  if (!match) return null;
  const multipliers = { tb: 1000, gb: 1, mb: 0.001 };
  const unit = match[2] ? match[2].toLowerCase() : null;
  return Number(match[1]) * (unit ? multipliers[unit] : 1);
}

// модульность — от простого к удобному, а не по алфавиту
const VALUE_ORDER = ['Немодульный', 'Полумодульный', 'Полностью модульный', 'Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX', 'Mini Tower', 'Mid Tower', 'Full Tower'];

function compareSpecValues(a, b) {
  const orderA = VALUE_ORDER.indexOf(a);
  const orderB = VALUE_ORDER.indexOf(b);
  if (orderA !== -1 && orderB !== -1) return orderA - orderB;
  if (orderA !== -1) return -1;
  if (orderB !== -1) return 1;

  const numA = specSortValue(a);
  const numB = specSortValue(b);
  if (numA !== null && numB !== null && numA !== numB) return numA - numB;
  if (numA !== null && numB === null) return -1;
  if (numA === null && numB !== null) return 1;
  return a.localeCompare(b, 'ru', { numeric: true });
}

export function getFilterOptions(items, categoryId) {
  const category = getCategory(categoryId);
  const brands = [...new Set(items.map(filterBrand).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'en')
  );

  const specs = {};
  for (const key of category ? category.filterSpecs : []) {
    const values = [...new Set(items.map((item) => filterValue(key, getSpec(item, key), categoryId)).filter(Boolean))];
    if (!values.length) continue;
    specs[key] = { label: SPEC_LABELS[key] || key, values: values.sort(compareSpecValues) };
  }

  const prices = items.map((item) => item.priceMinor).filter((price) => price !== null);
  const priceRange = prices.length
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : { min: null, max: null };

  return { brands, specs, priceRange };
}
