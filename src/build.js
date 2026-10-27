import './styles/build.css';
import { CATEGORIES, getCategory } from './data/catalog.js';
import { formatMoney, parseMoneyInput, pluralRu } from './format.js';
import { icon } from './icons.js';

// пустую сборку создаёт storage.js (он не должен тянуть за собой стили и разметку)
export { createEmptyBuild } from './storage.js';

const NAME_MAX = 80;
const DETAIL_FORMS = ['деталь', 'детали', 'деталей'];
const DETAIL_FORMS_GENITIVE = ['детали', 'деталей', 'деталей'];
const POSITION_FORMS = ['позиция', 'позиции', 'позиций'];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function countText(n, forms) {
  return `${n} ${pluralRu(n, forms)}`;
}

// Итог считаем только в целых пенсах. Неизвестная цена не превращается в ноль,
// а детали в разных валютах не складываем.
export function calculateBuildTotals(build) {
  let count = 0;
  let unknownCount = 0;
  let knownTotalMinor = 0;
  const currencies = new Set();

  for (const category of CATEGORIES) {
    const part = build?.slots?.[category.id];
    if (!part) continue;
    count++;
    if (Number.isSafeInteger(part.priceMinor)) {
      knownTotalMinor += part.priceMinor;
      currencies.add(part.currency || build.currency || 'GBP');
    } else {
      unknownCount++;
    }
  }

  const mixedCurrencies = currencies.size > 1;
  return {
    count,
    knownTotalMinor: mixedCurrencies ? null : knownTotalMinor,
    unknownCount,
    currency: mixedCurrencies ? null : ([...currencies][0] || build?.currency || 'GBP'),
    mixedCurrencies,
  };
}

// Подсказки по бюджету: остаток или превышение. Пока сумма неполная — остаток не считаем.
function getBudgetInfo(build, totals) {
  if (build.budgetMinor === null || build.budgetMinor === undefined) return { kind: 'none' };
  if (totals.mixedCurrencies || totals.unknownCount > 0) return { kind: 'incomplete' };
  if (totals.currency !== build.currency) return { kind: 'incomplete' };
  const diff = build.budgetMinor - totals.knownTotalMinor;
  const percent = Math.min(100, Math.max(0, Math.round((totals.knownTotalMinor / build.budgetMinor) * 100)));
  return diff >= 0 ? { kind: 'left', diff, percent } : { kind: 'over', diff: -diff, percent: 100 };
}

function partArtwork(part, callbacks, category) {
  const art = callbacks.getArtwork?.(part);
  if (art && art.src && art.isPlaceholder === false) {
    return `<img src="${escapeHtml(art.src)}" alt="${escapeHtml(art.alt || part.name)}" loading="lazy" decoding="async">`;
  }
  return icon(category.icon);
}

function partSpecs(part) {
  const specs = (part.specs || []).slice(0, 2);
  if (!specs.length) return '';
  const text = specs.map((spec) => `${spec.label}: ${spec.value}`).join(' · ');
  return `<p class="build-row-specs">${escapeHtml(text)}</p>`;
}

function filledRow(category, part, callbacks) {
  const name = escapeHtml(part.name);
  const hasPrice = Number.isSafeInteger(part.priceMinor);
  const price = hasPrice
    ? `<p class="build-row-price">${escapeHtml(formatMoney(part.priceMinor, part.currency))}</p>`
    : '<p class="build-row-price build-row-price-unknown">Цена не указана</p>';
  return `
    <li class="build-row" data-slot="${category.id}">
      <button class="build-row-art" type="button" tabindex="-1" aria-hidden="true" data-action="details">
        ${partArtwork(part, callbacks, category)}
      </button>
      <div class="build-row-info">
        <p class="build-row-category">${escapeHtml(category.slotTitle)}</p>
        <h3 class="build-row-name">
          <button class="build-row-name-btn" type="button" data-action="details" data-focus="name">${name}</button>
        </h3>
        ${partSpecs(part)}
      </div>
      <div class="build-row-price-box">
        ${price}
        <button class="link build-row-more" type="button" data-action="details" data-focus="more">Подробнее<span class="visually-hidden">: ${name}</span></button>
      </div>
      <button class="btn btn-secondary btn-sm build-row-replace" type="button" data-action="replace" data-focus="replace">Заменить<span class="visually-hidden"> ${escapeHtml(category.accusative)}</span></button>
      <button class="btn-icon build-row-remove" type="button" data-action="remove" data-focus="remove" aria-label="Убрать ${name}">${icon('close')}</button>
    </li>`;
}

function emptyRow(category) {
  return `
    <li class="build-row build-row-empty" data-slot="${category.id}">
      <span class="build-row-art">${icon(category.icon)}</span>
      <div class="build-row-info">
        <p class="build-row-category">${escapeHtml(category.slotTitle)}</p>
        <p class="build-row-none">Не выбрано</p>
      </div>
      <button class="btn btn-secondary btn-sm build-row-choose" type="button" data-action="choose" data-focus="choose">Выбрать<span class="visually-hidden"> ${escapeHtml(category.accusative)}</span></button>
    </li>`;
}

function createSkeleton(container) {
  container.innerHTML = `
    <div class="page build-page">
      <div class="page-head build-head">
        <h1 class="visually-hidden">Сборка</h1>
        <div class="build-name">
          <label class="build-name-label" for="build-name-input">Название сборки</label>
          <input class="build-name-input" id="build-name-input" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" aria-describedby="build-name-error">
          <p class="field-error" id="build-name-error" hidden></p>
        </div>
        <button class="btn btn-secondary build-new" type="button">${icon('plus')}<span>Новая сборка</span></button>
      </div>

      <div class="build-storage-warning" role="status" hidden></div>

      <div class="build-layout">
        <div class="build-side">
          <section class="build-summary" aria-labelledby="build-summary-title">
            <h2 class="build-summary-title" id="build-summary-title">Стоимость</h2>
            <p class="build-summary-count"></p>
            <div class="build-summary-total"></div>
            <div class="build-budget">
              <div class="build-budget-row">
                <label class="build-budget-label" for="build-budget-input">Бюджет</label>
                <input class="build-budget-input" id="build-budget-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Не задан" aria-describedby="build-budget-error build-budget-status">
              </div>
              <p class="build-budget-error" id="build-budget-error" hidden></p>
              <div class="build-progress" aria-hidden="true" hidden><span class="build-progress-bar"></span></div>
              <div class="build-budget-status" id="build-budget-status"></div>
            </div>
            <button class="btn btn-light build-save" type="button">Сохранить сборку</button>
            <button class="build-download" type="button">${icon('download')}<span>Скачать список</span></button>
          </section>
          <p class="build-note">${icon('info')}<span>Совместимость не проверена. Сверьте требования деталей перед покупкой.</span></p>
        </div>

        <section class="panel build-parts" aria-labelledby="build-parts-title">
          <div class="build-parts-head">
            <h2 class="build-parts-title" id="build-parts-title">Комплектующие</h2>
            <p class="build-parts-count"></p>
          </div>
          <ul class="build-list" role="list"></ul>
        </section>
      </div>
    </div>`;

  const refs = {
    nameInput: container.querySelector('.build-name-input'),
    nameError: container.querySelector('#build-name-error'),
    newButton: container.querySelector('.build-new'),
    warning: container.querySelector('.build-storage-warning'),
    count: container.querySelector('.build-summary-count'),
    total: container.querySelector('.build-summary-total'),
    budgetInput: container.querySelector('.build-budget-input'),
    budgetError: container.querySelector('#build-budget-error'),
    progress: container.querySelector('.build-progress'),
    progressBar: container.querySelector('.build-progress-bar'),
    budgetStatus: container.querySelector('.build-budget-status'),
    saveButton: container.querySelector('.build-save'),
    downloadButton: container.querySelector('.build-download'),
    partsCount: container.querySelector('.build-parts-count'),
    list: container.querySelector('.build-list'),
    callbacks: {},
    state: null,
  };

  // обработчики вешаем один раз, а свежие callbacks/state берём из refs
  refs.nameInput.addEventListener('change', () => commitName(refs));
  refs.nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitName(refs);
    } else if (event.key === 'Escape') {
      refs.nameInput.value = refs.state.build.name;
      showError(refs.nameInput, refs.nameError, '');
    }
  });

  refs.budgetInput.addEventListener('change', () => commitBudget(refs));
  refs.budgetInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitBudget(refs);
    }
  });
  refs.budgetInput.addEventListener('blur', () => {
    if (refs.budgetError.hidden) fillBudgetInput(refs);
  });

  refs.newButton.addEventListener('click', () => refs.callbacks.onNewBuild?.());
  refs.saveButton.addEventListener('click', () => refs.callbacks.onSave?.());
  refs.downloadButton.addEventListener('click', () => refs.callbacks.onDownload?.());

  refs.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const slotId = button.closest('.build-row')?.dataset.slot;
    const part = refs.state.build.slots[slotId];
    const action = button.dataset.action;
    if (action === 'details' && part) {
      // фокус потом вернётся на название, даже если кликнули по фото
      const trigger = button.classList.contains('build-row-art')
        ? button.closest('.build-row').querySelector('.build-row-name-btn')
        : button;
      refs.callbacks.onOpenDetails?.(part, trigger);
    } else if (action === 'replace') {
      refs.callbacks.onReplace?.(slotId);
    } else if (action === 'remove') {
      refs.callbacks.onRemove?.(slotId);
    } else if (action === 'choose') {
      refs.callbacks.onChoose?.(slotId);
    }
  });

  return refs;
}

function showError(input, errorEl, text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
  if (text) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function commitName(refs) {
  const name = refs.nameInput.value.trim();
  if (!name) {
    showError(refs.nameInput, refs.nameError, 'Введите название сборки');
    return;
  }
  if (name.length > NAME_MAX) {
    showError(refs.nameInput, refs.nameError, `Название не длиннее ${NAME_MAX} символов`);
    return;
  }
  showError(refs.nameInput, refs.nameError, '');
  refs.nameInput.value = name;
  if (name !== refs.state.build.name) refs.callbacks.onRenameBuild?.(name);
}

function commitBudget(refs) {
  const text = refs.budgetInput.value.trim();
  if (text === '') {
    showError(refs.budgetInput, refs.budgetError, '');
    if (refs.state.build.budgetMinor !== null) refs.callbacks.onBudgetChange?.(null);
    return;
  }
  const value = parseMoneyInput(text);
  if (value === null || value <= 0) {
    showError(refs.budgetInput, refs.budgetError, 'Введите сумму больше нуля');
    return;
  }
  showError(refs.budgetInput, refs.budgetError, '');
  if (value !== refs.state.build.budgetMinor) refs.callbacks.onBudgetChange?.(value);
}

function fillBudgetInput(refs) {
  const budget = refs.state.build.budgetMinor;
  refs.budgetInput.value = budget === null || budget === undefined ? '' : formatMoney(budget, refs.state.build.currency);
}

function renderSummary(refs, build, totals) {
  refs.count.textContent = totals.count
    ? `Выбрано ${countText(totals.count, DETAIL_FORMS)}`
    : 'Детали пока не выбраны';

  if (totals.mixedCurrencies) {
    refs.total.innerHTML = `
      <p class="build-total-label">Стоимость известных позиций</p>
      <p class="build-total-mixed">Цены в разных валютах — общую сумму не считаем</p>`;
  } else {
    const label = totals.unknownCount > 0 ? '<p class="build-total-label">Стоимость известных позиций</p>' : '';
    const missing = totals.unknownCount > 0
      ? `<p class="build-total-missing">Для ${countText(totals.unknownCount, DETAIL_FORMS_GENITIVE)} цена не указана</p>`
      : '';
    refs.total.innerHTML = `
      ${label}
      <p class="build-total-value">${escapeHtml(formatMoney(totals.knownTotalMinor, totals.currency))}</p>
      ${missing}`;
  }

  const budget = getBudgetInfo(build, totals);
  refs.progress.hidden = budget.kind !== 'left' && budget.kind !== 'over';
  refs.progressBar.style.width = `${budget.percent ?? 0}%`;
  refs.progress.classList.toggle('is-over', budget.kind === 'over');

  if (budget.kind === 'none') {
    refs.budgetStatus.innerHTML = '<p class="build-budget-hint">Укажите бюджет</p>';
  } else if (budget.kind === 'incomplete') {
    refs.budgetStatus.innerHTML = '<p class="build-budget-hint">Остаток появится, когда у всех деталей будет цена</p>';
  } else if (budget.kind === 'left') {
    refs.budgetStatus.innerHTML = `<p class="build-budget-left">Остаётся ${escapeHtml(formatMoney(budget.diff, build.currency))}</p>`;
  } else {
    refs.budgetStatus.innerHTML = `
      <p class="build-budget-over">${icon('warning')}<span>Бюджет превышен на ${escapeHtml(formatMoney(budget.diff, build.currency))}</span></p>`;
  }
}

// Запоминаем, на какой кнопке строки был фокус, чтобы вернуть его после перерисовки
function rememberFocus(list) {
  const active = document.activeElement;
  if (!active || !list.contains(active)) return null;
  return { slot: active.closest('.build-row')?.dataset.slot, focus: active.dataset.focus };
}

function restoreFocus(list, saved) {
  if (!saved) return;
  const row = list.querySelector(`.build-row[data-slot="${saved.slot}"]`);
  if (!row) return;
  // после удаления детали кнопки «Убрать» уже нет — переводим фокус на «Выбрать»
  const target = row.querySelector(`[data-focus="${saved.focus}"]`) || row.querySelector('[data-focus]');
  target?.focus();
}

export function renderBuild(container, state, callbacks = {}) {
  if (!container._buildRefs || !container.contains(container._buildRefs.list)) {
    container._buildRefs = createSkeleton(container);
  }
  const refs = container._buildRefs;
  refs.callbacks = callbacks;
  refs.state = state;

  const build = state.build;
  const totals = calculateBuildTotals(build);

  // открыли другую сборку — старые ошибки ввода больше не нужны
  if (refs.buildId !== build.id) {
    refs.buildId = build.id;
    showError(refs.nameInput, refs.nameError, '');
    showError(refs.budgetInput, refs.budgetError, '');
  }

  // поля ввода не трогаем, пока пользователь в них печатает
  if (document.activeElement !== refs.nameInput && refs.nameError.hidden) {
    refs.nameInput.value = build.name;
  }
  if (document.activeElement !== refs.budgetInput && refs.budgetError.hidden) {
    fillBudgetInput(refs);
  }

  refs.warning.hidden = !state.storageWarning;
  refs.warning.innerHTML = state.storageWarning
    ? `${icon('warning')}<span>${escapeHtml(state.storageWarning)}</span>`
    : '';

  renderSummary(refs, build, totals);
  refs.partsCount.textContent = countText(totals.count, POSITION_FORMS);

  const focus = rememberFocus(refs.list);
  refs.list.innerHTML = CATEGORIES.map((category) => {
    const part = build.slots[category.id];
    return part ? filledRow(getCategory(category.id), part, callbacks) : emptyRow(category);
  }).join('');
  restoreFocus(refs.list, focus);
}
