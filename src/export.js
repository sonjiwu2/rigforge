// Скачивание списка комплектующих: одна сборка в .txt, все сохранённые в .json
import { CATEGORIES } from './data/catalog.js';
import { formatMoney, pluralRu } from './format.js';
import { calculateBuildTotals } from './build.js';

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

export function buildToText(build, createdAt = new Date()) {
  const totals = calculateBuildTotals(build);
  const lines = [build.name, 'Список комплектующих RigForge', ''];

  for (const category of CATEGORIES) {
    const part = build.slots[category.id];
    if (!part) continue;
    lines.push(`${category.slotTitle}: ${part.name} — ${formatMoney(part.priceMinor, part.currency)}`);
  }
  if (!totals.count) lines.push('Детали не выбраны');
  lines.push('');

  if (totals.mixedCurrencies) {
    lines.push('Итого: цены в разных валютах, общая сумма не считается');
  } else {
    lines.push(`Итого известных позиций: ${formatMoney(totals.knownTotalMinor, totals.currency)}`);
  }
  if (totals.unknownCount > 0) {
    lines.push(`Цена не указана для ${totals.unknownCount} ${pluralRu(totals.unknownCount, DETAIL_FORMS_GENITIVE)}`);
  }
  lines.push(build.budgetMinor === null || build.budgetMinor === undefined
    ? 'Бюджет: не указан'
    : `Бюджет: ${formatMoney(build.budgetMinor, build.currency)}`);
  lines.push('');
  lines.push(SOURCE_TEXT);
  lines.push(`Файл создан: ${dateFormat.format(createdAt)}`);

  // \r\n — чтобы файл нормально открывался и в «Блокноте»
  return lines.join('\r\n') + '\r\n';
}

export function downloadBuild(build) {
  // BOM помогает старым редакторам понять, что файл в UTF-8
  const text = '﻿' + buildToText(build);
  saveFile(text, safeFileName(build.name, 'rigforge-build') + '.txt', 'text/plain;charset=utf-8');
}

function buildToJson(build) {
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
    savedAt: build.savedAt ?? null,
    updatedAt: build.updatedAt ?? null,
    totals: {
      count: totals.count,
      knownTotalMinor: totals.knownTotalMinor,
      knownTotal: totals.mixedCurrencies ? null : formatMoney(totals.knownTotalMinor, totals.currency),
      unknownCount: totals.unknownCount,
      mixedCurrencies: totals.mixedCurrencies,
    },
    parts,
  };
}

export function downloadAllBuilds(builds) {
  const createdAt = new Date();
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
    builds: (builds || []).map(buildToJson),
  };
  const day = createdAt.toISOString().slice(0, 10);
  saveFile(JSON.stringify(data, null, 2), `rigforge-builds-${day}.json`, 'application/json;charset=utf-8');
}
