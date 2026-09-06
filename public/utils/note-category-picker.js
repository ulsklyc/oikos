/**
 * Pure helpers for the note-category autocomplete.
 * Search is forgiving (case and accents), while exact identity preserves
 * accents so client-side duplicate prevention follows the server contract.
 */

export function categoryIdentityKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase().toLowerCase()
    .toUpperCase().toLowerCase()
    .normalize('NFKC');
}

function identityKey(value) {
  return categoryIdentityKey(String(value ?? '').trim());
}

function searchKey(value) {
  return identityKey(value).normalize('NFD').replace(/\p{M}/gu, '');
}

export function findCategorySuggestions(categories, selectedIds, query, limit = 8) {
  const selected = new Set((selectedIds || []).map(Number));
  const needle = searchKey(query);
  return (categories || [])
    .filter((category) => !selected.has(Number(category.id)))
    .filter((category) => !needle || searchKey(category.name).includes(needle))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function findExactCategory(categories, query, scope = null) {
  const needle = identityKey(query);
  if (!needle) return null;
  return (categories || []).find((category) => (
    (!scope || category.scope === scope) && identityKey(category.name) === needle
  )) || null;
}

export function categoryCreationState(categories, query, scope, canChooseScope) {
  const canCreate = !!String(query ?? '').trim()
    && !findExactCategory(categories, query, scope);
  return {
    canCreate,
    // Authorized users must be able to switch scope even when the current
    // scope already contains this name; the other scope may not contain it.
    showControls: !!canChooseScope || canCreate,
  };
}
