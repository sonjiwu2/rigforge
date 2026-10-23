// Форматирование цен и чисел. Все суммы в приложении хранятся в пенсах (целые числа).

const formatters = new Map();

function getFormatter(currency) {
  if (!formatters.has(currency)) {
    formatters.set(
      currency,
      new Intl.NumberFormat('en-GB', { style: 'currency', currency })
    );
  }
  return formatters.get(currency);
}

export function formatMoney(priceMinor, currency = 'GBP') {
  if (priceMinor === null || priceMinor === undefined || !Number.isFinite(priceMinor)) {
    return 'Цена не указана';
  }
  const code = currency || 'GBP';
  try {
    return getFormatter(code).format(priceMinor / 100);
  } catch {
    // неизвестный код валюты
    return `${(priceMinor / 100).toFixed(2)} ${code}`;
  }
}

// '1200', '1200.5', '1 200,50', '£1,200.00' -> пенсы. Всё остальное -> null.
export function parseMoneyInput(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).replace(/[£\s  ]/g, '');
  if (s === '' || s.includes('-')) return null;

  // запятая — десятичный разделитель, только если после неё 1–2 цифры в конце и точки нет
  const lastComma = s.lastIndexOf(',');
  if (lastComma !== -1 && !s.includes('.') && /^,\d{1,2}$/.test(s.slice(lastComma))) {
    s = s.slice(0, lastComma) + '.' + s.slice(lastComma + 1);
  }

  // остальные запятые — разделители тысяч, группы строго по 3 цифры
  const match = s.match(/^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/);
  if (!match) return null;
  const intPart = match[1].replace(/,/g, '');
  const fracPart = match[2] || '';
  if (intPart === '' && fracPart === '') return null;

  // округляем по строке, без сложения дробных чисел
  const pounds = Number(intPart || '0');
  const pence = Number((fracPart + '00').slice(0, 2));
  const roundUp = fracPart.length > 2 && Number(fracPart[2]) >= 5 ? 1 : 0;
  const result = pounds * 100 + pence + roundUp;
  return Number.isSafeInteger(result) ? result : null;
}

// pluralRu(5, ['деталь', 'детали', 'деталей']) -> 'деталей'
export function pluralRu(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
