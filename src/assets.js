// Фото деталей: сначала проверенные фото из manifest (Wikimedia Commons),
// потом фото из VantaSpec по ссылке, иначе — нейтральная картинка категории.
import manifest from './data/assets-manifest.json';

const PLACEHOLDER_ALT = 'Фотография модели отсутствует';

// ssd и hdd используют одну картинку «накопитель»
const PLACEHOLDER_KEYS = {
  cpu: 'cpu',
  motherboard: 'motherboard',
  gpu: 'gpu',
  ram: 'ram',
  ssd: 'storage',
  hdd: 'storage',
  psu: 'psu',
  case: 'case',
  cooler: 'cooler',
};

// Пути manifest лежат относительно public/, к ним добавляем BASE_URL.
// Внешние ссылки оставляем как есть.
function localUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
}

function findAsset(product) {
  if (!product || !product.provider || !product.providerId) return null;
  return (
    manifest.productAssets.find(
      (asset) => asset.provider === product.provider && asset.providerId === product.providerId
    ) || null
  );
}

export function getPlaceholderSrc(categoryId) {
  const key = PLACEHOLDER_KEYS[categoryId];
  return key ? localUrl(manifest.placeholders[key]) : '';
}

// Фото VantaSpec берём только с их CDN и только по https
function isVantaspecImage(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'cdn.vantaspec.com';
  } catch {
    return false;
  }
}

function productPageUrl(product) {
  if (product.sourceUrl) return product.sourceUrl;
  if (product.slug) return `https://vantaspec.com/products/${encodeURIComponent(product.slug)}`;
  return 'https://vantaspec.com';
}

function productTitle(product) {
  const brand = product.manufacturer || '';
  const model = product.model || '';
  if (!model) return product.name || brand;
  // в некоторых моделях бренд уже есть в начале
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  return `${brand} ${model}`.trim();
}

export function getProductArtwork(product) {
  const asset = findAsset(product);
  const category = product ? product.category : null;

  if (asset) {
    return {
      src: localUrl(asset.image),
      alt: productTitle(product),
      width: asset.width,
      height: asset.height,
      gallery: (asset.galleryDimensions || []).map((item) => ({
        src: localUrl(item.path),
        width: item.width,
        height: item.height,
      })),
      isPlaceholder: false,
      sourceKind: asset.sourceKind || 'commons',
      fallbackSrc: localUrl(asset.fallback) || getPlaceholderSrc(category),
      mpn: asset.mpn || null,
      creator: asset.creator || null,
      rightsStatus: asset.rightsStatus || null,
      attribution: asset.attribution || null,
      licenseUrl: asset.licenseUrl || null,
      licensePath: asset.licensePath || null,
      licenseFileUrl: localUrl(asset.licensePath),
      sourceUrl: asset.sourceUrl || null,
    };
  }

  if (product && isVantaspecImage(product.imageUrl)) {
    return {
      src: product.imageUrl,
      alt: productTitle(product),
      // настоящий размер заранее неизвестен, у VantaSpec фото примерно 3:2
      width: 600,
      height: 400,
      gallery: [],
      isPlaceholder: false,
      sourceKind: 'vantaspec',
      fallbackSrc: getPlaceholderSrc(category),
      mpn: null,
      creator: null,
      rightsStatus: 'права у производителя',
      attribution: 'Фото: VantaSpec',
      licenseUrl: null,
      licensePath: null,
      licenseFileUrl: '',
      sourceUrl: productPageUrl(product),
    };
  }

  return {
    src: getPlaceholderSrc(category),
    alt: PLACEHOLDER_ALT,
    width: 128,
    height: 128,
    gallery: [],
    isPlaceholder: true,
    sourceKind: null,
    fallbackSrc: '',
    mpn: null,
    creator: null,
    rightsStatus: null,
    attribution: null,
    licenseUrl: null,
    licensePath: null,
    licenseFileUrl: '',
    sourceUrl: null,
  };
}

// Если фото не загрузилось — один раз меняем на заглушку, без зацикливания
export function applyImageFallback(img, fallbackSrc) {
  if (!img || !fallbackSrc) return;
  img.addEventListener(
    'error',
    () => {
      img.src = fallbackSrc;
      img.alt = PLACEHOLDER_ALT;
      img.classList.add('is-placeholder');
    },
    { once: true }
  );
}

// Готовый <img> для карточки/диалога. large = взять крупный вариант из gallery
export function createProductImage(product, { large = false, className = '' } = {}) {
  const art = getProductArtwork(product);
  const img = document.createElement('img');
  if (className) img.className = className;
  if (art.isPlaceholder) img.classList.add('is-placeholder');

  let src = art.src;
  let width = art.width;
  let height = art.height;
  if (large && art.gallery.length) {
    src = art.gallery[0].src;
    width = art.gallery[0].width;
    height = art.gallery[0].height;
  }

  img.alt = art.alt;
  img.width = width;
  img.height = height;
  img.decoding = 'async';
  // чужому CDN адрес нашей страницы не передаём
  img.referrerPolicy = 'no-referrer';
  if (!large) img.loading = 'lazy';
  applyImageFallback(img, art.fallbackSrc);
  if (src) img.src = src;
  return { img, art };
}
