import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PORTFOLIO_IMAGE_SIZE,
  MAX_REFERENCE_PHOTO_SIZE,
  formatFileSize,
  getImageFileValidationError,
} from '../src/imageUploadConfig.js';

const image = (size, type = 'image/jpeg') => ({ size, type });

test('Portfolio accepts supported images through 8 MB and rejects larger files', () => {
  assert.equal(getImageFileValidationError(image(2 * 1024 * 1024), 'portfolio'), '');
  assert.equal(getImageFileValidationError(image(7.5 * 1024 * 1024, 'image/png'), 'portfolio'), '');
  assert.equal(getImageFileValidationError(image(MAX_PORTFOLIO_IMAGE_SIZE, 'image/webp'), 'portfolio'), '');
  assert.match(
    getImageFileValidationError(image(8.5 * 1024 * 1024), 'portfolio'),
    /Portfolio images must be 8 MB or smaller/
  );
});

test('booking references use the separate 5 MB maximum', () => {
  assert.equal(getImageFileValidationError(image(4.9 * 1024 * 1024), 'booking-references'), '');
  assert.equal(getImageFileValidationError(image(MAX_REFERENCE_PHOTO_SIZE), 'booking-references'), '');
  assert.match(
    getImageFileValidationError(image(5.5 * 1024 * 1024), 'booking-references'),
    /Reference photos must be 5 MB or smaller/
  );
});

test('only intended raster image MIME types are accepted', () => {
  ['application/pdf', 'image/svg+xml', 'text/html', 'application/zip'].forEach((type) => {
    assert.match(getImageFileValidationError(image(1024, type), 'portfolio'), /JPG, PNG, or WebP/);
  });
  assert.equal(getImageFileValidationError(image(1024, 'image/jpg'), 'portfolio'), '');
});

test('file sizes are formatted without exposing raw byte counts', () => {
  assert.equal(formatFileSize(2.4 * 1024 * 1024), '2.4 MB');
  assert.equal(formatFileSize(512 * 1024), '512 KB');
});
