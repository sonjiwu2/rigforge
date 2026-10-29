// Скачивание списка комплектующих: одна сборка в .txt, все сохранённые в .json
import { CATEGORIES } from './data/catalog.js';
import { convertFromGbp, formatMoney, formatPrice, pluralRu } from './format.js';
import { budgetInCurrency, calculateBuildTotals, formatRateDate, getDisplayCurrency } from './build.js';

const SOURCE_TEXT = 'Источник цен: VantaSpec (vantaspec.com), цены на момент добавления в сборку';
const DETAIL_FORMS_GENITIVE = ['детали', 'деталей', 'деталей'];

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

// Имя файла из названия сборки: убираем символы, которые запрещены в Windows/macOS
function safeFileName(name, fallback) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 60)
    .trim()
    .replace(/ /g, '-');
  return clean || fallback;
}

function saveFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // сразу освобождать нельзя — некоторые браузеры ещё не начали скачивание
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Цена в выбранной валюте, а в скобках — исходная в фунтах, если валюта другая
function priceWithGbp(minor, currency, money) {
  if (currency && currency !== 'GBP') return formatMoney(minor, currency);
  const text = formatPrice(minor, money);
  if (minor === null || minor === undefined || getDisplayCurrency(money) === 'GBP') return text;
  return `${text} (${formatMoney(minor, 'GBP')})`;
}

// «1 GBP = 1,3385 USD на 30.10.2026 (Currency-api)» или null, если валюта — фунты
function rateLine(money) {
  const currency = getDisplayCurrency(money);
  if (currency === 'GBP') return null;
  const rate = money.rates[currency].toLocaleString('ru-RU', { maximumFractionDigits: 6 });
  const date = formatRateDate(money.date);
  return `Курс: 1 GBP = ${rate} ${currency}${date ? ' на ' + date : ''} (Currency-api)`;
}

export function buildToText(build, money = null, createdAt = new Date()) {
  const totals = calculateBuildTotals(build);
  const lines = [build.name, 'Список комплектующих RigForge', ''];

  for (const category of CATEGORIES) {
    const part = build.slots[category.id];
    if (!part) continue;
    lines.push(`${category.slotTitle}: ${part.name} — ${priceWithGbp(part.priceMinor, part.currency, money)}`);
  }
  if (!totals.count) lines.push('Детали не выбраны');
  lines.push('');

  if (totals.mixedCurrencies) {
    lines.push('Итого: цены в разных валютах, общая сумма не считается');
  } else {
    lines.push(`Итого известных позиций: ${priceWithGbp(totals.knownTotalMinor, totals.currency, money)}`);
  }
  if (totals.unknownCount > 0) {
    lines.push(`Цена не указана для ${totals.unknownCount} ${pluralRu(totals.unknownCount, DETAIL_FORMS_GENITIVE)}`);
  }
  lines.push(build.budgetMinor === null || build.budgetMinor === undefined
    ? 'Бюджет: не указан'
    : `Бюджет: ${budgetText(build.budgetMinor, money)}`);
  lines.push('');
  const rate = rateLine(money);
  if (rate) lines.push(rate);
  lines.push(SOURCE_TEXT);
  lines.push(`Файл создан: ${dateFormat.format(createdAt)}`);

  // \r\n — чтобы файл нормально открывался и в «Блокноте»
  return lines.join('\r\n') + '\r\n';
}

// бюджет показываем так же, как в поле на странице сборки
function budgetText(budgetMinor, money) {
  const shown = budgetInCurrency(budgetMinor, money);
  const text = formatMoney(shown.minor, shown.currency);
  return shown.currency === 'GBP' ? text : `${text} (${formatMoney(budgetMinor, 'GBP')})`;
}

export function downloadBuild(build, money = null) {
  // BOM помогает старым редакторам понять, что файл в UTF-8
  const text = '﻿' + buildToText(build, money);
  saveFile(text, safeFileName(build.name, 'rigforge-build') + '.txt', 'text/plain;charset=utf-8');
}

function buildToJson(build, money) {
  const totals = calculateBuildTotals(build);
  const parts = [];
  for (const category of CATEGORIES) {
    const part = build.slots[category.id];
    if (!part) continue;
    parts.push({
      category: category.id,
      categoryTitle: category.slotTitle,
      id: part.id,
      name: part.name,
      manufacturer: part.manufacturer ?? null,
      model: part.model ?? null,
      priceMinor: part.priceMinor,
      currency: part.currency,
      price: formatMoney(part.priceMinor, part.currency),
      priceConverted: priceConverted(part.priceMinor, part.currency, money),
      priceAsOf: part.priceAsOf ?? null,
      specs: part.specs || [],
      sourceUrl: part.slug ? `https://vantaspec.com/products/${part.slug}` : null,
    });
  }
  return {
    id: build.id,
    name: build.name,
    currency: build.currency,
    budgetMinor: build.budgetMinor,
    budgetConverted: build.budgetMinor === null || build.budgetMinor === undefined || getDisplayCurrency(money) === 'GBP'
      ? null
      : budgetText(build.budgetMinor, money),
    savedAt: build.savedAt ?? null,
    updatedAt: build.updatedAt ?? null,
    totals: {
      count: totals.count,
      knownTotalMinor: totals.knownTotalMinor,
      knownTotal: totals.mixedCurrencies ? null : formatMoney(totals.knownTotalMinor, totals.currency),
      knownTotalConverted: totals.mixedCurrencies ? null : priceConverted(totals.knownTotalMinor, totals.currency, money),
      unknownCount: totals.unknownCount,
      mixedCurrencies: totals.mixedCurrencies,
    },
    parts,
  };
}

// В JSON цены остаются в пенсах GBP, пересчёт — отдельной строкой (null, если валюта — фунты)
function priceConverted(minor, currency, money) {
  if (minor === null || minor === undefined || (currency && currency !== 'GBP')) return null;
  const converted = convertFromGbp(minor, money);
  return converted.currency === 'GBP' ? null : formatMoney(converted.minor, converted.currency);
}

export function downloadAllBuilds(builds, money = null) {
  const createdAt = new Date();
  const currency = getDisplayCurrency(money);
  const data = {
    app: 'RigForge',
    title: 'Список комплектующих RigForge',
    version: 1,
    createdAt: createdAt.toISOString(),
    source: {
      name: 'VantaSpec',
      url: 'https://vantaspec.com',
      note: 'цены на момент добавления в сборку',
    },
    exchange: currency === 'GBP'
      ? null
      : { from: 'GBP', to: currency, rate: money.rates[currency], date: money.date ?? null, source: 'Currency-api' },
    builds: (builds || []).map((build) => buildToJson(build, money)),
  };
  const day = createdAt.toISOString().slice(0, 10);
  saveFile(JSON.stringify(data, null, 2), `rigforge-builds-${day}.json`, 'application/json;charset=utf-8');
}
