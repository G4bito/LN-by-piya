import { createServiceBookingSelection, serviceSupportsNailArt } from './bookingPricing.js';
import { SERVICES } from './constants/services.js';

const EMPTY_VALUES = new Set(['n/a', 'na', 'null', 'undefined']);
const LEGACY_STYLE_CATEGORIES = new Set([
  'cat eye',
  'chrome',
  'floral',
  'french',
  'french ombre',
  'french tips',
  'glitter',
  'minimalist',
  'ombre',
  'specialty',
]);

export function cleanPortfolioValue(value) {
  if (value === null || value === undefined) return '';
  const cleaned = String(value).trim();
  return !cleaned || EMPTY_VALUES.has(cleaned.toLowerCase()) ? '' : cleaned;
}

export function getPortfolioImage(item) {
  return cleanPortfolioValue(item?.image || item?.imageUrl || item?.url);
}

export function getPortfolioThumbnail(item) {
  return cleanPortfolioValue(item?.thumbnail || item?.thumbnailUrl) || getPortfolioImage(item);
}

function findEligibleService(value) {
  const normalized = cleanPortfolioValue(value).toLowerCase();
  if (!normalized) return null;
  return SERVICES.find((service) => (
    serviceSupportsNailArt(service) &&
    (service.id.toLowerCase() === normalized || service.title.toLowerCase() === normalized)
  )) || null;
}

export function resolvePortfolioService(item) {
  const candidates = [item?.serviceId, item?.service, item?.serviceName, item?.serviceCategory, item?.category];

  for (const candidate of candidates) {
    const exactMatch = findEligibleService(candidate);
    if (exactMatch) return exactMatch;
  }

  const searchable = candidates.map(cleanPortfolioValue).join(' ').toLowerCase();
  if (searchable.includes('biab') || searchable.includes('builder')) {
    return SERVICES.find((service) => service.id === 'biab-structured-gel');
  }
  if (searchable.includes('extension')) {
    return SERVICES.find((service) => service.id === 'soft-gel-extensions');
  }
  return SERVICES.find((service) => service.id === 'gel-manicure');
}

export function normalizePortfolioItem(item = {}) {
  const explicitService = cleanPortfolioValue(item.serviceName || item.serviceCategory || item.service);
  const exactService = findEligibleService(item.serviceId || explicitService);
  const savedCategory = cleanPortfolioValue(item.category);
  const categoryService = findEligibleService(savedCategory);
  const categoryIsLegacyStyle = LEGACY_STYLE_CATEGORIES.has(savedCategory.toLowerCase());
  const resolvedService = resolvePortfolioService(item);

  return {
    ...item,
    id: item.id,
    title: cleanPortfolioValue(item.title || item.name) || 'Nail Set',
    image: getPortfolioImage(item),
    category: exactService?.title || explicitService || categoryService?.title || (categoryIsLegacyStyle ? resolvedService?.title : savedCategory),
    style: cleanPortfolioValue(item.style || item.designType || item.design) || (categoryIsLegacyStyle ? savedCategory : ''),
    description: cleanPortfolioValue(item.description || item.details),
    shape: cleanPortfolioValue(item.shape || item.nailShape),
    length: cleanPortfolioValue(item.length || item.nailLength),
    finish: cleanPortfolioValue(item.finish),
  };
}

export function createPortfolioBookingSelection(item) {
  const service = resolvePortfolioService(item);
  if (!service) return null;

  return {
    ...createServiceBookingSelection(service, 1, {
      nailArt: { enabled: false, quantity: 1 },
      referenceImageUrl: getPortfolioImage(item),
      skipServiceStep: false,
    }),
    openCustomization: serviceSupportsNailArt(service),
    portfolioItemId: item?.id || null,
  };
}
