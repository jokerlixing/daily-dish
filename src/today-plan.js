(function (root) {
  'use strict';

  const slots = Object.freeze(['lobby', 'breakfast', 'lunch', 'dinner']);
  const limit = 1000;
  const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

  function recipeIds(validIds) {
    return validIds instanceof Set || Array.isArray(validIds) ? new Set(validIds) : new Set();
  }

  function resolveId(id, validIds, aliases) {
    if (typeof id !== 'string' || !id) return null;
    const resolved = own(aliases, id) ? aliases[id] : id;
    return typeof resolved === 'string' && resolved && validIds.has(resolved) ? resolved : null;
  }

  function cleanPlan(value, validIds, aliases = {}) {
    if (!Array.isArray(value)) return [];
    const allowed = recipeIds(validIds), seen = new Set(), result = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !own(item, 'id')) continue;
      const id = resolveId(item.id, allowed, aliases);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      result.push({id, slot: own(item, 'slot') && slots.includes(item.slot) ? item.slot : 'lobby'});
      if (result.length === limit) break;
    }
    return result;
  }

  function addToPlan(plan, id, validIds, aliases = {}) {
    const cleaned = cleanPlan(plan, validIds, aliases);
    const resolved = resolveId(id, recipeIds(validIds), aliases);
    if (resolved === null || cleaned.some(item => item.id === resolved)) return cleaned;
    return [{id: resolved, slot: 'lobby'}, ...cleaned].slice(0, limit);
  }

  function moveInPlan(plan, id, slot, validIds, aliases = {}) {
    const cleaned = cleanPlan(plan, validIds, aliases);
    const resolved = resolveId(id, recipeIds(validIds), aliases);
    if (resolved === null || !slots.includes(slot)) return cleaned;
    return cleaned.map(item => item.id === resolved ? {id: item.id, slot} : item);
  }

  function removeFromPlan(plan, id, validIds, aliases = {}) {
    const cleaned = cleanPlan(plan, validIds, aliases);
    const resolved = resolveId(id, recipeIds(validIds), aliases);
    return cleaned.filter(item => item.id !== resolved);
  }

  const api = {slots, limit, cleanPlan, addToPlan, moveInPlan, removeFromPlan};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TodayPlanCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
