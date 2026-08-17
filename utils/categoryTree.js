const categories = require('../data/categories.json');

const byId = new Map(categories.map((c) => [c.id, c]));

/**
 * Builds the full breadcrumb path for a category, e.g.
 * "תוספי תזונה > מינרלים > מגנזיום"
 */
function getPath(id) {
  const parts = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && guard < 10) {
    parts.unshift(current.name);
    if (!current.parent || current.parent === 0) break;
    current = byId.get(current.parent);
    guard++;
  }
  return parts.join(' > ');
}

/**
 * Returns every category enriched with its full path, skipping the
 * meaningless "Uncategorized" bucket (id 15) since it's never a useful
 * classification target.
 */
function getClassifiableCategories() {
  return categories
    .filter((c) => c.name !== 'Uncategorized')
    .map((c) => ({ ...c, path: getPath(c.id) }));
}

function getCategoryById(id) {
  const c = byId.get(id);
  if (!c) return null;
  return { ...c, path: getPath(id) };
}

module.exports = { getPath, getClassifiableCategories, getCategoryById, byId };
