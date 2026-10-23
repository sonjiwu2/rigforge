// Запросы к VantaSpec. Поиск у них без CORS, поэтому список моделей берём из catalog.js,
// а цены и характеристики — из /api/compare (максимум 4 модели за запрос).
import { CATALOG_SLUGS, getCategory } from './data/catalog.js';
import { normalizeCompareResponse } from './products.js';

const COMPARE_URL = 'https://vantaspec.com/api/compare';
const TIMEOUT_MS = 12000;
const CHUNK_SIZE = 4;

export const ATTRIBUTION = { text: 'Данные: VantaSpec', url: 'https://vantaspec.com' };

export class ApiError extends Error {
  // kind: 'http' | 'network' | 'timeout' | 'format' | 'rate'
  constructor(kind, message, { status = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isAbortError(err) {
  return Boolean(err) && err.name === 'AbortError';
}

function abortError() {
  return new DOMException('Запрос отменён', 'AbortError');
}

// Retry-After бывает числом секунд или датой
function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

// GET с таймаутом. Отмену внешним signal пробрасываем как есть (AbortError).
export async function fetchJson(url, { signal } = {}) {
  if (signal && signal.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const convertError = (err) => {
    if (timedOut) return new ApiError('timeout', 'Сервер слишком долго отвечает. Попробуйте ещё раз.');
    if (signal && signal.aborted) return isAbortError(err) ? err : abortError();
    return new ApiError('network', 'Не удалось связаться с сервером. Проверьте подключение к интернету.');
  };

  try {
    let response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      throw convertError(err);
    }

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        const wait = retryAfter ? ` через ${retryAfter} с` : ' чуть позже';
        throw new ApiError('rate', `Слишком много запросов. Попробуйте${wait}.`, { status: 429, retryAfter });
      }
      throw new ApiError('http', `Сервер ответил ошибкой (код ${response.status}).`, { status: response.status });
    }

    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw convertError(err);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError('format', 'Сервер вернул данные в непонятном формате.');
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Один общий запрос могут ждать несколько вызывающих, у каждого свой signal
function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export async function fetchCompare(slugs, categoryId, { signal } = {}) {
  const url = new URL(COMPARE_URL);
  url.searchParams.set('slugs', slugs.join(','));
  const json = await fetchJson(url.toString(), { signal });
  if (!json || typeof json !== 'object' || !Array.isArray(json.products)) {
    throw new ApiError('format', 'Сервер вернул данные в непонятном формате.');
  }
  return normalizeCompareResponse(json, categoryId);
}

async function fetchCategory(categoryId) {
  const slugs = CATALOG_SLUGS[categoryId] || [];
  const chunks = [];
  for (let i = 0; i < slugs.length; i += CHUNK_SIZE) {
    chunks.push(slugs.slice(i, i + CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) => {
      // API не принимает один slug, добавляем любой другой из категории
      const request = chunk.length === 1 ? [chunk[0], slugs.find((slug) => slug !== chunk[0])] : chunk;
      return fetchCompare(request.filter(Boolean), categoryId);
    })
  );

  const bySlug = new Map();
  for (const items of results) {
    for (const item of items) bySlug.set(item.slug, item);
  }
  // порядок как в CATALOG_SLUGS — это и есть «по релевантности»
  const items = slugs.map((slug) => bySlug.get(slug)).filter(Boolean);
  return { items, attribution: ATTRIBUTION };
}

const categoryCache = new Map();

export function loadCategory(categoryId, { signal } = {}) {
  if (!getCategory(categoryId)) {
    return Promise.reject(new Error(`Неизвестная категория: ${categoryId}`));
  }
  if (!categoryCache.has(categoryId)) {
    const promise = fetchCategory(categoryId);
    categoryCache.set(categoryId, promise);
    // неудачный результат не кешируем, чтобы «Повторить» сделал новый запрос
    promise.catch(() => categoryCache.delete(categoryId));
  }
  return waitWithSignal(categoryCache.get(categoryId), signal);
}
