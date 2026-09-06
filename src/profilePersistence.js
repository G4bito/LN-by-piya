export function mergeProfileData(currentProfile = {}, incomingProfile = {}) {
  const normalizedCurrent = currentProfile && typeof currentProfile === 'object' ? currentProfile : {};
  const normalizedIncoming = incomingProfile && typeof incomingProfile === 'object' ? incomingProfile : {};

  const merged = {
    ...normalizedCurrent,
    ...normalizedIncoming,
  };

  const incomingFullName = normalizedIncoming.fullName || normalizedIncoming.name || '';
  const currentFullName = normalizedCurrent.fullName || normalizedCurrent.name || '';
  if (incomingFullName && normalizedIncoming.fullName !== undefined) {
    merged.fullName = normalizedIncoming.fullName;
    merged.name = normalizedIncoming.name || normalizedIncoming.fullName;
  } else if (incomingFullName && currentFullName) {
    merged.fullName = incomingFullName;
    merged.name = normalizedIncoming.name || incomingFullName;
  }

  if (normalizedIncoming.phone !== undefined) {
    merged.phone = normalizedIncoming.phone;
  }

  if (!merged.updatedAt) {
    merged.updatedAt = normalizedIncoming.updatedAt || normalizedCurrent.updatedAt || new Date().toISOString();
  }

  return merged;
}
