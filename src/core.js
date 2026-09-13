(function (root) {
  'use strict';
  const cuisines = ['川菜', '湘菜', '粤菜', '鲁菜', '苏菜', '浙菜', '闽菜', '徽菜', '家常菜', '小吃'];
  function filterRecipes(recipes, filters = {}) {
    const query = (filters.query || '').trim().toLowerCase();
    return recipes.filter(recipe => (filters.allCuisines ? recipe.cuisine !== '小吃' && recipe.type !== '小吃' : (!filters.cuisine || recipe.cuisine === filters.cuisine))
      && (!filters.noSpicy || !recipe.spicy)
      && (!filters.vegetarian || recipe.vegetarian)
      && (!filters.maxTime || recipe.time <= filters.maxTime)
      && (!query || [recipe.name, recipe.cuisine, recipe.region || '', ...recipe.ingredients.map(i => i.name)].join(' ').toLowerCase().includes(query)));
  }
  class ShuffleBag {
    constructor(random = Math.random) { this.random = random; this.key = ''; this.bag = []; }
    next(pool, currentId) {
      return this.nextBatch(pool, 1, currentId == null ? [] : [currentId])[0] || null;
    }
    nextBatch(pool, count, currentIds = []) {
      const byId = new Map(pool.map(recipe => [recipe.id, recipe]));
      const target = Math.min(byId.size, Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
      if (!target) return [];
      const key = JSON.stringify([...byId.keys()].sort());
      if (key !== this.key) { this.key = key; this.bag = []; }
      const previous = new Set(Array.isArray(currentIds) ? currentIds : []);
      const selected = new Set(), result = [];
      while (result.length < target) {
        if (!this.bag.length) {
          this.bag = [...byId.keys()];
          for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
          }
        }
        let index = -1, fallback = -1;
        for (let i = this.bag.length - 1; i >= 0; i--) {
          const id = this.bag[i];
          if (selected.has(id)) continue;
          if (fallback === -1) fallback = i;
          if (!previous.has(id)) { index = i; break; }
        }
        // A manually opened favorite counts as seen: do not immediately draw it
        // when it is the sole remaining entry and another candidate exists.
        if (index === -1 && target === 1 && [...byId.keys()].some(id => !previous.has(id))) {
          this.bag = this.bag.filter(id => !previous.has(id));
          continue;
        }
        if (index === -1) index = fallback;
        if (index === -1) break;
        const [id] = this.bag.splice(index, 1);
        selected.add(id);
        result.push(byId.get(id));
      }
      return result;
    }
  }

  const aliases = {
    '西红柿': '番茄', '马铃薯': '土豆', '洋芋': '土豆', '蛋': '鸡蛋', '鸡蛋液': '鸡蛋',
    '鸡蛋清': '蛋清', '鸡蛋蛋清': '蛋清', '蛋白': '蛋清', '鸡蛋黄': '蛋黄',
    '大白菜': '白菜', '圆白菜': '包菜', '卷心菜': '包菜', '洋白菜': '包菜',
    '长茄子': '茄子', '紫茄子': '茄子', '小油菜': '油菜', '小青菜': '青菜',
    '老豆腐': '豆腐', '北豆腐': '豆腐', '南豆腐': '豆腐', '嫩豆腐': '豆腐',
    '鸡胸脯肉': '鸡胸肉', '鸡胸': '鸡胸肉', '猪里脊肉': '猪里脊', '牛里脊肉': '牛里脊',
    '黄牛里脊肉': '牛里脊', '牛腩肉': '牛腩', '大虾': '虾', '瑶柱': '干贝',
    '小葱': '葱', '大葱': '葱', '香葱': '葱', '葱花': '葱', '葱段': '葱', '葱末': '葱',
    '蒜瓣': '蒜', '大蒜': '蒜', '蒜末': '蒜', '蒜蓉': '蒜', '蒜片': '蒜',
    '生姜': '姜', '老姜': '姜', '姜片': '姜', '姜丝': '姜', '姜末': '姜',
    '植物油': '食用油', '菜籽油': '食用油', '花生油': '食用油', '玉米油': '食用油', '油': '食用油',
    '生抽': '酱油', '白糖': '糖', '细砂糖': '糖', '白砂糖': '糖', '砂糖': '糖', '糖粉': '糖',
    '香醋': '醋', '米醋': '醋', '陈醋': '醋', '白醋': '醋', '精盐': '盐', '食盐': '盐',
    '常温水': '水', '清水': '水', '开水': '水', '温水': '水', '热水': '水', '凉开水': '水',
    '米': '大米', '米饭': '熟米饭', '细面条': '面条', '细面': '面条', '面': '面条',
    '水磨糯米粉': '糯米粉', '澄粉': '小麦淀粉', '淮山': '山药', '荸荠净肉': '荸荠',
    // Explicit equivalents used by the shipped recipes. Do not strip all
    // qualifiers: 熟米饭, 干虾仁 and 郫县豆瓣酱 still describe distinct foods.
    '鲜虾': '虾', '细长红薯': '红薯', '猪五花肉': '五花肉', '菠萝果肉': '菠萝',
    '无糖花生酱': '花生酱', '纯芝麻酱': '芝麻酱'
  };
  const pantry = new Set([
    '盐','食用油','香油','橄榄油','酱油','老抽','醋','糖','冰糖','红糖',
    '淀粉','玉米淀粉','姜','葱','蒜',
    '料酒','黄酒','胡椒粉','白胡椒粉','黑胡椒粉','花椒','花椒粉','八角','桂皮','五香粉','孜然粉',
    '辣椒粉','辣椒面','粗辣椒面','干辣椒','辣椒油','味精','鸡精'
  ]);
  const cutProtected = new Set(['粉丝','干粉丝','红薯粉丝','土豆粉丝','面片','鱼片','虾片','薯片','吐司片','海苔片']);
  function normalizeIngredient(value) {
    let name = String(value == null ? '' : value).normalize('NFKC').trim().toLowerCase()
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/(?:\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(?:公斤|千克|毫升|kg|ml|克|斤|两|升|g|l|个|根|颗|只|条|把|片|块|袋|包|盒|勺|杯|碗)/gi, '')
      .replace(/\s+/g, '')
      .replace(/(?:切成|切)(?:细丝|薄片|小块|小丁|细末|丝|片|块|丁|末|段|碎)|剁碎|剁末|切碎/g, '')
      .replace(/^(?:适量|少许|少量)/, '')
      .replace(/(?:适量|少许|少量)$/, '');
    name = name.replace(/^(?:(?:正规包装|购买的|市售|原味|新鲜|冷冻|即食|免洗|去皮|去骨|去壳|带皮|带骨|洗净|切好的|已充分泡发的|泡发的|无明显气味的|无盐))+/g, '');
    if (name.startsWith('鲜') && name.length > 2) name = name.slice(1);
    if (name.endsWith('净肉')) name = name.slice(0, -2);
    // Strip preparation cuts, not similarly ending foods such as 粉丝 or 虾片.
    if (!cutProtected.has(name) && name.length > 2) name = name.replace(/(?:细末|薄片|小块|小丁|尾段|末|丝|丁|块|片|段|碎|泥)$/, '');
    name = name.replace(/^[,，、;；\s]+|[,，、;；\s]+$/g, '');
    return Object.prototype.hasOwnProperty.call(aliases,name) ? aliases[name] : name;
  }
  function parseIngredients(text) {
    if (typeof text !== 'string') return [];
    return [...new Set(text.normalize('NFKC').split(/[,，、;；\n\r\t\s]+/)
      .map(normalizeIngredient).filter(name => name && !/^[\d.]+$/.test(name)
        && !/^(?:公斤|千克|毫升|kg|ml|克|斤|两|升|g|l|个|根|颗|只|条|把|片|块|袋|包|盒|勺|杯|碗)$/.test(name)))];
  }
  const broaderIngredients = {
    '鸡肉': ['鸡胸肉','鸡腿肉','鸡腿'],
    '猪肉': ['猪瘦肉','猪里脊','五花肉','猪前腿肉','猪后腿肉'],
    '牛肉': ['牛里脊','牛腩','牛腱子','牛腿肉'],
    '鱼': ['鲈鱼','草鱼','青鱼','鲫鱼','鲢鱼','黄鱼','鳕鱼','鳜鱼'],
    '鱼片': ['鱼','鲈鱼','草鱼','青鱼','鲢鱼','鳕鱼'],
    '虾仁': ['虾'], '蛋清': ['鸡蛋'], '蛋黄': ['鸡蛋']
  };
  // A combined ingredient is an AND requirement; separators in genuine
  // alternatives such as 无盐鸭汤或鸡汤 remain OR requirements below.
  const combinedIngredients = {
    '青红甜椒': [
      { name:'青甜椒', options:['青甜椒','绿甜椒','青椒','青红甜椒'] },
      { name:'红甜椒', options:['红甜椒','红椒','青红甜椒'] }
    ]
  };
  function matchFridge(recipes, ingredients, { includePantry = true } = {}) {
    const input = typeof ingredients === 'string' ? parseIngredients(ingredients)
      : Array.isArray(ingredients) ? [...new Set(ingredients.map(normalizeIngredient).filter(Boolean))] : [];
    const available = new Set(input.filter(name => name !== '水'));
    if (!available.size) return [];
    const has = name => available.has(name) || (broaderIngredients[name] || []).some(item => available.has(item));
    const results = [];
    for (const recipe of recipes) {
      const matched = [], missing = [], seen = new Set();
      for (const ingredient of recipe.ingredients) {
        const groups = combinedIngredients[normalizeIngredient(ingredient.name)]
          || [{ name:ingredient.name, options:ingredient.name.split(/或|[/／]/) }];
        for (const group of groups) {
          const options = group.options.map(normalizeIngredient).filter(Boolean);
          if (!options.length || options.some(name => name === '水' || (includePantry && pantry.has(name)))) continue;
          const key = [...options].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          (options.some(has) ? matched : missing).push(group.name);
        }
      }
      if (!matched.length) continue;
      results.push({recipe, matched, missing, canCook: missing.length === 0, score: matched.length / (matched.length + missing.length)});
    }
    return results.sort((a, b) => Number(b.canCook) - Number(a.canCook) || b.score - a.score
      || b.matched.length - a.matched.length || a.missing.length - b.missing.length || a.recipe.time - b.recipe.time);
  }
  function hash(value) { return [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7); }
  const api = { cuisines, filterRecipes, ShuffleBag, hash, parseIngredients, matchFridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecipeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
