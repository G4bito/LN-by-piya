import { NAIL_ART_ADD_ON } from './constants/services.js';

export function clampNailQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(10, Math.max(1, quantity));
}

export function serviceRequiresNailQuantity(service) {
  return service?.pricingUnit === 'nail';
}

export function serviceSupportsNailArt(service) {
  return Boolean(service?.nailArtEligible);
}

export function calculateBaseServiceTotal(service, quantity = 1) {
  const unitPrice = Number(service?.price) || 0;
  return serviceRequiresNailQuantity(service)
    ? unitPrice * clampNailQuantity(quantity)
    : unitPrice;
}

export function normalizeNailArtSelection(service, nailArt = {}) {
  const enabled = serviceSupportsNailArt(service) && nailArt?.enabled === true;
  const quantity = enabled ? clampNailQuantity(nailArt?.quantity) : 0;
  const pricePerNail = NAIL_ART_ADD_ON.pricePerNail;

  return {
    enabled,
    pricePerNail,
    quantity,
    total: enabled ? pricePerNail * quantity : 0,
  };
}

export function createServicePricingFields(service, quantity = 1, nailArtSelection = {}) {
  if (!service) {
    return {
      serviceName: '',
      basePrice: 0,
      baseTotal: 0,
      nailArt: normalizeNailArtSelection(null),
      estimatedTotal: 0,
      totalPrice: 0,
    };
  }

  const baseQuantity = serviceRequiresNailQuantity(service) ? clampNailQuantity(quantity) : 1;
  const baseTotal = calculateBaseServiceTotal(service, baseQuantity);
  const nailArt = normalizeNailArtSelection(service, nailArtSelection);
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
    ...createServicePricingFields(service, quantity, options.nailArt),
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
  return normalizeNailArtSelection(service, source);
}
