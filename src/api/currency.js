// Валюты для вывода цен и курсы к фунту. Цены в данных всегда в GBP (пенсы),
// в другую валюту переводим только при выводе.
import { ApiError, fetchJson, isAbortError } from './vantaspec.js';

export const CURRENCIES = {
  GBP: { code: 'GBP', symbol: '£', label: 'GBP £', locale: 'en-GB', digits: 2 },
  USD: { code: 'USD', symbol: '$', label: 'USD $', locale: 'en-US', digits: 2 },
  RUB: { code: 'RUB', symbol: '₽', label: 'RUB ₽', locale: 'ru-RU', digits: 0 },
};

// Currency-api: основной адрес на jsDelivr, запасной — копия на Cloudflare Pages
const RATES_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.min.json';
const RATES_FALLBACK_URL = 'https://latest.currency-api.pages.dev/v1/currencies/gbp.min.json';

let cachedRates = null;

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function fetchRates(url, signal) {
  const json = await fetchJson(url, { signal });
  const gbp = json && json.gbp;
  if (!gbp || !isPositiveNumber(gbp.usd) || !isPositiveNumber(gbp.rub)) {
    throw new ApiError('format', 'Курсы валют пришли в непонятном формате.');
  }
  return {
    rates: { GBP: 1, USD: gbp.usd, RUB: gbp.rub },
    date: typeof json.date === 'string' ? json.date : null,
    source: 'Currency-api',
  };
}

export async function loadRates({ signal } = {}) {
  if (cachedRates) return cachedRates;

  let result;
  try {
    result = await fetchRates(RATES_URL, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    // основной адрес не ответил — пробуем запасной
    try {
      result = await fetchRates(RATES_FALLBACK_URL, signal);
    } catch (err2) {
      if (isAbortError(err2)) throw err2;
      throw new ApiError(err2.kind || 'network', 'Не удалось загрузить курсы валют. Цены показаны в фунтах.', {
        status: err2.status ?? null,
        retryAfter: err2.retryAfter ?? null,
      });
    }
  }
  cachedRates = result;
  return result;
}
