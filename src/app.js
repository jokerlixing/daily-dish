(function () {
  'use strict';
  const recipes = window.RECIPES;
  const photos = window.PHOTOS || {};
  const { cuisines, categories, filterRecipes, filterRandomRecipes, ShuffleBag, parseIngredients, matchFridge } = window.RecipeCore;
  const { slots:mealSlots, cleanPlan, addToPlan, moveInPlan, removeFromPlan } = window.TodayPlanCore;
  const mealNames={lobby:'今日菜谱大厅',breakfast:'早餐',lunch:'中餐',dinner:'晚餐'};
  const $ = selector => document.querySelector(selector);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const storageKey = 'chishane.v1';
  const collectionLimit = 1000;
  let storageAvailable = true, stored = {};
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) stored = value; } catch (_) { storageAvailable = false; }
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const legacyIds = { 'sn-sesame-tangyuan':'es-ningbo-sesame-tangyuan', 'cat-641602e74693':'cat-1dbfa13b129d' };
  const validRecipeIds=new Set(byId.keys());
  const normalizePlan=value=>cleanPlan(value,validRecipeIds,legacyIds);
  const cleanIds = value => Array.isArray(value) ? [...new Set(value.map(id=>legacyIds[id]||id).filter(id => typeof id === 'string' && byId.has(id)))].slice(0,collectionLimit) : [];
  const initialFilters = () => ({ cuisine:'', category:'', allCuisines:false, noSpicy:false, vegetarian:false, maxTime:0, query:'' });
  const state = { view:'random', todayPlan:normalizePlan(stored.todayPlan), favorites:cleanIds(stored.favorites), history:cleanIds(stored.history), filters:initialFilters(), current:null, menu:[], batchSize:1, busy:false, pool:recipes.slice(), dialogMode:'favorites', fridgeHasRun:false, checks:new Map() };
  const bag = new ShuffleBag();
  const catalog = { page:1, pageSize:24, filters:{...initialFilters(),category:''} };
  const counts = [1,2,3,4,5,6,7,8,9,10];
  const countWords = {1:'一',2:'两',3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十'};
  let toastTimer, rollTimer, todayPlanDirty=false;

  function persist(field) {
    try {
      let latest={};
      try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))latest=value;}catch(_){}
      for(const key of ['favorites','history'])if(Array.isArray(latest[key]))latest[key]=cleanIds(latest[key]);
      const values={todayPlan:state.todayPlan,favorites:state.favorites,history:state.history,fridgeText:$('#fridge-input').value,includePantry:$('#include-pantry').checked};
      localStorage.setItem(storageKey,JSON.stringify({...latest,[field]:values[field]}));storageAvailable=true;if(field==='todayPlan')todayPlanDirty=false;
    } catch (_) { storageAvailable=false; }
  }
  function toast(message) { clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2700); }
  function updateFavoriteCount() { $('#favorite-count').textContent=state.favorites.length; }
  function rememberMany(list) { state.history=cleanIds([...list.map(recipe=>recipe.id),...state.history]);persist('history'); }
  function addTodayButton(recipe) {
    const added=state.todayPlan.some(item=>item.id===recipe.id);
    return `<button class="button button-light add-today" data-add-today="${escape(recipe.id)}" aria-label="${escape(recipe.name)}${added?'已加入今日菜谱':'加入今日菜谱'}" ${added?'disabled':''}><span aria-hidden="true">${added?'✓':'＋'}</span><span class="today-add-label">${added?'已加入今日菜谱':'加入今日菜谱'}</span></button>`;
  }
  function syncTodayPlan() {
    const ids=new Set(state.todayPlan.map(item=>item.id));$('#today-total').textContent=ids.size;
    $('#clear-today-plan').disabled=!ids.size;
    document.querySelectorAll('[data-add-today]').forEach(button=>{
      const added=ids.has(button.dataset.addToday),recipe=byId.get(button.dataset.addToday);button.disabled=added;
      button.querySelector('.today-add-label').textContent=added?'已加入今日菜谱':'加入今日菜谱';
      button.querySelector('[aria-hidden]').textContent=added?'✓':'＋';
      button.setAttribute('aria-label',`${recipe?.name||''}${added?'已加入今日菜谱':'加入今日菜谱'}`);
    });
    if(state.view==='today')renderTodayPlan();
  }
  function changeTodayPlan(action) {
    let latest=state.todayPlan;
    if(storageAvailable&&!todayPlanDirty)try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');latest=normalizePlan(value?.todayPlan);}catch(_){}
    state.todayPlan=normalizePlan(action(latest));todayPlanDirty=true;persist('todayPlan');syncTodayPlan();
  }
  function renderTodayPlan() {
    $('#today-plan-board').innerHTML=mealSlots.map(slot=>{
      const items=state.todayPlan.filter(item=>item.slot===slot);
      return `<section class="today-slot ${slot==='lobby'?'today-lobby':''}" data-today-slot="${slot}" aria-labelledby="today-${slot}-title"><header class="today-slot-heading"><h3 id="today-${slot}-title">${mealNames[slot]}</h3><span>${items.length} 道</span></header><div class="today-slot-list">${items.length?items.map(item=>{
        const recipe=byId.get(item.id);
        return `<article class="today-recipe" data-today-item="${escape(recipe.id)}"><div class="today-recipe-photo">${imageMarkup(recipe,true)}</div><div class="today-recipe-info"><h4>${escape(recipe.name)}</h4><p>${escape(recipe.category)} · ${recipe.time} 分钟</p></div><label class="today-assignment"><span>安排到</span><select data-today-move="${escape(recipe.id)}" aria-label="安排${escape(recipe.name)}到">${mealSlots.map(value=>`<option value="${value}" ${value===slot?'selected':''}>${value==='lobby'?'大厅（暂不安排）':mealNames[value]}</option>`).join('')}</select></label><div class="today-recipe-actions"><button class="button button-light" data-today-view="${escape(recipe.id)}" aria-label="查看${escape(recipe.name)}做法">看做法</button><button class="text-button" data-today-remove="${escape(recipe.id)}" aria-label="将${escape(recipe.name)}移出今日菜谱">移出 ${icon('close')}</button></div></article>`;
      }).join(''):`<p class="today-slot-empty">${slot==='lobby'?'还没有待安排的菜。浏览菜谱时点击“加入今日菜谱”，菜就会先放在这里。':`还没安排${mealNames[slot]}，可从大厅选择菜品并设置餐次。`}</p>`}</div></section>`;
    }).join('');
  }
  function plannerToast(message){toast(storageAvailable?message:'浏览器未允许保存，今日菜谱仅在本次打开时有效');}
  function safeSource(url) { return /^https?:\/\//i.test(url || '') ? url : ''; }
  function imageMarkup(recipe, thumbnail=false) {
    const photo=photos[recipe.id];
    if(!photo?.src) return `<div class="photo-unavailable">${icon('pot')}<span>暂无对应实拍</span></div>`;
    return `<img class="${thumbnail?'dish-thumbnail':'dish-photo'}" src="${escape(photo.src)}" alt="${escape(photo.alt || recipe.name+'实拍')}" loading="${thumbnail?'lazy':'eager'}" decoding="async" ${thumbnail?'':'fetchpriority="high"'}><span class="photo-error-message" hidden>照片暂时无法加载，菜谱仍可查看</span>${thumbnail&&photo.exact===false?'<span class="photo-ref-tag">参考图</span>':''}`;
  }
  function photoCaption(recipe) {
    const photo=photos[recipe.id];if(!photo)return '';
    const source=safeSource(photo.source);
    const label=photo.exact===false?`${photo.sourceTitle||'同类菜品'} · 实拍参考图`:(photo.alt||`${recipe.name}实拍`);
    const license=safeSource(photo.licenseUrl);
    return `<figcaption class="photo-caption"><span>${escape(label)}${photo.exact===false&&photo.referenceNote?`<small>${escape(photo.referenceNote)}</small>`:''}<small>${escape(photo.credit||'')} · ${license?`<a href="${escape(license)}" target="_blank" rel="noopener noreferrer">${escape(photo.license||'查看许可')}</a>`:escape(photo.license||'')} · 已缩放</small></span>${source?`<a class="photo-source" href="${escape(source)}" target="_blank" rel="noopener noreferrer">照片来源 ↗</a>`:''}</figcaption>`;
  }
  function recipeChecks(recipe) {
    if(!state.checks.has(recipe.id))state.checks.set(recipe.id,{ingredients:new Set(),steps:new Set()});
    return state.checks.get(recipe.id);
  }
  function focusSection(selector) {
    const target=$(selector);target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({behavior:scrollBehavior(),block:'start'});
  }
  function showRecipe(recipe, addHistory=true) {
    if(!recipe)return;state.current=recipe;if(addHistory)rememberMany([recipe]);
    $('#recipe').hidden=false;$('#empty-state').hidden=true;$('#recipe-detail').hidden=false;
    const saved=state.favorites.includes(recipe.id),checks=recipeChecks(recipe);
    $('#recipe').innerHTML=`<div class="recipe-summary"><div class="recipe-kicker"><span class="cuisine-badge">${escape(recipe.cuisine)}</span><span>${escape(recipe.region||recipe.flavor)} · ${escape(recipe.type)}</span></div><h2 id="recipe-name">${escape(recipe.name)}</h2><p class="recipe-description">${escape(recipe.description)}</p><div class="recipe-meta"><span>${icon('clock')}${recipe.time} 分钟</span><span>${icon('pot')}${escape(recipe.difficulty)}</span><span>${icon('book')}${recipe.servings} 人份</span></div><div class="recipe-actions"><button class="button button-light favorite-action" id="favorite-recipe" aria-pressed="${saved}">${icon('heart')}<span>${saved?'已收藏':'收藏这道菜'}</span></button>${addTodayButton(recipe)}<button class="text-button" id="start-cooking">看做法 ${icon('arrow')}</button></div></div><figure class="recipe-photo"><div class="dish-image-frame">${imageMarkup(recipe)}</div>${photoCaption(recipe)}</figure>`;
    $('#recipe-detail').innerHTML=`<section class="ingredients-section"><div class="detail-heading"><h3>${icon('leaf')}准备食材</h3><small>这道菜 ${recipe.servings} 人份 · 可勾选</small></div><ul class="ingredients-list">${recipe.ingredients.map((ingredient,i)=>`<li><label class="ingredient-row"><input type="checkbox" data-ingredient="${i}" ${checks.ingredients.has(i)?'checked':''} aria-label="已备好${escape(ingredient.name)}"><span class="ingredient-name">${escape(ingredient.name)}</span><span class="ingredient-amount">${escape(ingredient.amount)}</span></label></li>`).join('')}</ul><p class="ingredients-footnote">多道菜组合时，可按实际人数适当减少每道菜份量。</p></section><section class="steps-section" id="cooking-steps"><div class="detail-heading"><h3>${icon('pot')}跟着做就好</h3><small id="steps-progress">${checks.steps.size?`已完成 ${checks.steps.size} / ${recipe.steps.length} 步`:`${recipe.steps.length} 个步骤 · 家常做法`}</small></div><ol class="steps-list">${recipe.steps.map((step,i)=>`<li><label class="step-row"><span class="step-number" aria-hidden="true">${i+1}</span><span class="step-text">${escape(step)}</span><input type="checkbox" class="step-checkbox" data-step="${i}" ${checks.steps.has(i)?'checked':''} aria-label="完成第 ${i+1} 步"></label></li>`).join('')}</ol><div class="cooking-tip"><span class="tip-icon" aria-hidden="true">✳</span><div><strong>让这道菜更好吃的小诀窍</strong><p>${escape(recipe.tip)}</p></div></div></section>`;
    $('#recipe').classList.remove('is-rolling');$('#recipe').classList.add('revealed');
    $('#menu-grid').querySelectorAll('[data-menu-recipe]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.menuRecipe===recipe.id)));
    $('#announcement').textContent=`${recipe.name}，${recipe.cuisine}，约${recipe.time}分钟，食材和做法已更新。`;
    updateFavoriteCount();
  }
  function renderMenu() {
    $('#menu-section').hidden=state.menu.length<=1;
    if(state.menu.length<=1){$('#menu-grid').innerHTML='';return;}
    $('#menu-title').textContent=`这一桌，${state.menu.length} 道菜刚刚好`;
    $('#menu-description').textContent=`${state.menu.length<state.batchSize?`符合条件只有 ${state.menu.length} 道，已全部列出。`:''}点一道菜，查看它的食材和完整做法。`;
    $('#menu-grid').innerHTML=state.menu.map((recipe,index)=>`<article class="menu-card"><button class="menu-card-open" data-menu-recipe="${escape(recipe.id)}" aria-pressed="${recipe.id===state.current?.id}" aria-label="查看${escape(recipe.name)}做法"><span class="menu-photo">${imageMarkup(recipe,true)}<span class="menu-number">${index+1}</span></span><span class="menu-card-content"><strong>${escape(recipe.name)}</strong><span>${escape(recipe.cuisine)} · ${recipe.time} 分钟</span><span class="menu-link">查看做法 ${icon('arrow')}</span></span></button>${addTodayButton(recipe)}</article>`).join('');
  }
  function setRandomLabels() {
    const label=state.batchSize===1?'再帮我选一道':`再换一桌 ${state.batchSize} 道`;
    $('#shuffle-button').querySelector('span').textContent=label;
    $('#quick-draw').innerHTML=`${state.batchSize===1?'随机来一道':`再抽 ${state.batchSize} 道`} ${icon('dice')}`;
    $('#batch-options').querySelectorAll('[data-count]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.count)===state.batchSize)));
  }
  function updatePool() {
    state.pool=filterRandomRecipes(recipes,state.filters);
    $('#pool-count').textContent=`${state.filters.allCuisines?'正餐 · ':state.filters.category?state.filters.category+' · ':''}${state.pool.length} 道可选`;
    $('#shuffle-hint').textContent=state.pool.length<state.batchSize?`只有 ${state.pool.length} 道符合条件，不会重复凑数`:'同一桌不重复，点菜名就能看做法';
    $('#shuffle-dock').hidden=!state.pool.length;$('#quick-draw').hidden=!state.pool.length;
    if(!state.pool.length){$('#recipe').hidden=true;$('#recipe-detail').hidden=true;$('#menu-section').hidden=true;$('#empty-state').hidden=false;$('#announcement').textContent='没有符合筛选条件的菜谱';}
    return state.pool;
  }
  function finishRoll() {
    clearTimeout(rollTimer);state.busy=false;$('#shuffle-button').disabled=false;$('#quick-draw').disabled=false;
    $('#shuffle-button').querySelector('.icon').classList.remove('is-rolling-icon');$('#recipe').classList.remove('is-rolling');setRandomLabels();
  }
  function draw(animate=true) {
    if(state.busy)return;updatePool();if(!state.pool.length)return;
    state.busy=true;$('#shuffle-button').disabled=true;$('#quick-draw').disabled=true;
    const reduced=scrollBehavior()==='auto';
    if(animate&&!reduced){$('#recipe').classList.remove('revealed');$('#recipe').classList.add('is-rolling');$('#shuffle-button').querySelector('span').textContent='正在搭配这顿饭…';$('#shuffle-button').querySelector('.icon').classList.add('is-rolling-icon');}
    const complete=()=>{
      const previous=[state.current?.id,...state.menu.map(recipe=>recipe.id)].filter(Boolean);
      state.menu=bag.nextBatch(state.pool,state.batchSize,previous);rememberMany(state.menu);showRecipe(state.menu[0],false);renderMenu();finishRoll();
      $('#recommendation-label').textContent=state.menu.length>1?'这一顿，菜单替你想好了':'这一顿，不妨试试';
      $('#announcement').textContent=`随机推荐${state.menu.length}道菜：${state.menu.map(recipe=>recipe.name).join('、')}`;
      if(animate){const target=state.menu.length>1?$('#menu-section'):$('#recipe');const bounds=target.getBoundingClientRect();if(bounds.top< -40||bounds.top>innerHeight*.62)target.scrollIntoView({behavior:scrollBehavior(),block:'start'});}
    };
    if(animate&&!reduced)rollTimer=setTimeout(complete,320);else complete();
  }
  function syncFilterControls() {
    $('#cuisine-options').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(!state.filters.allCuisines&&!state.filters.category&&button.dataset.cuisine===state.filters.cuisine)));
    $('#random-category-options').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.randomCategory===state.filters.category)));
    $('#all-cuisines').setAttribute('aria-pressed',String(state.filters.allCuisines));$('#no-spicy').setAttribute('aria-pressed',String(state.filters.noSpicy));$('#vegetarian').setAttribute('aria-pressed',String(state.filters.vegetarian));
  }
  function applyFilters(){finishRoll();syncFilterControls();draw(false);}
  function resetFilters(){state.filters=initialFilters();$('#max-time').value='0';applyFilters();}
  function toggleFavorite(id) {
    if(!byId.has(id))return;const existed=state.favorites.includes(id);state.favorites=existed?state.favorites.filter(value=>value!==id):cleanIds([id,...state.favorites]);persist('favorites');updateFavoriteCount();
    if(state.current?.id===id){const button=$('#favorite-recipe');if(button){button.setAttribute('aria-pressed',String(!existed));button.querySelector('span').textContent=existed?'收藏这道菜':'已收藏';}}
    toast(storageAvailable?(existed?'已从收藏移除':'已收藏，喜欢的味道留住了'):'浏览器未允许保存，收藏仅在本次打开时有效');
  }
  function showStandalone(recipe, label) {
    switchView('random');
    finishRoll();state.menu=[];renderMenu();showRecipe(recipe);$('#recommendation-label').textContent=label;
    focusSection('#recipe-name');
  }
  function switchView(view) {
    if(!['random','catalog','today'].includes(view))return;
    if(view!=='random')finishRoll();state.view=view;
    for(const name of ['random','catalog','today']){
      $(`#${name}-view`).hidden=name!==view;$(`#${name}-view-button`).setAttribute('aria-pressed',String(name===view));
    }
    $('.skip-link').href=view==='catalog'?'#catalog-title':view==='today'?'#today-title':'#recipe';
    $('.skip-link').textContent=view==='catalog'?'跳到菜谱库':view==='today'?'跳到今日菜谱':'跳到推荐菜谱';
    if(view==='catalog')renderCatalog();if(view==='today')renderTodayPlan();
  }
  function renderCatalog() {
    const list=filterRecipes(recipes,catalog.filters),pages=Math.max(1,Math.ceil(list.length/catalog.pageSize));
    catalog.page=Math.min(pages,Math.max(1,catalog.page));
    const start=(catalog.page-1)*catalog.pageSize,visible=list.slice(start,start+catalog.pageSize);
    $('#catalog-result-count').textContent=`找到 ${list.length} 道${list.length?` · 当前 ${start+1}–${start+visible.length} 道`:''}`;
    $('#catalog-grid').innerHTML=visible.map(recipe=>`<article class="catalog-card" data-catalog-recipe="${escape(recipe.id)}"><button class="catalog-open" aria-label="查看${escape(recipe.name)}做法"><span class="catalog-photo">${imageMarkup(recipe,true)}</span><span class="catalog-card-body"><span class="catalog-card-tags">${escape(recipe.category||recipe.type)} · ${escape(recipe.cuisine)}</span><strong>${escape(recipe.name)}</strong><span class="catalog-card-meta">${recipe.time} 分钟 <span>${escape(recipe.difficulty)} ${icon('arrow')}</span></span></span></button>${addTodayButton(recipe)}</article>`).join('');
    $('#catalog-empty').hidden=!!list.length;$('#catalog-page').textContent=`${catalog.page} / ${pages}`;
    $('#catalog-page-input').value=catalog.page;$('#catalog-page-input').max=pages;$('#catalog-page-input').disabled=!list.length;
    $('#catalog-page-total').textContent=`/ ${pages}`;$('#catalog-go').disabled=!list.length;
    $('#catalog-prev').disabled=catalog.page===1;$('#catalog-next').disabled=catalog.page===pages;
    $('#category-options').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===catalog.filters.category)));
  }
  function applyCatalogFilters() {
    catalog.page=1;catalog.filters.query=$('#catalog-search').value;catalog.filters.cuisine=$('#catalog-cuisine').value;
    catalog.filters.maxTime=Number($('#catalog-time').value);catalog.filters.vegetarian=$('#catalog-vegetarian').checked;catalog.filters.noSpicy=$('#catalog-no-spicy').checked;renderCatalog();
  }
  function goToCatalogPage(page) {
    catalog.page=page;renderCatalog();focusSection('#catalog-result-count');
  }
  function renderCollection() {
    const favorites=state.dialogMode==='favorites';const list=(favorites?state.favorites:state.history).map(id=>byId.get(id)).filter(Boolean);
    $('#dialog-title').textContent=favorites?'我的收藏':'最近抽到';$('#dialog-eyebrow').textContent=favorites?`最多收藏 ${collectionLimit} 道喜欢的味道`:`最近 ${collectionLimit} 道灵感，随时翻回来`;
    const toolbar=`<div class="collection-toolbar"><span>共 ${list.length} 道${favorites?'收藏':'记录'}</span><button class="button collection-clear" data-clear-collection="${favorites?'favorites':'history'}" ${list.length?'':'disabled'}>${favorites?'清空收藏':'清空记录'}</button></div>`;
    $('#dialog-content').innerHTML=toolbar+(list.length?list.map(recipe=>`<article class="collection-row"><span class="collection-photo">${imageMarkup(recipe,true)}</span><div class="collection-info"><h3>${escape(recipe.name)}</h3><p>${escape(recipe.cuisine)} · ${recipe.time} 分钟 · ${escape(recipe.flavor)}</p></div><div class="collection-actions"><button class="button button-light" data-view="${escape(recipe.id)}" aria-label="查看${escape(recipe.name)}做法">看做法</button>${addTodayButton(recipe)}${favorites?`<button class="remove-favorite" data-remove="${escape(recipe.id)}" aria-label="取消收藏${escape(recipe.name)}">${icon('close')}</button>`:''}</div></article>`).join(''):`<div class="collection-empty">${icon(favorites?'heart':'clock')}<h3>${favorites?'还没有收藏的味道':'还没有抽签记录'}</h3><p>${favorites?'遇到想吃的菜，点“收藏这道菜”，下次就能在这里找到。':'点一下随机按钮，开始今天的美味冒险。'}</p></div>`);
  }
  function clearCollection(mode) {
    if(mode!==state.dialogMode||!['favorites','history'].includes(mode)||!state[mode].length)return;
    state[mode]=[];persist(mode);
    if(mode==='favorites'){
      updateFavoriteCount();const button=$('#favorite-recipe');
      if(button){button.setAttribute('aria-pressed','false');button.querySelector('span').textContent='收藏这道菜';}
    }
    renderCollection();$('#close-dialog').focus();
    toast(storageAvailable?(mode==='favorites'?'已清空收藏':'已清空抽签记录'):'本次列表已清空，浏览器未允许保存此更改');
  }
  function openCollection(mode){finishRoll();state.dialogMode=mode;renderCollection();$('#collection-dialog').showModal();}

  function fridgeCard(match) {
    const {recipe,matched,missing,canCook}=match;
    return `<article class="fridge-card"><div class="fridge-card-photo">${imageMarkup(recipe,true)}</div><div class="fridge-card-body"><span class="match-badge ${canCook?'is-ready':''}">${canCook?'主料已齐':`还差 ${missing.length} 样`}</span><h3>${escape(recipe.name)}</h3><p class="fridge-match">已有：${escape(matched.join('、'))}</p>${missing.length?`<p class="fridge-missing">还缺：${escape(missing.join('、'))}</p>`:'<p class="fridge-missing ready-note">核对用量，就能准备开火</p>'}<button class="text-button" data-fridge-view="${escape(recipe.id)}">看做法 · ${recipe.time} 分钟 ${icon('arrow')}</button>${addTodayButton(recipe)}</div></article>`;
  }
  function renderFridge() {
    const ingredients=parseIngredients($('#fridge-input').value);state.fridgeHasRun=true;
    if(!ingredients.length){$('#fridge-results').innerHTML='<div class="fridge-empty">先填入冰箱里已有的食材，例如“鸡蛋、番茄”，再找能做的菜。</div>';return;}
    const matches=matchFridge(recipes,ingredients,{includePantry:$('#include-pantry').checked});
    const ready=matches.filter(match=>match.canCook);
    const almost=matches.filter(match=>!match.canCook&&match.missing.length<=6&&match.score>=.3).slice(0,12);
    $('#fridge-results').innerHTML=`<div class="fridge-result-summary"><strong>${ready.length?`${ready.length} 道菜，主料已经齐了`:'暂时没有主料全部齐的菜'}</strong><span>已识别：${ingredients.map(escape).join('、')}</span></div>${ready.length?`<div class="fridge-grid">${ready.map(fridgeCard).join('')}</div>`:'<p class="fridge-empty">可以再补充几样冰箱食材，或看看下面还差少量食材的菜。</p>'}${almost.length?`<h3 class="almost-heading">再买一点，也能做这些</h3><div class="fridge-grid">${almost.map(fridgeCard).join('')}</div>`:!ready.length?'<p class="fridge-empty">还没有足够接近的配方。试试填写更具体的食材名称，例如“鸡胸肉”或“嫩豆腐”。</p>':''}`;
    $('#announcement').textContent=`识别${ingredients.length}种食材，有${ready.length}道菜主料已齐，${almost.length}道还差少量配料。`;
  }

  $('#cuisine-options').innerHTML=[['','随便都行'],...cuisines.filter(cuisine=>cuisine!=='小吃').map(cuisine=>[cuisine,cuisine])].map(([value,label])=>`<button class="cuisine-option" data-cuisine="${value}" aria-pressed="${value===''}">${label}</button>`).join('');
  $('#random-category-options').innerHTML=categories.map(category=>`<button class="random-category-option" data-random-category="${escape(category)}" aria-pressed="false">${escape(category)}<small>${recipes.filter(recipe=>recipe.category===category).length}</small></button>`).join('');
  $('#batch-options').innerHTML=counts.map(count=>`<button class="batch-option" data-count="${count}" aria-pressed="${count===1}" aria-label="随机${countWords[count]}道菜">随机 <strong>${count}</strong> 道</button>`).join('');
  $('#cuisine-options').addEventListener('click',event=>{const button=event.target.closest('[data-cuisine]');if(button){state.filters.cuisine=button.dataset.cuisine;state.filters.category='';state.filters.allCuisines=false;applyFilters();}});
  $('#random-category-options').addEventListener('click',event=>{const button=event.target.closest('[data-random-category]');if(button){state.filters.category=button.dataset.randomCategory;state.filters.cuisine='';state.filters.allCuisines=false;applyFilters();}});
  $('#all-cuisines').addEventListener('click',()=>{state.filters.allCuisines=!state.filters.allCuisines;state.filters.cuisine='';state.filters.category='';applyFilters();});
  $('#batch-options').addEventListener('click',event=>{const button=event.target.closest('[data-count]');if(button){finishRoll();state.batchSize=Number(button.dataset.count);setRandomLabels();draw();}});
  $('#menu-grid').addEventListener('click',event=>{const button=event.target.closest('[data-menu-recipe]');if(button){showRecipe(byId.get(button.dataset.menuRecipe),false);focusSection('#recipe-name');}});
  $('#save-menu').addEventListener('click',()=>{state.favorites=cleanIds([...state.menu.map(recipe=>recipe.id),...state.favorites]);persist('favorites');updateFavoriteCount();if(state.current){$('#favorite-recipe').setAttribute('aria-pressed','true');$('#favorite-recipe span').textContent='已收藏';}toast(storageAvailable?`已收藏这一桌 ${state.menu.length} 道菜`:'浏览器未允许保存，收藏仅在本次打开时有效');});
  $('#no-spicy').addEventListener('click',()=>{state.filters.noSpicy=!state.filters.noSpicy;applyFilters();});
  $('#vegetarian').addEventListener('click',()=>{state.filters.vegetarian=!state.filters.vegetarian;applyFilters();});
  $('#max-time').addEventListener('change',event=>{state.filters.maxTime=Number(event.target.value);applyFilters();});
  $('#reset-filters').addEventListener('click',resetFilters);$('#shuffle-button').addEventListener('click',()=>draw());$('#quick-draw').addEventListener('click',()=>draw());
  $('#recipe').addEventListener('click',event=>{if(event.target.closest('#favorite-recipe'))toggleFavorite(state.current.id);if(event.target.closest('#start-cooking'))focusSection('#cooking-steps');});
  $('#recipe-detail').addEventListener('change',event=>{
    const input=event.target;if(!state.current)return;const checks=recipeChecks(state.current);
    if(input.matches('[data-ingredient]')){const i=Number(input.dataset.ingredient);input.checked?checks.ingredients.add(i):checks.ingredients.delete(i);}
    if(input.matches('[data-step]')){const i=Number(input.dataset.step);input.checked?checks.steps.add(i):checks.steps.delete(i);$('#steps-progress').textContent=`已完成 ${checks.steps.size} / ${state.current.steps.length} 步`;if(checks.steps.size===state.current.steps.length)toast('辛苦啦，趁热开饭！');}
  });
  $('#favorites-button').addEventListener('click',()=>openCollection('favorites'));$('#history-button').addEventListener('click',()=>openCollection('history'));
  $('#home-button').addEventListener('click',()=>{switchView('random');window.scrollTo({top:0,behavior:scrollBehavior()});});$('#close-dialog').addEventListener('click',()=>$('#collection-dialog').close());
  $('.brand').addEventListener('click',()=>switchView('random'));
  $('#random-view-button').addEventListener('click',()=>switchView('random'));$('#catalog-view-button').addEventListener('click',()=>switchView('catalog'));
  $('#today-view-button').addEventListener('click',()=>switchView('today'));
  $('#quick-today').addEventListener('click',()=>{switchView('today');focusSection('#today-title');});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-add-today]');if(!button||button.disabled)return;
    let existed=false;changeTodayPlan(plan=>{existed=plan.some(item=>item.id===button.dataset.addToday);return addToPlan(plan,button.dataset.addToday,validRecipeIds,legacyIds);});plannerToast(existed?'这道菜已经在今日菜谱里':'已加入今日菜谱大厅，可以安排到三餐');
  });
  $('#today-plan-board').addEventListener('change',event=>{
    const select=event.target.closest('[data-today-move]');if(!select)return;const id=select.dataset.todayMove,slot=select.value;
    changeTodayPlan(plan=>moveInPlan(plan,id,slot,validRecipeIds,legacyIds));
    const moved=[...$('#today-plan-board').querySelectorAll('[data-today-move]')].find(node=>node.dataset.todayMove===id);
    if(moved){moved.focus({preventScroll:true});moved.closest('.today-recipe').scrollIntoView({block:'nearest',behavior:scrollBehavior()});}
    plannerToast(slot==='lobby'?'已移回今日菜谱大厅':`已安排到${mealNames[slot]}`);
  });
  $('#today-plan-board').addEventListener('click',event=>{
    const view=event.target.closest('[data-today-view]'),remove=event.target.closest('[data-today-remove]');
    if(view)showStandalone(byId.get(view.dataset.todayView),'今天想吃这道菜，看看怎么做');
    if(remove){changeTodayPlan(plan=>removeFromPlan(plan,remove.dataset.todayRemove,validRecipeIds,legacyIds));$('#today-title').tabIndex=-1;$('#today-title').focus({preventScroll:true});plannerToast('已移出今日菜谱');}
  });
  $('#clear-today-plan').addEventListener('click',()=>{changeTodayPlan(()=>[]);$('#today-title').tabIndex=-1;$('#today-title').focus({preventScroll:true});plannerToast('已清空今日菜谱');});
  $('#catalog-total').textContent=recipes.length;
  $('#catalog-cuisine').innerHTML='<option value="">全部菜系</option>'+cuisines.map(cuisine=>`<option>${cuisine}</option>`).join('');
  $('#category-options').innerHTML=[['','全部菜式'],...categories.map(category=>[category,category])].map(([value,label])=>`<button data-category="${value}" aria-pressed="${!value}">${label}<small>${recipes.filter(recipe=>!value||recipe.category===value).length}</small></button>`).join('');
  $('#category-options').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button){catalog.filters.category=button.dataset.category;applyCatalogFilters();}});
  $('#catalog-search').addEventListener('input',applyCatalogFilters);
  ['#catalog-cuisine','#catalog-time','#catalog-vegetarian','#catalog-no-spicy'].forEach(selector=>$(selector).addEventListener('change',applyCatalogFilters));
  $('#catalog-reset').addEventListener('click',()=>{catalog.filters={...initialFilters(),category:''};$('#catalog-search').value='';$('#catalog-cuisine').value='';$('#catalog-time').value='0';$('#catalog-vegetarian').checked=false;$('#catalog-no-spicy').checked=false;applyCatalogFilters();});
  [['#catalog-prev',-1],['#catalog-next',1]].forEach(([selector,offset])=>$(selector).addEventListener('click',()=>goToCatalogPage(catalog.page+offset)));
  $('#catalog-page-form').addEventListener('submit',event=>{
    event.preventDefault();
    const input=$('#catalog-page-input'),page=Number(input.value),pages=Number(input.max);
    if(input.disabled)return;
    if(!Number.isInteger(page)||page<1||page>pages){toast(`请输入 1–${pages} 之间的整数页码`);input.value=catalog.page;input.focus();input.select();return;}
    goToCatalogPage(page);
  });
  $('#catalog-grid').addEventListener('click',event=>{if(event.target.closest('[data-add-today]'))return;const button=event.target.closest('[data-catalog-recipe]');if(button)showStandalone(byId.get(button.dataset.catalogRecipe),'从菜谱库里，选一道喜欢的菜');});
  $('#collection-dialog').addEventListener('click',event=>{if(event.target===$('#collection-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
  $('#dialog-content').addEventListener('click',event=>{const clear=event.target.closest('[data-clear-collection]');if(clear){clearCollection(clear.dataset.clearCollection);return;}const view=event.target.closest('[data-view]'),remove=event.target.closest('[data-remove]');if(view){$('#collection-dialog').close();showStandalone(byId.get(view.dataset.view),state.dialogMode==='favorites'?'从收藏里，找回喜欢的味道':'再看看这道菜');}if(remove){toggleFavorite(remove.dataset.remove);renderCollection();$('#dialog-content').querySelector('button:not(:disabled)')?.focus();}});
  $('#fridge-input').value=typeof stored.fridgeText==='string'?stored.fridgeText.slice(0,1000):'';
  $('#include-pantry').checked=stored.includePantry!==false;
  $('#fridge-suggestions').innerHTML=['鸡蛋','番茄','土豆','豆腐','猪肉','鸡胸肉','青菜','香菇','牛肉','面条'].map(name=>`<button data-ingredient-name="${name}">＋ ${name}</button>`).join('');
  $('#fridge-suggestions').addEventListener('click',event=>{const button=event.target.closest('[data-ingredient-name]');if(button){const list=parseIngredients($('#fridge-input').value);if(!list.includes(button.dataset.ingredientName))list.push(button.dataset.ingredientName);$('#fridge-input').value=list.join('、');persist('fridgeText');if(state.fridgeHasRun)renderFridge();}});
  $('#find-fridge').addEventListener('click',renderFridge);
  $('#include-pantry').addEventListener('change',()=>{persist('includePantry');if(state.fridgeHasRun)renderFridge();});
  $('#fridge-input').addEventListener('input',()=>{state.fridgeHasRun=false;$('#fridge-results').innerHTML='';persist('fridgeText');});
  $('#fridge-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();renderFridge();}});
  $('#fridge-results').addEventListener('click',event=>{const button=event.target.closest('[data-fridge-view]');if(button)showStandalone(byId.get(button.dataset.fridgeView),'用冰箱里的食材，做一道好菜');});
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){event.target.hidden=true;const message=event.target.parentElement.querySelector('.photo-error-message');if(message)message.hidden=false;event.target.parentElement.classList.add('photo-load-error');}},true);
  $('#about-button').addEventListener('click',()=>{
    finishRoll();state.dialogMode='about';$('#dialog-title').textContent='好好吃饭，从这一桌开始';$('#dialog-eyebrow').textContent='给每个纠结吃什么的你';
    const grouped=cuisines.map(cuisine=>`${cuisine} ${recipes.filter(recipe=>recipe.cuisine===cuisine).length} 道`);
    const photographed=recipes.filter(recipe=>photos[recipe.id]?.src).length;
    $('#dialog-content').innerHTML=`<div class="about-copy"><p>收录 <strong>${recipes.length} 道家常做法</strong>。支持一次随机 1、2、3、4、5、6、7、8、9、10 道菜；“全菜系随机”排除小吃、甜品、烘焙和饮品，普通“随便都行”包含全部菜式。</p><div class="about-tags">${grouped.map(label=>`<span>${escape(label)}</span>`).join('')}</div><p>“逛菜谱”可以按热菜、凉菜、汤羹、主食、小吃、甜品、烘焙和饮品浏览，再搭配菜系、时间和食材搜索；每页显示 24 道。</p><p>冰箱匹配会核对配方中的主食材。勾选默认调料时，认为有常用油盐、酱醋、糖淀粉、葱姜蒜；特色酱料、肉汤和主食不会被自动忽略。缺少的食材会明确列出，数量和新鲜程度仍请实际检查。</p><p>每道菜以 2 人份为参考，多菜组合可适当减少每道份量。“素菜”不含肉鱼，可能含蛋奶。做法为家常参考版本，实际时间随食材和设备变化。</p><p>当前 ${photographed} 道有照片${photographed<recipes.length?`，${recipes.length-photographed} 道实拍待补充`:''}。摄影内容可能与家常配方的摆盘不同；同类菜参考会单独标注。点击照片来源可查看原作和授权信息。</p><p>今日菜谱可先放大厅，再手动安排早餐、中餐和晚餐，也能移回大厅。收藏、历史、今日菜谱和冰箱食材保存在当前浏览器，不上传，不会自动跨设备同步。文字菜单与筛选不依赖 AI 接口。</p><p class="about-small">菜谱参考和逐图来源见项目 <a href="https://github.com/jokerlixing/daily-dish" target="_blank" rel="noopener noreferrer">GitHub 仓库</a>中的 data 目录。</p></div>`;$('#collection-dialog').showModal();
  });
  const now=new Date();$('#today-label').textContent=`${now.getMonth()+1} 月 ${now.getDate()} 日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()]} · 好好吃饭，今天也一样`;
  $('#total-count').textContent=recipes.length;syncFilterControls();draw(false);$('#shuffle-button').querySelector('span').textContent='帮我选一道';updateFavoriteCount();syncTodayPlan();
  window.addEventListener('storage',event=>{
    if(event.key!==storageKey)return;
    try{
      const next=JSON.parse(event.newValue||'{}');if(!next||typeof next!=='object'||Array.isArray(next))return;
      const plan=normalizePlan(next.todayPlan);if(!todayPlanDirty&&JSON.stringify(plan)!==JSON.stringify(state.todayPlan)){state.todayPlan=plan;syncTodayPlan();}
      state.favorites=cleanIds(next.favorites);state.history=cleanIds(next.history);updateFavoriteCount();
      const fridgeText=typeof next.fridgeText==='string'?next.fridgeText.slice(0,1000):'',includePantry=next.includePantry!==false;
      if($('#fridge-input').value!==fridgeText||$('#include-pantry').checked!==includePantry){
        $('#fridge-input').value=fridgeText;$('#include-pantry').checked=includePantry;if(state.fridgeHasRun)renderFridge();
      }
      const button=$('#favorite-recipe');if(button&&state.current){const saved=state.favorites.includes(state.current.id);button.setAttribute('aria-pressed',String(saved));button.querySelector('span').textContent=saved?'已收藏':'收藏这道菜';}
      if($('#collection-dialog').open&&state.dialogMode!=='about')renderCollection();
    }catch(_){}
  });
})();
