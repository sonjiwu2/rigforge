import '../../styles/views/saved.css';
import { CATEGORIES } from '../../data/catalog.js';
import { icon } from '../../components/icons.js';
import {
  calculateBuildTotals, countText, escapeHtml, formatRateDate, getDisplayCurrency, handleImageError, priceText,
} from '../build/view.js';

const NAME_MAX = 80;
const SEARCH_FROM = 4; // поиск нужен, только если сборок больше трёх
const BUILD_FORMS = ['сборка', 'сборки', 'сборок'];
const DETAIL_FORMS = ['деталь', 'детали', 'деталей'];
const DETAIL_FORMS_GENITIVE = ['детали', 'деталей', 'деталей'];
const KEY_SLOTS = ['cpu', 'gpu', 'ram'];

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function normalize(text) {
  return String(text).toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
}

// Какие детали показать в превью: сначала процессор, видеокарта, память, потом остальные
function keyParts(build) {
  const order = [...KEY_SLOTS, ...CATEGORIES.map((c) => c.id).filter((id) => !KEY_SLOTS.includes(id))];
  const parts = [];
  for (const id of order) {
    if (build.slots[id]) parts.push({ category: CATEGORIES.find((c) => c.id === id), part: build.slots[id] });
    if (parts.length === 3) break;
  }
  return parts;
}

function tile({ category, part }, callbacks) {
  const art = callbacks.getArtwork?.(part);
  const fallback = art?.fallbackSrc ? ` data-fallback="${escapeHtml(art.fallbackSrc)}"` : '';
  const inner = art && art.src && art.isPlaceholder === false
    ? `<img src="${escapeHtml(art.src)}" alt=""${fallback} referrerpolicy="no-referrer" loading="lazy" decoding="async">`
    : icon(category.icon);
  return `<span class="saved-tile" data-slot="${category.id}">${inner}</span>`;
}

// Итог считаем в пенсах, в выбранную валюту переводим только готовую сумму
function totalsBlock(build, money) {
  const totals = calculateBuildTotals(build);
  let total;
  if (totals.mixedCurrencies) {
    total = '<span class="saved-card-sum saved-card-sum-note">Цены в разных валютах</span>';
  } else {
    total = `<span class="saved-card-sum">${escapeHtml(priceText(totals.knownTotalMinor, totals.currency, money))}</span>`;
  }
  const missing = totals.unknownCount > 0
    ? `<p class="saved-card-missing">Сумма известных позиций. Для ${countText(totals.unknownCount, DETAIL_FORMS_GENITIVE)} цена не указана</p>`
    : '';
  return `
    <div class="saved-card-total">
      <span class="saved-card-count">${countText(totals.count, DETAIL_FORMS)}</span>
      ${total}
    </div>
    ${missing}`;
}

function renameForm(build, ui, index) {
  const error = ui.renameError;
  return `
    <form class="saved-rename" novalidate>
      <label class="field-label" for="saved-rename-${index}">Название сборки</label>
      <input class="input" id="saved-rename-${index}" type="text" maxlength="${NAME_MAX}" autocomplete="off"
        value="${escapeHtml(ui.renameDraft)}" data-focus="rename-input"
        aria-describedby="saved-rename-error-${index}" ${error ? 'aria-invalid="true"' : ''}>
      <p class="field-error" id="saved-rename-error-${index}" ${error ? '' : 'hidden'}>${escapeHtml(error)}</p>
      <div class="saved-rename-actions">
        <button class="btn btn-primary btn-sm" type="submit" data-focus="rename-save">Сохранить</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="rename-cancel" data-focus="rename-cancel">Отмена</button>
      </div>
    </form>`;
}

function card(build, index, state, ui, callbacks) {
  const name = escapeHtml(build.name);
  const parts = keyParts(build);
  const isRenaming = ui.renameId === build.id;
  const savedAt = new Date(build.savedAt);

  const head = isRenaming
    ? renameForm(build, ui, index)
    : `<h2 class="saved-card-name" id="saved-name-${index}">${name}</h2>`;

  const tiles = parts.length
    ? `<div class="saved-card-tiles" aria-hidden="true">${parts.map((item) => tile(item, callbacks)).join('')}</div>`
    : '<p class="saved-card-empty">Детали не выбраны</p>';

  const rows = parts.length
    ? `<dl class="saved-card-parts">${parts.map(({ category, part }) => `
        <div class="saved-card-part"><dt>${escapeHtml(category.slotTitle)}</dt><dd>${escapeHtml(part.name)}</dd></div>`).join('')}
      </dl>`
    : '';

  const current = state.currentSavedId === build.id
    ? `<p class="saved-card-current">${icon('check')}<span>Открыта на вкладке «Сборка»</span></p>`
    : '';

  return `
    <article class="saved-card" data-id="${escapeHtml(build.id)}" aria-labelledby="saved-name-${index}">
      <div class="saved-card-head">
        ${head}
        <div class="saved-menu-wrap">
          <button class="btn-icon saved-menu-btn" type="button" data-action="menu" data-focus="menu"
            aria-haspopup="menu" aria-expanded="false" aria-controls="saved-menu-${index}"
            aria-label="Действия со сборкой «${name}»" ${isRenaming ? 'hidden' : ''}>${icon('more')}</button>
          <ul class="saved-menu" id="saved-menu-${index}" role="menu" aria-label="Действия со сборкой «${name}»" hidden>
            <li role="none"><button type="button" role="menuitem" tabindex="-1" data-action="rename">${icon('edit')}<span>Переименовать</span></button></li>
            <li role="none"><button type="button" role="menuitem" tabindex="-1" data-action="duplicate">${icon('copy')}<span>Дублировать</span></button></li>
            <li role="none"><button type="button" role="menuitem" tabindex="-1" data-action="download">${icon('download')}<span>Скачать список</span></button></li>
            <li role="none"><button type="button" role="menuitem" tabindex="-1" data-action="delete" class="saved-menu-danger">${icon('trash')}<span>Удалить</span></button></li>
          </ul>
        </div>
      </div>
      ${isRenaming ? `<h2 class="visually-hidden" id="saved-name-${index}">${name}</h2>` : ''}
      ${current}
      ${tiles}
      ${rows}
      <div class="saved-card-foot">
        ${totalsBlock(build, state.money)}
        <p class="saved-card-date">Сохранено <time datetime="${escapeHtml(build.savedAt)}">${escapeHtml(dateFormat.format(savedAt))}</time></p>
        <button class="btn btn-primary saved-open" type="button" data-action="open" data-focus="open">Открыть сборку<span class="visually-hidden"> «${name}»</span></button>
      </div>
    </article>`;
}

function createSkeleton(container) {
  container.innerHTML = `
    <div class="page saved-page">
      <div class="page-head saved-head">
        <div class="saved-head-text">
          <h1 class="page-title saved-title" tabindex="-1">Сохранённые сборки</h1>
          <p class="page-sub saved-count"></p>
          <p class="saved-rate-note" hidden></p>
        </div>
        <button class="btn btn-secondary saved-new" type="button">${icon('plus')}<span>Новая сборка</span></button>
      </div>

      <div class="saved-warning" role="status" hidden></div>

      <div class="field saved-search" hidden>
        <label class="field-label" for="saved-search-input">Поиск по названию</label>
        <div class="saved-search-box">
          ${icon('search')}
          <input class="input" id="saved-search-input" type="search" autocomplete="off" placeholder="Например, «Для работы»">
        </div>
      </div>

      <div class="saved-content"></div>

      <aside class="saved-note" aria-label="Где хранятся сборки">
        <div class="saved-note-text">
          <p class="saved-note-title">Сборки хранятся в этом браузере</p>
          <p>Скачайте список, чтобы сохранить копию.</p>
        </div>
        <button class="btn btn-secondary saved-download-all" type="button" hidden>${icon('download')}<span>Скачать все (JSON)</span></button>
      </aside>
    </div>`;

  const refs = {
    title: container.querySelector('.saved-title'),
    count: container.querySelector('.saved-count'),
    rateNote: container.querySelector('.saved-rate-note'),
    warning: container.querySelector('.saved-warning'),
    search: container.querySelector('.saved-search'),
    searchInput: container.querySelector('#saved-search-input'),
    content: container.querySelector('.saved-content'),
    downloadAll: container.querySelector('.saved-download-all'),
    newButton: container.querySelector('.saved-new'),
    state: null,
    callbacks: {},
    ui: { query: '', renameId: null, renameDraft: '', renameError: '', pendingFocus: null },
    openMenu: null,
  };

  refs.newButton.addEventListener('click', () => refs.callbacks.onNewBuild?.());
  refs.downloadAll.addEventListener('click', () => refs.callbacks.onDownloadAll?.());

  refs.searchInput.addEventListener('input', () => {
    refs.ui.query = refs.searchInput.value;
    renderContent(refs);
  });

  refs.content.addEventListener('click', (event) => onContentClick(refs, event));
  refs.content.addEventListener('error', (event) => {
    handleImageError(event, (holder) => {
      const category = CATEGORIES.find((item) => item.id === holder.dataset.slot);
      return category ? icon(category.icon) : '';
    });
  }, true);
  refs.content.addEventListener('keydown', (event) => onContentKeydown(refs, event));
  refs.content.addEventListener('submit', (event) => {
    event.preventDefault();
    submitRename(refs);
  });
  refs.content.addEventListener('input', (event) => {
    if (event.target.dataset.focus === 'rename-input') refs.ui.renameDraft = event.target.value;
  });

  // клик мимо открытого меню закрывает его
  document.addEventListener('pointerdown', (event) => {
    if (refs.openMenu && !refs.openMenu.wrap.contains(event.target)) closeMenu(refs, false);
  });

  return refs;
}

function goToBuild(refs) {
  if (refs.callbacks.onGoToBuild) refs.callbacks.onGoToBuild();
  else location.hash = '#build';
}

/* ---------- Меню «Действия со сборкой» ---------- */

function openMenu(refs, wrap) {
  if (refs.openMenu) closeMenu(refs, false);
  const button = wrap.querySelector('.saved-menu-btn');
  const menu = wrap.querySelector('.saved-menu');
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  refs.openMenu = { wrap, button, menu };
  menu.querySelector('[role="menuitem"]').focus();
}

function closeMenu(refs, returnFocus) {
  if (!refs.openMenu) return;
  const { button, menu } = refs.openMenu;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  refs.openMenu = null;
  if (returnFocus) button.focus();
}

function moveInMenu(menu, step) {
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const index = items.indexOf(document.activeElement);
  if (step === 'first') items[0].focus();
  else if (step === 'last') items[items.length - 1].focus();
  else items[(index + step + items.length) % items.length].focus();
}

function onContentKeydown(refs, event) {
  const target = event.target;

  if (target.classList.contains('saved-menu-btn') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    openMenu(refs, target.closest('.saved-menu-wrap'));
    if (event.key === 'ArrowUp') moveInMenu(refs.openMenu.menu, 'last');
    return;
  }

  if (target.getAttribute('role') === 'menuitem' && refs.openMenu) {
    const menu = refs.openMenu.menu;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveInMenu(menu, 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveInMenu(menu, -1); }
    else if (event.key === 'Home') { event.preventDefault(); moveInMenu(menu, 'first'); }
    else if (event.key === 'End') { event.preventDefault(); moveInMenu(menu, 'last'); }
    else if (event.key === 'Escape') { event.preventDefault(); closeMenu(refs, true); }
    else if (event.key === 'Tab') closeMenu(refs, false);
    return;
  }

  if (target.dataset.focus === 'rename-input' && event.key === 'Escape') {
    event.preventDefault();
    cancelRename(refs);
  }
}

/* ---------- Действия ---------- */

function onContentClick(refs, event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.closest('.saved-card')?.dataset.id;
  const callbacks = refs.callbacks;

  if (action === 'go-build') return goToBuild(refs);
  if (action === 'clear-search') {
    refs.ui.query = '';
    refs.searchInput.value = '';
    renderContent(refs);
    refs.searchInput.focus();
    return;
  }
  if (action === 'menu') {
    const wrap = button.closest('.saved-menu-wrap');
    if (refs.openMenu?.wrap === wrap) closeMenu(refs, true);
    else openMenu(refs, wrap);
    return;
  }
  if (action === 'open') return callbacks.onOpenSaved?.(id);
  if (action === 'rename-cancel') return cancelRename(refs);

  // дальше — пункты меню: сначала закрываем меню и возвращаем фокус на кнопку
  closeMenu(refs, true);
  const build = refs.state.saved.find((item) => item.id === id);
  if (!build) return;

  if (action === 'rename') {
    refs.ui.renameId = id;
    refs.ui.renameDraft = build.name;
    refs.ui.renameError = '';
    renderContent(refs);
    const input = refs.content.querySelector('[data-focus="rename-input"]');
    input?.focus();
    input?.select();
  } else if (action === 'duplicate') {
    callbacks.onDuplicateSaved?.(id);
  } else if (action === 'download') {
    callbacks.onDownloadSaved?.(id);
  } else if (action === 'delete') {
    deleteBuild(refs, id);
  }
}

function deleteBuild(refs, id) {
  // фокус после удаления: следующая карточка, иначе предыдущая, иначе заголовок
  const cards = [...refs.content.querySelectorAll('.saved-card')];
  const index = cards.findIndex((item) => item.dataset.id === id);
  const neighbour = cards[index + 1] || cards[index - 1];
  refs.ui.pendingFocus = { deletedId: id, nextId: neighbour?.dataset.id || null };
  refs.callbacks.onDeleteSaved?.(id);
  applyPendingFocus(refs);
}

function applyPendingFocus(refs) {
  const pending = refs.ui.pendingFocus;
  if (!pending) return;
  const stillThere = refs.state.saved.some((item) => item.id === pending.deletedId);
  const cardOnPage = refs.content.querySelector(`.saved-card[data-id="${CSS.escape(pending.deletedId)}"]`);
  if (stillThere && cardOnPage) return; // main.js ещё не перерисовал — подождём следующего вызова
  refs.ui.pendingFocus = null;
  if (stillThere) return; // удаление отменили
  const next = pending.nextId && refs.content.querySelector(`.saved-card[data-id="${CSS.escape(pending.nextId)}"] .saved-open`);
  (next || refs.title).focus();
}

function cancelRename(refs) {
  const id = refs.ui.renameId;
  refs.ui.renameId = null;
  refs.ui.renameError = '';
  renderContent(refs);
  focusInCard(refs, id, 'menu');
}

function submitRename(refs) {
  const id = refs.ui.renameId;
  const input = refs.content.querySelector('[data-focus="rename-input"]');
  if (!id || !input) return;
  const name = input.value.trim();
  if (!name || name.length > NAME_MAX) {
    refs.ui.renameDraft = input.value;
    refs.ui.renameError = name ? `Название не длиннее ${NAME_MAX} символов` : 'Введите название сборки';
    renderContent(refs);
    refs.content.querySelector('[data-focus="rename-input"]')?.focus();
    return;
  }
  refs.ui.renameId = null;
  refs.ui.renameError = '';
  refs.callbacks.onRenameSaved?.(id, name);
  // если main.js перерисовал страницу сам — форма уже закрыта, иначе закрываем её здесь
  if (refs.content.querySelector('.saved-rename')) renderContent(refs);
  focusInCard(refs, id, 'menu');
}

function focusInCard(refs, id, focus) {
  if (!id) return;
  refs.content.querySelector(`.saved-card[data-id="${CSS.escape(id)}"] [data-focus="${focus}"]`)?.focus();
}

/* ---------- Отрисовка ---------- */

function renderContent(refs) {
  const { state, ui, callbacks } = refs;
  const saved = state.saved || [];

  // запоминаем фокус внутри карточек, чтобы вернуть его после перерисовки
  const active = document.activeElement;
  let focus = null;
  if (active && refs.content.contains(active)) {
    focus = { id: active.closest('.saved-card')?.dataset.id, key: active.dataset.focus };
  }
  refs.openMenu = null;

  if (ui.renameId && !saved.some((item) => item.id === ui.renameId)) ui.renameId = null;

  if (!saved.length) {
    refs.content.innerHTML = `
      <div class="state state-empty saved-empty">
        <h2 class="state-title">Пока нет сохранённых сборок</h2>
        <p class="state-text">Сохраните первый вариант на вкладке «Сборка».</p>
        <button class="btn btn-secondary" type="button" data-action="go-build">К сборке</button>
      </div>`;
    return;
  }

  const query = normalize(ui.query);
  const visible = query ? saved.filter((item) => normalize(item.name).includes(query)) : saved;

  if (!visible.length) {
    refs.content.innerHTML = `
      <div class="state state-empty saved-empty">
        <h2 class="state-title">Ничего не найдено</h2>
        <p class="state-text">Нет сборок с таким названием.</p>
        <button class="btn btn-secondary" type="button" data-action="clear-search">Очистить поиск</button>
      </div>`;
    return;
  }

  refs.content.innerHTML = `
    <ul class="saved-grid" role="list">
      ${visible.map((build, index) => `<li>${card(build, index, state, ui, callbacks)}</li>`).join('')}
    </ul>`;

  if (focus?.id && focus.key) focusInCard(refs, focus.id, focus.key);
}

export function renderSaved(container, state, callbacks = {}) {
  if (!container._savedRefs || !container.contains(container._savedRefs.content)) {
    container._savedRefs = createSkeleton(container);
  }
  const refs = container._savedRefs;
  refs.state = state;
  refs.callbacks = callbacks;

  const saved = state.saved || [];
  refs.count.textContent = saved.length ? countText(saved.length, BUILD_FORMS) : '';
  refs.count.hidden = !saved.length;

  // цены сохранены в фунтах, при другой валюте пишем, по какому курсу пересчитали
  const converted = saved.length > 0 && getDisplayCurrency(state.money) !== 'GBP';
  const date = converted ? formatRateDate(state.money.date) : null;
  refs.rateNote.textContent = converted ? `Суммы пересчитаны по курсу ${date ? 'на ' + date : 'на сегодня'}` : '';
  refs.rateNote.hidden = !converted;

  refs.warning.hidden = !state.storageWarning;
  refs.warning.innerHTML = state.storageWarning
    ? `${icon('warning')}<span>${escapeHtml(state.storageWarning)}</span>`
    : '';

  const showSearch = saved.length >= SEARCH_FROM;
  refs.search.hidden = !showSearch;
  if (!showSearch && refs.ui.query) {
    refs.ui.query = '';
    refs.searchInput.value = '';
  }

  refs.downloadAll.hidden = !saved.length;
  // в пустом состоянии остаётся одна кнопка — «К сборке»
  refs.newButton.hidden = !saved.length;

  renderContent(refs);
  applyPendingFocus(refs);
}
