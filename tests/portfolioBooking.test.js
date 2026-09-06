import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPortfolioValue,
  createPortfolioBookingSelection,
  getPortfolioThumbnail,
  normalizePortfolioItem,
  resolvePortfolioService,
} from '../src/portfolioBooking.js';

test('portfolio details use available Firebase fields and hide empty sentinel values', () => {
  const item = normalizePortfolioItem({
    id: 'look-1',
    name: 'French Ombre',
    serviceName: 'Gel Manicure',
    designType: 'French Tips',
    description: 'Soft nude base with clean white tips.',
    imageUrl: 'https://example.com/french-ombre.jpg',
    shape: 'Square',
    length: null,
    finish: 'N/A',
  });

  assert.equal(item.title, 'French Ombre');
  assert.equal(item.category, 'Gel Manicure');
  assert.equal(item.style, 'French Tips');
  assert.equal(item.image, 'https://example.com/french-ombre.jpg');
  assert.equal(item.shape, 'Square');
  assert.equal(item.length, '');
  assert.equal(item.finish, '');
  assert.equal(cleanPortfolioValue('undefined'), '');
});

test('portfolio cards prefer a lightweight thumbnail while keeping legacy images compatible', () => {
  assert.equal(getPortfolioThumbnail({
    image: 'https://example.com/full.webp',
    thumbnail: 'https://example.com/thumb.webp',
  }), 'https://example.com/thumb.webp');
  assert.equal(getPortfolioThumbnail({ image: 'https://example.com/legacy.jpg' }), 'https://example.com/legacy.jpg');
});

test('Book This Look carries the gallery image into the existing Gel Manicure booking state', () => {
  const selection = createPortfolioBookingSelection({
    id: 'look-2',
    title: 'Classic French Gel',
    category: 'Gel Manicure',
    image: 'https://example.com/classic-french.jpg',
  });

  assert.equal(selection.id, 'gel-manicure');
  assert.equal(selection.referenceImageUrl, 'https://example.com/classic-french.jpg');
  assert.equal(selection.nailArt.enabled, false);
  assert.equal(selection.openCustomization, true);
  assert.equal(selection.skipServiceStep, false);
  assert.equal(selection.portfolioItemId, 'look-2');
});

test('extension and BIAB gallery categories map to their matching base services', () => {
  assert.equal(resolvePortfolioService({ category: 'Extensions' }).id, 'soft-gel-extensions');
  assert.equal(resolvePortfolioService({ category: 'BIAB Gel' }).id, 'biab-structured-gel');
  assert.equal(resolvePortfolioService({ category: 'French Ombre' }).id, 'gel-manicure');
});

test('legacy style categories display as style while using a real service category', () => {
  const item = normalizePortfolioItem({ title: 'Marble Chrome', category: 'Ombre' });

  assert.equal(item.category, 'Gel Manicure');
  assert.equal(item.style, 'Ombre');
});
