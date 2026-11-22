// Reference photos use private RTDB details, not a billable Storage bucket.
const photoError = (message) => Object.assign(new Error(message), { code: 'booking/reference-photo' });
export async function encodeReferencePhoto(file) {
  if (!file) return '';
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw photoError('Choose a JPG, PNG, or WebP photo smaller than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 960 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw photoError('This browser cannot prepare the reference photo. Please try a smaller JPG.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4, 0.25]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 260000) return data;
    }
    throw photoError('Please choose a smaller or simpler reference photo.');
  } catch (error) {
    if (error.code === 'booking/reference-photo') throw error;
    throw photoError('This photo could not be prepared. Please choose another JPG, PNG, or WebP.');
  } finally { URL.revokeObjectURL(url); }
}
