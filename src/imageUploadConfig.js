export const BYTES_PER_MEGABYTE = 1024 * 1024;
export const MAX_PORTFOLIO_IMAGE_SIZE = 8 * BYTES_PER_MEGABYTE;
export const MAX_REFERENCE_PHOTO_SIZE = 5 * BYTES_PER_MEGABYTE;
export const ALLOWED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const IMAGE_UPLOAD_CONFIG = Object.freeze({
  portfolio: Object.freeze({
    maxBytes: MAX_PORTFOLIO_IMAGE_SIZE,
    tooLargeMessage: 'Image is too large. Portfolio images must be 8 MB or smaller.',
  }),
  'portfolio-thumbnails': Object.freeze({
    maxBytes: MAX_PORTFOLIO_IMAGE_SIZE,
    tooLargeMessage: 'Image is too large. Portfolio images must be 8 MB or smaller.',
  }),
  'booking-references': Object.freeze({
    maxBytes: MAX_REFERENCE_PHOTO_SIZE,
    tooLargeMessage: 'Image is too large. Reference photos must be 5 MB or smaller.',
  }),
});

export function getImageUploadConfig(folder) {
  return IMAGE_UPLOAD_CONFIG[folder] || null;
}

export function getImageFileValidationError(file, folder) {
  if (!file) return 'Please choose a photo file.';

  const config = getImageUploadConfig(folder);
  if (!config) return 'This image upload destination is not supported.';

  if (!ALLOWED_IMAGE_TYPES.includes(String(file.type || '').toLowerCase())) {
    return 'Please upload a JPG, PNG, or WebP image.';
  }

  if (!Number.isFinite(Number(file.size)) || Number(file.size) < 0) {
    return 'The selected image could not be read. Please choose another image.';
  }

  if (Number(file.size) > config.maxBytes) return config.tooLargeMessage;
  return '';
}

export function formatFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size >= BYTES_PER_MEGABYTE) {
    return `${(size / BYTES_PER_MEGABYTE).toFixed(size >= 10 * BYTES_PER_MEGABYTE ? 0 : 1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
