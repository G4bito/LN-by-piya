import test from 'node:test';
import assert from 'node:assert/strict';
import { NAIL_ART_ADD_ON, SERVICES } from '../src/constants/services.js';
import {
  calculateBaseServiceTotal,
  createServiceBookingSelection,
  createServicePricingFields,
  getBookingNailArt,
  getBookingNailQuantity,
  serviceRequiresNailQuantity,
  serviceSupportsNailArt,
} from '../src/bookingPricing.js';

test('Nail Art is an add-on priced at 49 pesos and is not a standalone service', () => {
  assert.equal(NAIL_ART_ADD_ON.pricePerNail, 49);
  assert.equal(SERVICES.some((service) => service.title === 'Nail Art'), false);
  assert.deepEqual(
    SERVICES.filter(serviceSupportsNailArt).map((service) => service.id),
    ['gel-manicure', 'biab-structured-gel', 'soft-gel-extensions']
  );
});

test('Gel Manicure with Nail Art on five nails totals 544 pesos', () => {
  const gelManicure = SERVICES.find((service) => service.id === 'gel-manicure');
  const pricing = createServicePricingFields(gelManicure, 1, { enabled: true, quantity: 5 });

  assert.equal(serviceSupportsNailArt(gelManicure), true);
  assert.equal(pricing.basePrice, 299);
  assert.deepEqual(pricing.nailArt, {
    enabled: true,
    pricePerNail: 49,
    quantity: 5,
    total: 245,
  });
  assert.equal(pricing.estimatedTotal, 544);
  assert.equal(pricing.totalPrice, 544);
});

test('booking selection preserves customization and reference image fields', () => {
  const gelManicure = SERVICES.find((service) => service.id === 'gel-manicure');
  const selection = createServiceBookingSelection(gelManicure, 1, {
    nailArt: { enabled: true, quantity: 5 },
    referenceImageUrl: 'https://example.com/reference.jpg',
  });

  assert.equal(selection.id, 'gel-manicure');
  assert.equal(selection.serviceName, 'Gel Manicure');
  assert.equal(selection.referenceImageUrl, 'https://example.com/reference.jpg');
  assert.equal(selection.nailArt.quantity, 5);
  assert.equal(selection.nailArt.total, 245);
  assert.equal(selection.estimatedTotal, 544);
  assert.equal(selection.skipServiceStep, true);
});

test('eligible services without Nail Art keep only the base price', () => {
  const gelManicure = SERVICES.find((service) => service.id === 'gel-manicure');
  const pricing = createServicePricingFields(gelManicure, 1, { enabled: false, quantity: 10 });

  assert.deepEqual(pricing.nailArt, {
    enabled: false,
    pricePerNail: 49,
    quantity: 0,
    total: 0,
  });
  assert.equal(pricing.estimatedTotal, 299);
});

test('noneligible services cannot receive the Nail Art add-on', () => {
  const gelRemoval = SERVICES.find((service) => service.id === 'gel-removal');
  const pricing = createServicePricingFields(gelRemoval, 1, { enabled: true, quantity: 5 });

  assert.equal(serviceSupportsNailArt(gelRemoval), false);
  assert.equal(pricing.nailArt.enabled, false);
  assert.equal(pricing.nailArt.total, 0);
  assert.equal(pricing.estimatedTotal, 99);
});

test('Repair remains a per-nail base service and carries its own quantity', () => {
  const repair = SERVICES.find((service) => service.id === 'repair');
  const selection = createServiceBookingSelection(repair, 5);

  assert.equal(serviceRequiresNailQuantity(repair), true);
  assert.equal(calculateBaseServiceTotal(repair, 5), 245);
  assert.equal(selection.nailQuantity, 5);
  assert.equal(selection.repairNailsCount, 5);
  assert.equal(selection.estimatedTotal, 245);
  assert.equal(selection.nailArt.enabled, false);
});

test('booking history preserves the Nail Art rate charged when the booking was created', () => {
  const gelManicure = SERVICES.find((service) => service.id === 'gel-manicure');
  const nailArt = getBookingNailArt({
    service: 'gel-manicure',
    nailArt: { enabled: true, quantity: 5, pricePerNail: 75, total: 375 },
  }, gelManicure);

  assert.deepEqual(nailArt, {
    enabled: true,
    pricePerNail: 75,
    quantity: 5,
    total: 375,
  });
  assert.equal(getBookingNailQuantity({ service: 'repair', nailQuantity: 8 }), 8);
  assert.equal(getBookingNailQuantity({ service: 'gel-manicure', nailQuantity: 8 }), null);
});

test('configured Nail Art price, quantity, and eligible services drive booking totals', () => {
  const gel = SERVICES.find((service) => service.id === 'gel-manicure');
  const settings = {
    nailArtPricePerNail: 59,
    maximumNailArtQuantity: 5,
    nailArtEligibleServiceIds: ['gel-manicure'],
  };
  const pricing = createServicePricingFields(gel, 1, { enabled: true, quantity: 8 }, settings);

  assert.equal(pricing.nailArt.pricePerNail, 59);
  assert.equal(pricing.nailArt.quantity, 5);
  assert.equal(pricing.nailArt.total, 295);
  assert.equal(pricing.estimatedTotal, gel.price + 295);
});
