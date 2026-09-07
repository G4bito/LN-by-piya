import { NAIL_ART_ADD_ON } from './constants/services.js';
import { DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS } from './businessSettings.js';

export function clampNailQuantity(value, maximum = 10) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 1;
  const normalizedMaximum = Math.min(10, Math.max(1, Number.parseInt(maximum, 10) || 10));
  return Math.min(normalizedMaximum, Math.max(1, quantity));
}

export function serviceRequiresNailQuantity(service) {
  return service?.pricingUnit === 'nail';
}

export function serviceSupportsNailArt(service, settings = {}) {
  const configuredIds = Array.isArray(settings.nailArtEligibleServiceIds)
    ? settings.nailArtEligibleServiceIds
    : DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS;
  return Boolean(service?.id && service.nailArtEligible && configuredIds.includes(service.id));
}

export function calculateBaseServiceTotal(service, quantity = 1) {
  const unitPrice = Number(service?.price) || 0;
  return serviceRequiresNailQuantity(service)
    ? unitPrice * clampNailQuantity(quantity)
    : unitPrice;
}

export function normalizeNailArtSelection(service, nailArt = {}, settings = {}) {
  const supportsNailArt = settings.allowSavedSelection === true
    ? Boolean(service?.nailArtEligible)
    : serviceSupportsNailArt(service, settings);
  const enabled = supportsNailArt && nailArt?.enabled === true;
  const maximumQuantity = Number(settings.maximumNailArtQuantity) || 10;
  const quantity = enabled ? clampNailQuantity(nailArt?.quantity, maximumQuantity) : 0;
  const configuredPrice = Number(settings.nailArtPricePerNail);
  const savedPrice = Number(nailArt?.pricePerNail);
  const pricePerNail = Number.isFinite(configuredPrice) && configuredPrice >= 0
    ? configuredPrice
    : Number.isFinite(savedPrice) && savedPrice >= 0
      ? savedPrice
      : NAIL_ART_ADD_ON.pricePerNail;

  return {
    enabled,
    pricePerNail,
    quantity,
    total: enabled ? pricePerNail * quantity : 0,
  };
}

export function createServicePricingFields(service, quantity = 1, nailArtSelection = {}, settings = {}) {
  if (!service) {
    return {
      serviceName: '',
      basePrice: 0,
      baseTotal: 0,
      nailArt: normalizeNailArtSelection(null, {}, settings),
      estimatedTotal: 0,
      totalPrice: 0,
    };
  }

  const baseQuantity = serviceRequiresNailQuantity(service) ? clampNailQuantity(quantity) : 1;
  const baseTotal = calculateBaseServiceTotal(service, baseQuantity);
  const nailArt = normalizeNailArtSelection(service, nailArtSelection, settings);
  const estimatedTotal = baseTotal + nailArt.total;

  return {
    serviceName: service.title,
    basePrice: Number(service.price) || 0,
    baseTotal,
    ...(serviceRequiresNailQuantity(service) ? {
      nailQuantity: baseQuantity,
      pricePerNail: Number(service.price) || 0,
      repairNailsCount: service.id === 'repair' ? baseQuantity : undefined,
    } : {}),
    nailArt,
    estimatedTotal,
    totalPrice: estimatedTotal,
  };
}

export function createServiceBookingSelection(service, quantity = 1, options = {}) {
  if (!service) return null;

  return {
    ...service,
    ...createServicePricingFields(service, quantity, options.nailArt, options.settings),
    referenceImageUrl: options.referenceImageUrl || '',
    skipServiceStep: options.skipServiceStep !== false,
  };
}

export function getBookingNailQuantity(booking) {
  if (!booking || booking.service !== 'repair') return null;
  const value = booking.nailQuantity ?? booking.repairNailsCount;
  return value ? clampNailQuantity(value) : null;
}

export function getBookingNailArt(booking, service) {
  const source = booking?.nailArt && typeof booking.nailArt === 'object'
    ? booking.nailArt
    : {
        enabled: booking?.nailArtEnabled === true,
        quantity: booking?.nailArtQuantity,
      };
  return normalizeNailArtSelection(service, source, {
    allowSavedSelection: true,
    nailArtPricePerNail: source?.pricePerNail,
    maximumNailArtQuantity: 10,
  });
}
