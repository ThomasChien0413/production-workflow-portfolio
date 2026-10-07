/** Canonical empty form values may contain nested blank row objects. */
export function containsOnlyBlankValues(value) {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.every(containsOnlyBlankValues);
  if (typeof value === "object") return Object.values(value).every(containsOnlyBlankValues);
  return false;
}
