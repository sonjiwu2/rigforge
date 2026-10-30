// Блок «О серии»: вступление статьи английской Википедии про серию процессора или видеокарты.
// Серию определяем только по точному совпадению названия модели.
import { ApiError, fetchJson } from './vantaspec.js';

const WIKI_API_URL = 'https://en.wikipedia.org/w/api.php';
const MAX_EXTRACT = 900;

const SERIES = {
  cpu: [
    { pattern: /\bRyzen\s+[3579]\s+9\d{3}(?:X3D|XT|X|GT|G|F)?\b/i, title: 'Zen 5' },
    { pattern: /\bRyzen\s+[3579]\s+7\d{3}(?:X3D|XT|X|GT|G|F)?\b/i, title: 'Zen 4' },
    { pattern: /\bRyzen\s+[3579]\s+5\d{3}(?:X3D|XT|X|GT|G|F)?\b/i, title: 'Zen 3' },
    { pattern: /\bCore\s+Ultra\s+[3579]\s+2\d{2}(?:KF|K|F|T)?\b/i, title: 'Arrow Lake (microprocessor)' },
    { pattern: /\bCore\s+i[3579][\s-]+14\d{3}(?:KF|K|F|T)?\b/i, title: 'Raptor Lake' },
    { pattern: /\bCore\s+i[3579][\s-]+12\d{3}(?:KF|K|F|T)?\b/i, title: 'Alder Lake' },
  ],
  gpu: [
    { pattern: /\bGeForce\s+RTX\s+50[5-9]0\b/i, title: 'GeForce RTX 50 series' },
    { pattern: /\bGeForce\s+RTX\s+40[5-9]0\b/i, title: 'GeForce RTX 40 series' },
    { pattern: /\bRadeon\s+RX\s+90[5-9]0\b/i, title: 'Radeon RX 9000 series' },
  ],
};

const cache = new Map();

export function getSeriesTitle(product) {
  const rules = SERIES[product.category];
  if (!rules) return null;
  const text = product.model || product.name || '';
  const rule = rules.find((item) => item.pattern.test(text));
  return rule ? rule.title : null;
}

// Обрезаем по концу предложения, чтобы не рвать текст на полуслове
function shortenExtract(text) {
  if (text.length <= MAX_EXTRACT) return text;
  const part = text.slice(0, MAX_EXTRACT);
  const lastEnd = Math.max(part.lastIndexOf('. '), part.lastIndexOf('.\n'));
  if (lastEnd > MAX_EXTRACT / 3) return part.slice(0, lastEnd + 1);
  return part.slice(0, part.lastIndexOf(' ')) + '…';
}

export async function getSupplementaryInfo(product, { signal } = {}) {
  const title = getSeriesTitle(product);
  if (!title) return null;
  if (cache.has(title)) return cache.get(title);

  const url = new URL(WIKI_API_URL);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'extracts|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    redirects: '1',
    titles: title,
  }).toString();

  const json = await fetchJson(url.toString(), { signal });
  if (!json || typeof json !== 'object' || json.error) {
    throw new ApiError('format', 'Не удалось получить описание серии.');
  }

  const page = json.query && Array.isArray(json.query.pages) ? json.query.pages[0] : null;
  let info = null;
  if (page && !page.missing && !page.invalid && typeof page.extract === 'string' && page.extract.trim()) {
    info = {
      title: page.title || title,
      extract: shortenExtract(page.extract.trim()),
      url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      lang: 'en',
      scope: 'series',
    };
  }
  cache.set(title, info);
  return info;
}
