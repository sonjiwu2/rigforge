import './styles/details.css';
import { getCategory } from './data/catalog.js';
import { icon } from './icons.js';
import { formatMoney, formatPrice, convertFromGbp } from './format.js';
import { getProductDetails, getPriceStats, isAbortError } from './api.js';
import { getSupplementaryInfo } from './enrichment.js';
import { createProductImage } from './assets.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function externalLink(text, href, className = '') {
  const link = el('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function retryButton(onClick) {
  const button = el('button', 'btn btn-secondary btn-sm', 'Повторить');
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

// у snapshot нет предложений магазинов и описания — значит, надо догрузить
function isFullProduct(product) {
  return Array.isArray(product.offers);
}

// '2026-10-30' -> '30.10.2026'
function formatRateDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

export function createDetailsDialog({ getAction, onAction, onGoToBuild, getMoney } = {}) {
  const dialog = el('dialog', 'details-dialog');
  dialog.setAttribute('aria-labelledby', 'details-title');
  dialog.innerHTML = `
    <div class="details-shell">
      <header class="details-head">
        <button type="button" class="details-back" data-close>
          ${icon('chevron-left')}<span class="details-crumbs">Каталог / <span class="details-crumb-cat"></span></span>
        </button>
        <button type="button" class="btn-icon details-close" data-close aria-label="Закрыть сведения о детали">${icon('close')}</button>
      </header>
      <div class="details-scroll">
        <div class="details-photo"></div>
        <div class="details-credit"></div>
        <p class="details-brand"></p>
        <h2 class="details-title" id="details-title"></h2>
        <p class="details-mpn"></p>
        <p class="details-price"></p>
        <p class="details-price-note" hidden></p>
        <div class="details-tabs" role="tablist" aria-label="Сведения о детали">
          <button type="button" role="tab" class="details-tab" id="details-tab-specs" aria-controls="details-panel-specs" aria-selected="true">Характеристики</button>
          <button type="button" role="tab" class="details-tab" id="details-tab-desc" aria-controls="details-panel-desc" aria-selected="false" tabindex="-1">Описание</button>
        </div>
        <div class="details-panel" role="tabpanel" id="details-panel-specs" aria-labelledby="details-tab-specs" tabindex="0">
          <div class="details-specs"></div>
          <p class="details-note">Совместимость не проверена</p>
          <section class="details-section" aria-labelledby="details-stats-title">
            <h3 class="details-subtitle" id="details-stats-title">Цены за 90 дней</h3>
            <div class="details-stats" aria-live="polite"></div>
          </section>
          <section class="details-section" aria-labelledby="details-offers-title">
            <h3 class="details-subtitle" id="details-offers-title">Предложения магазинов</h3>
            <div class="details-offers"></div>
          </section>
        </div>
        <div class="details-panel" role="tabpanel" id="details-panel-desc" aria-labelledby="details-tab-desc" tabindex="0" hidden>
          <div class="details-description"></div>
          <div class="details-series" aria-live="polite"></div>
        </div>
        <p class="details-attribution">
          <a href="https://vantaspec.com" target="_blank" rel="noopener noreferrer">Данные: VantaSpec</a>
        </p>
      </div>
      <footer class="details-actions">
        <button type="button" class="btn details-action"></button>
        <button type="button" class="btn btn-secondary details-go" hidden>К сборке</button>
      </footer>
    </div>
  `;
  document.body.append(dialog);

  const $ = (selector) => dialog.querySelector(selector);
  const parts = {
    crumbCat: $('.details-crumb-cat'),
    photo: $('.details-photo'),
    credit: $('.details-credit'),
    brand: $('.details-brand'),
    title: $('.details-title'),
    mpn: $('.details-mpn'),
    price: $('.details-price'),
    priceNote: $('.details-price-note'),
    tabs: [...dialog.querySelectorAll('[role="tab"]')],
    panels: [$('#details-panel-specs'), $('#details-panel-desc')],
    specs: $('.details-specs'),
    stats: $('.details-stats'),
    offers: $('.details-offers'),
    description: $('.details-description'),
    series: $('.details-series'),
    scroll: $('.details-scroll'),
    action: $('.details-action'),
    goBuild: $('.details-go'),
  };

  // текущий товар и всё, что к нему относится
  let product = null;
  let trigger = null;
  let controller = null;
  let token = 0;
  let seriesRequested = false;
  let photoKey = '';
  let stats = null;

  function money() {
    return (typeof getMoney === 'function' && getMoney()) || null;
  }

  // ---------- шапка, фото, цена ----------

  function renderHeader() {
    const category = getCategory(product.category);
    parts.crumbCat.textContent = category ? category.title : '';
    parts.brand.textContent = product.manufacturer || '';
    parts.brand.hidden = !product.manufacturer;
    parts.title.textContent = product.name || '';

    const key = `${product.provider}:${product.providerId}:${product.category}`;
    let art;
    if (key !== photoKey) {
      photoKey = key;
      const made = createProductImage(product, { large: true });
      art = made.art;
      parts.photo.replaceChildren(made.img);
      parts.photo.classList.toggle('is-placeholder', art.isPlaceholder);
      // фото не загрузилось и заменилось заглушкой — подпись к нему уже не нужна
      made.img.addEventListener('error', () => {
        parts.photo.classList.add('is-placeholder');
        parts.credit.replaceChildren();
      }, { once: true });
      if (art.isPlaceholder) {
        const note = el('span', 'details-nophoto', 'Фото отсутствует');
        note.setAttribute('aria-hidden', 'true');
        parts.photo.append(note);
      }
      renderCredit(art);
    } else {
      art = createProductImage(product).art;
    }

    const mpn = product.mpn || art.mpn;
    parts.mpn.textContent = mpn ? `MPN: ${mpn}` : '';
    parts.mpn.hidden = !mpn;

    renderPrice();
  }

  function renderPrice() {
    parts.price.replaceChildren();
    parts.priceNote.hidden = true;
    if (product.priceMinor === null || product.priceMinor === undefined) {
      parts.price.classList.add('is-unknown');
      parts.price.textContent = 'Цена не указана';
      return;
    }
    parts.price.classList.remove('is-unknown');
    if (product.priceKind === 'from') parts.price.append(el('span', 'details-price-from', 'от '));
    parts.price.append(document.createTextNode(formatPrice(product.priceMinor, money())));

    // цена пересчитана — показываем, по какому курсу и сколько в магазине на самом деле
    const current = money();
    if (convertFromGbp(product.priceMinor, current).currency !== 'GBP') {
      const date = formatRateDate(current.date);
      const rate = date ? `≈ по курсу на ${date}` : '≈ по текущему курсу';
      parts.priceNote.textContent = `${rate}, в магазине ${formatMoney(product.priceMinor, 'GBP')}`;
      parts.priceNote.hidden = false;
    }
  }

  function renderCredit(art) {
    parts.credit.replaceChildren();
    if (art.isPlaceholder) return;
    const box = el('details', 'details-credit-box');
    box.append(el('summary', 'details-credit-toggle', 'Фото и лицензия'));
    const body = el('div', 'details-credit-body');
    if (art.sourceKind === 'vantaspec') {
      body.append(el('p', '', 'Фото: VantaSpec, права у производителя.'));
    } else if (art.attribution) {
      body.append(el('p', '', art.attribution));
    }
    const list = el('dl', 'details-credit-list');
    const rows = [
      ['Автор', art.creator],
      ['Лицензия', art.sourceKind === 'vantaspec' ? null : art.rightsStatus],
    ];
    for (const [term, value] of rows) {
      if (!value) continue;
      list.append(el('dt', '', term), el('dd', '', value));
    }
    body.append(list);
    const links = el('p', 'details-credit-links');
    if (art.sourceUrl && isHttpUrl(art.sourceUrl)) {
      links.append(externalLink(art.sourceKind === 'vantaspec' ? 'Страница товара на VantaSpec' : 'Источник фото', art.sourceUrl));
    }
    if (art.licenseUrl && isHttpUrl(art.licenseUrl)) links.append(externalLink('Лицензия', art.licenseUrl));
    if (art.licenseFileUrl) links.append(externalLink('Текст лицензии', art.licenseFileUrl));
    body.append(links);
    box.append(body);
    parts.credit.append(box);
  }

  // ---------- характеристики и предложения ----------

  function renderSpecs() {
    parts.specs.replaceChildren();
    const specs = product.specs || [];
    if (!specs.length) {
      parts.specs.append(el('p', 'details-muted', 'Характеристики не указаны'));
      return;
    }
    const list = el('dl', 'details-spec-list');
    for (const spec of specs) {
      const row = el('div', 'details-spec-row');
      row.append(el('dt', '', spec.label || spec.key), el('dd', '', spec.value));
      list.append(row);
    }
    parts.specs.append(list);
  }

  function renderOffers() {
    parts.offers.replaceChildren();
    if (!isFullProduct(product)) {
      parts.offers.append(el('p', 'details-muted', 'Загрузка…'));
      return;
    }
    const offers = [...product.offers].sort((a, b) => (a.priceMinor ?? Infinity) - (b.priceMinor ?? Infinity));
    if (!offers.length) {
      parts.offers.append(el('p', 'details-muted', 'Магазины не указаны'));
      return;
    }
    const list = el('ul', 'details-offer-list');
    for (const offer of offers) {
      const item = el('li', 'details-offer');
      item.append(el('span', 'details-offer-shop', offer.retailer || 'Магазин'));
      // цены магазинов в фунтах, пересчитываем в выбранную валюту
      const offerPrice = offer.currency && offer.currency !== 'GBP'
        ? formatMoney(offer.priceMinor, offer.currency)
        : formatPrice(offer.priceMinor, money());
      item.append(el('span', 'details-offer-price', offerPrice));
      if (offer.url && isHttpUrl(offer.url)) {
        const link = externalLink('В магазин', offer.url, 'link details-offer-link');
        link.append(el('span', 'visually-hidden', ` ${offer.retailer || ''} (откроется в новой вкладке)`));
        item.append(link);
      }
      list.append(item);
    }
    parts.offers.append(list);
    if (product.priceAsOf) {
      const date = new Date(product.priceAsOf);
      if (!Number.isNaN(date.getTime())) {
        const text = date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        parts.offers.append(el('p', 'details-muted details-asof', `Цены загружены ${text}`));
      }
    }
  }

  function showDetailsError() {
    parts.offers.replaceChildren(
      el('p', 'details-muted', 'Не удалось загрузить полные сведения о детали'),
      retryButton(() => loadDetails(token))
    );
  }

  async function loadDetails(myToken) {
    renderOffers();
    try {
      const full = await getProductDetails(product, { signal: controller.signal });
      if (myToken !== token || !full) return;
      product = full;
      renderHeader();
      renderSpecs();
      renderOffers();
      renderDescription();
      updateAction();
    } catch (error) {
      if (myToken !== token || isAbortError(error)) return;
      showDetailsError();
    }
  }

  // ---------- статистика цен ----------

  function renderStats() {
    if (!stats) return;
    const current = money();
    const rows = [
      ['Минимум сейчас', formatPrice(stats.currentLowestMinor, current)],
      ['Минимум за период', formatPrice(stats.lowestEverMinor, current)],
      ['Средняя', formatPrice(stats.averageMinor, current)],
      ['Магазинов', stats.retailerCount ?? 'Не указано'],
    ];
    const list = el('dl', 'details-stat-list');
    for (const [term, value] of rows) {
      const row = el('div', 'details-stat');
      row.append(el('dt', '', term), el('dd', '', String(value)));
      list.append(row);
    }
    parts.stats.replaceChildren(list);
  }

  async function loadStats(myToken) {
    stats = null;
    parts.stats.replaceChildren(el('p', 'details-muted', 'Загрузка…'));
    try {
      const result = await getPriceStats(product, { signal: controller.signal });
      if (myToken !== token) return;
      stats = result;
      renderStats();
    } catch (error) {
      if (myToken !== token || isAbortError(error)) return;
      parts.stats.replaceChildren(
        el('p', 'details-muted', 'Не удалось загрузить статистику цен'),
        retryButton(() => loadStats(token))
      );
    }
  }

  // ---------- описание и «О серии» ----------

  function renderDescription() {
    parts.description.replaceChildren();
    if (product.description) {
      const text = el('p', 'details-text', product.description);
      text.lang = 'en';
      parts.description.append(text);
    } else if (isFullProduct(product)) {
      parts.description.append(el('p', 'details-muted', 'Описание модели не указано'));
    } else {
      parts.description.append(el('p', 'details-muted', 'Загрузка…'));
    }
  }

  async function loadSeries(myToken) {
    seriesRequested = true;
    parts.series.replaceChildren(el('p', 'details-muted', 'Загрузка…'));
    try {
      const info = await getSupplementaryInfo(product, { signal: controller.signal });
      if (myToken !== token) return;
      if (!info) {
        parts.series.replaceChildren();
        return;
      }
      const box = el('section', 'details-series-box');
      box.setAttribute('aria-labelledby', 'details-series-title');
      const head = el('h3', 'details-subtitle', 'О серии');
      head.id = 'details-series-title';
      box.append(head);
      if (info.title) box.append(el('p', 'details-series-name', info.title));
      // абзацы в extract разделены переводом строки
      for (const paragraph of String(info.extract || '').split(/\n+/)) {
        if (!paragraph.trim()) continue;
        const text = el('p', 'details-text', paragraph.trim());
        text.lang = info.lang || 'en';
        box.append(text);
      }
      const source = el('p', 'details-series-source');
      source.append(document.createTextNode('Источник: Wikipedia (англ.), CC BY-SA 4.0. '));
      if (info.url && isHttpUrl(info.url)) source.append(externalLink('Открыть статью', info.url, 'link'));
      box.append(source);
      box.append(el('p', 'details-muted', 'Сведения о серии в целом, а не о конкретной модели.'));
      parts.series.replaceChildren(box);
    } catch (error) {
      if (myToken !== token || isAbortError(error)) return;
      const box = el('div', 'details-series-error');
      box.append(
        el('p', 'details-series-error-title', 'Дополнительное описание недоступно'),
        el('p', 'details-muted', 'Характеристики детали доступны.'),
        retryButton(() => loadSeries(token))
      );
      parts.series.replaceChildren(box);
    }
  }

  // ---------- вкладки ----------

  function selectTab(index, focus) {
    parts.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      parts.panels[i].hidden = !selected;
    });
    if (focus) parts.tabs[index].focus();
    // Wikipedia запрашиваем только когда открыли «Описание»
    if (index === 1 && !seriesRequested && product) loadSeries(token);
  }

  parts.tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index, false));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % parts.tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + parts.tabs.length) % parts.tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = parts.tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectTab(next, true);
    });
  });

  // ---------- нижняя кнопка ----------

  let actionDone = false;

  function updateAction() {
    const action = (typeof getAction === 'function' && getAction(product)) || { label: 'В сборку', inBuild: false, disabled: false };
    const button = parts.action;
    button.replaceChildren();
    button.classList.toggle('btn-primary', !action.inBuild);
    button.classList.toggle('is-in-build', !!action.inBuild);
    if (action.inBuild) {
      button.innerHTML = icon('check');
      button.append(el('span', '', 'В сборке'));
      button.setAttribute('aria-disabled', 'true');
      button.disabled = false;
    } else {
      button.append(el('span', '', action.label || 'В сборку'));
      button.removeAttribute('aria-disabled');
      button.disabled = !!action.disabled;
    }
    parts.goBuild.hidden = !(actionDone || action.inBuild);
  }

  parts.action.addEventListener('click', async () => {
    if (!product || parts.action.getAttribute('aria-disabled') === 'true') return;
    const current = product;
    parts.action.setAttribute('aria-busy', 'true');
    try {
      if (typeof onAction === 'function') await onAction(current);
    } finally {
      parts.action.removeAttribute('aria-busy');
    }
    if (current !== product || !dialog.open) return;
    actionDone = true;
    updateAction();
    // фокус переводим на «К сборке», чтобы он не потерялся
    parts.goBuild.focus();
  });

  parts.goBuild.addEventListener('click', () => {
    trigger = null; // уходим на другую страницу — фокус вернёт main.js
    close();
    if (typeof onGoToBuild === 'function') onGoToBuild();
  });

  // ---------- открытие и закрытие ----------

  function open(nextProduct, nextTrigger) {
    if (!nextProduct) return;
    if (controller) controller.abort();
    controller = new AbortController();
    token += 1;
    const myToken = token;

    product = nextProduct;
    if (nextTrigger) trigger = nextTrigger;
    else if (!dialog.open) trigger = document.activeElement;
    seriesRequested = false;
    actionDone = false;
    photoKey = '';

    renderHeader();
    renderSpecs();
    renderDescription();
    parts.series.replaceChildren();
    updateAction();
    selectTab(0, false);
    parts.scroll.scrollTop = 0;

    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.details-close').focus();

    if (isFullProduct(product)) renderOffers();
    else loadDetails(myToken);
    loadStats(myToken);
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  // и крестик, и стрелка назад закрывают окно
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
    // клик по затемнённому фону
    else if (event.target === dialog) close();
  });

  dialog.addEventListener('close', () => {
    if (controller) controller.abort();
    controller = null;
    token += 1;
    const back = trigger;
    trigger = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  });

  function destroy() {
    close();
    dialog.remove();
  }

  // обновить кнопку и цены, если сборка или валюта поменялись снаружи
  function refresh() {
    if (!dialog.open || !product) return;
    updateAction();
    renderPrice();
    renderStats();
    if (isFullProduct(product)) renderOffers();
  }

  return { open, close, destroy, refresh };
}
