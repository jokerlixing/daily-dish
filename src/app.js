(function () {
  'use strict';
  const recipes = window.RECIPES;
  const photos = window.PHOTOS || {};
  const { cuisines, categories, filterRecipes, ShuffleBag, parseIngredients, matchFridge } = window.RecipeCore;
  const $ = selector => document.querySelector(selector);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const storageKey = 'chishane.v1';
  let storageAvailable = true, stored = {};
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) stored = value; } catch (_) { storageAvailable = false; }
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const legacyIds = { 'sn-sesame-tangyuan':'es-ningbo-sesame-tangyuan' };
  const cleanIds = value => Array.isArray(value) ? [...new Set(value.map(id=>legacyIds[id]||id).filter(id => typeof id === 'string' && byId.has(id)))] : [];
  const initialFilters = () => ({ cuisine:'', allCuisines:false, noSpicy:false, vegetarian:false, maxTime:0, query:'' });
  const state = { favorites:cleanIds(stored.favorites), history:cleanIds(stored.history).slice(0,20), filters:initialFilters(), current:null, menu:[], batchSize:1, busy:false, pool:recipes.slice(), dialogMode:'favorites', fridgeHasRun:false, checks:new Map() };
  const bag = new ShuffleBag();
  const catalog = { page:1, pageSize:24, filters:{...initialFilters(),category:''} };
  const counts = [1,2,3,4,5,6,7,8,9,10];
  const countWords = {1:'一',2:'两',3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十'};
  let toastTimer, rollTimer, searchTimer;

  function persist(field) {
    try {
      let latest={};
      try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))latest=value;}catch(_){}
      const values={favorites:state.favorites,history:state.history,fridgeText:$('#fridge-input').value,includePantry:$('#include-pantry').checked};
      localStorage.setItem(storageKey,JSON.stringify({...latest,[field]:values[field]}));storageAvailable=true;
    } catch (_) { storageAvailable=false; }
  }
  function toast(message) { clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2700); }
  function updateFavoriteCount() { $('#favorite-count').textContent=state.favorites.length; }
  function rememberMany(list) { state.history=[...new Set([...list.map(recipe=>recipe.id),...state.history])].slice(0,20);persist('history'); }
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
    $('#recipe').innerHTML=`<div class="recipe-summary"><div class="recipe-kicker"><span class="cuisine-badge">${escape(recipe.cuisine)}</span><span>${escape(recipe.region||recipe.flavor)} · ${escape(recipe.type)}</span></div><h2 id="recipe-name">${escape(recipe.name)}</h2><p class="recipe-description">${escape(recipe.description)}</p><div class="recipe-meta"><span>${icon('clock')}${recipe.time} 分钟</span><span>${icon('pot')}${escape(recipe.difficulty)}</span><span>${icon('book')}${recipe.servings} 人份</span></div><div class="recipe-actions"><button class="button button-light favorite-action" id="favorite-recipe" aria-pressed="${saved}">${icon('heart')}<span>${saved?'已收藏':'收藏这道菜'}</span></button><button class="text-button" id="start-cooking">看做法 ${icon('arrow')}</button></div></div><figure class="recipe-photo"><div class="dish-image-frame">${imageMarkup(recipe)}</div>${photoCaption(recipe)}</figure>`;
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
    $('#menu-grid').innerHTML=state.menu.map((recipe,index)=>`<button class="menu-card" data-menu-recipe="${escape(recipe.id)}" aria-pressed="${recipe.id===state.current?.id}" aria-label="查看${escape(recipe.name)}做法"><span class="menu-photo">${imageMarkup(recipe,true)}<span class="menu-number">${index+1}</span></span><span class="menu-card-content"><strong>${escape(recipe.name)}</strong><span>${escape(recipe.cuisine)} · ${recipe.time} 分钟</span><span class="menu-link">查看做法 ${icon('arrow')}</span></span></button>`).join('');
  }
  function setRandomLabels() {
    const label=state.batchSize===1?'再帮我选一道':`再换一桌 ${state.batchSize} 道`;
    $('#shuffle-button').querySelector('span').textContent=label;
    $('#quick-draw').innerHTML=`${state.batchSize===1?'随机来一道':`再抽 ${state.batchSize} 道`} ${icon('dice')}`;
    $('#batch-options').querySelectorAll('[data-count]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.count)===state.batchSize)));
  }
  function updatePool() {
    state.pool=filterRecipes(recipes,state.filters);
    $('#pool-count').textContent=`${state.filters.allCuisines?'不含小吃 · ':''}${state.pool.length} 道可选`;
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
    if(state.busy)return;clearTimeout(searchTimer);state.filters.query=$('#search-input').value;updatePool();if(!state.pool.length)return;
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
    $('#cuisine-options').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(!state.filters.allCuisines&&button.dataset.cuisine===state.filters.cuisine)));
    $('#all-cuisines').setAttribute('aria-pressed',String(state.filters.allCuisines));$('#no-spicy').setAttribute('aria-pressed',String(state.filters.noSpicy));$('#vegetarian').setAttribute('aria-pressed',String(state.filters.vegetarian));
  }
  function applyFilters(){finishRoll();clearTimeout(searchTimer);state.filters.query=$('#search-input').value;syncFilterControls();draw(false);}
  function resetFilters(){state.filters=initialFilters();$('#search-input').value='';$('#max-time').value='0';applyFilters();}
  function toggleFavorite(id) {
    if(!byId.has(id))return;const existed=state.favorites.includes(id);state.favorites=existed?state.favorites.filter(value=>value!==id):[id,...state.favorites];persist('favorites');updateFavoriteCount();
    if(state.current?.id===id){const button=$('#favorite-recipe');if(button){button.setAttribute('aria-pressed',String(!existed));button.querySelector('span').textContent=existed?'收藏这道菜':'已收藏';}}
    toast(storageAvailable?(existed?'已从收藏移除':'已收藏，喜欢的味道留住了'):'浏览器未允许保存，收藏仅在本次打开时有效');
  }
  function showStandalone(recipe, label) {
    switchView('random');
    finishRoll();clearTimeout(searchTimer);state.menu=[];renderMenu();showRecipe(recipe);$('#recommendation-label').textContent=label;
    focusSection('#recipe-name');
  }
  function switchView(view) {
    const browsing=view==='catalog';
    if(browsing)settleSearch();
    $('#random-view').hidden=browsing;$('#catalog-view').hidden=!browsing;
    $('.skip-link').href=browsing?'#catalog-title':'#recipe';$('.skip-link').textContent=browsing?'跳到菜谱库':'跳到今日菜谱';
    $('#random-view-button').setAttribute('aria-pressed',String(!browsing));$('#catalog-view-button').setAttribute('aria-pressed',String(browsing));
    if(browsing)renderCatalog();
  }
  function renderCatalog() {
    const list=filterRecipes(recipes,catalog.filters),pages=Math.max(1,Math.ceil(list.length/catalog.pageSize));
    catalog.page=Math.min(pages,Math.max(1,catalog.page));
    const start=(catalog.page-1)*catalog.pageSize,visible=list.slice(start,start+catalog.pageSize);
    $('#catalog-result-count').textContent=`找到 ${list.length} 道${list.length?` · 当前 ${start+1}–${start+visible.length} 道`:''}`;
    $('#catalog-grid').innerHTML=visible.map(recipe=>`<button class="catalog-card" data-catalog-recipe="${escape(recipe.id)}" aria-label="查看${escape(recipe.name)}做法"><span class="catalog-photo">${imageMarkup(recipe,true)}</span><span class="catalog-card-body"><span class="catalog-card-tags">${escape(recipe.category||recipe.type)} · ${escape(recipe.cuisine)}</span><strong>${escape(recipe.name)}</strong><span class="catalog-card-meta">${recipe.time} 分钟 <span>${escape(recipe.difficulty)} ${icon('arrow')}</span></span></span></button>`).join('');
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
    $('#dialog-title').textContent=favorites?'我的收藏':'最近抽到';$('#dialog-eyebrow').textContent=favorites?'留住喜欢的味道':'最近 20 道灵感，随时翻回来';
    $('#dialog-content').innerHTML=list.length?list.map(recipe=>`<article class="collection-row"><span class="collection-photo">${imageMarkup(recipe,true)}</span><div class="collection-info"><h3>${escape(recipe.name)}</h3><p>${escape(recipe.cuisine)} · ${recipe.time} 分钟 · ${escape(recipe.flavor)}</p></div><button class="button button-light" data-view="${escape(recipe.id)}" aria-label="查看${escape(recipe.name)}做法">看做法</button>${favorites?`<button class="remove-favorite" data-remove="${escape(recipe.id)}" aria-label="取消收藏${escape(recipe.name)}">${icon('close')}</button>`:''}</article>`).join(''):`<div class="collection-empty">${icon(favorites?'heart':'clock')}<h3>${favorites?'还没有收藏的味道':'还没有抽签记录'}</h3><p>${favorites?'遇到想吃的菜，点“收藏这道菜”，下次就能在这里找到。':'点一下随机按钮，开始今天的美味冒险。'}</p></div>`;
  }
  function settleSearch(){finishRoll();if($('#search-input').value!==state.filters.query)applyFilters();else clearTimeout(searchTimer);}
  function openCollection(mode){settleSearch();state.dialogMode=mode;renderCollection();$('#collection-dialog').showModal();}

  function fridgeCard(match) {
    const {recipe,matched,missing,canCook}=match;
    return `<article class="fridge-card"><div class="fridge-card-photo">${imageMarkup(recipe,true)}</div><div class="fridge-card-body"><span class="match-badge ${canCook?'is-ready':''}">${canCook?'主料已齐':`还差 ${missing.length} 样`}</span><h3>${escape(recipe.name)}</h3><p class="fridge-match">已有：${escape(matched.join('、'))}</p>${missing.length?`<p class="fridge-missing">还缺：${escape(missing.join('、'))}</p>`:'<p class="fridge-missing ready-note">核对用量，就能准备开火</p>'}<button class="text-button" data-fridge-view="${escape(recipe.id)}">看做法 · ${recipe.time} 分钟 ${icon('arrow')}</button></div></article>`;
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

  $('#cuisine-options').innerHTML=[['','随便都行'],...cuisines.map(cuisine=>[cuisine,cuisine])].map(([value,label])=>`<button class="cuisine-option" data-cuisine="${value}" aria-pressed="${value===''}">${label}</button>`).join('');
  $('#batch-options').innerHTML=counts.map(count=>`<button class="batch-option" data-count="${count}" aria-pressed="${count===1}" aria-label="随机${countWords[count]}道菜">随机 <strong>${count}</strong> 道</button>`).join('');
  $('#cuisine-options').addEventListener('click',event=>{const button=event.target.closest('[data-cuisine]');if(button){state.filters.cuisine=button.dataset.cuisine;state.filters.allCuisines=false;applyFilters();}});
  $('#all-cuisines').addEventListener('click',()=>{state.filters.allCuisines=!state.filters.allCuisines;state.filters.cuisine='';applyFilters();});
  $('#batch-options').addEventListener('click',event=>{const button=event.target.closest('[data-count]');if(button){finishRoll();state.batchSize=Number(button.dataset.count);setRandomLabels();draw();}});
  $('#menu-grid').addEventListener('click',event=>{const button=event.target.closest('[data-menu-recipe]');if(button){showRecipe(byId.get(button.dataset.menuRecipe),false);focusSection('#recipe-name');}});
  $('#save-menu').addEventListener('click',()=>{state.favorites=[...new Set([...state.menu.map(recipe=>recipe.id),...state.favorites])];persist('favorites');updateFavoriteCount();if(state.current){$('#favorite-recipe').setAttribute('aria-pressed','true');$('#favorite-recipe span').textContent='已收藏';}toast(storageAvailable?`已收藏这一桌 ${state.menu.length} 道菜`:'浏览器未允许保存，收藏仅在本次打开时有效');});
  $('#no-spicy').addEventListener('click',()=>{state.filters.noSpicy=!state.filters.noSpicy;applyFilters();});
  $('#vegetarian').addEventListener('click',()=>{state.filters.vegetarian=!state.filters.vegetarian;applyFilters();});
  $('#max-time').addEventListener('change',event=>{state.filters.maxTime=Number(event.target.value);applyFilters();});
  $('#search-input').addEventListener('input',()=>{finishRoll();clearTimeout(searchTimer);searchTimer=setTimeout(applyFilters,220);});
  $('#search-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyFilters();}});
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
  $('#catalog-grid').addEventListener('click',event=>{const button=event.target.closest('[data-catalog-recipe]');if(button)showStandalone(byId.get(button.dataset.catalogRecipe),'从菜谱库里，选一道喜欢的菜');});
  $('#collection-dialog').addEventListener('click',event=>{if(event.target===$('#collection-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
  $('#dialog-content').addEventListener('click',event=>{const view=event.target.closest('[data-view]'),remove=event.target.closest('[data-remove]');if(view){$('#collection-dialog').close();showStandalone(byId.get(view.dataset.view),state.dialogMode==='favorites'?'从收藏里，找回喜欢的味道':'再看看这道菜');}if(remove){toggleFavorite(remove.dataset.remove);renderCollection();$('#dialog-content').querySelector('button')?.focus();}});
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
    settleSearch();state.dialogMode='about';$('#dialog-title').textContent='好好吃饭，从这一桌开始';$('#dialog-eyebrow').textContent='给每个纠结吃什么的你';
    const grouped=cuisines.map(cuisine=>`${cuisine} ${recipes.filter(recipe=>recipe.cuisine===cuisine).length} 道`);
    const photographed=recipes.filter(recipe=>photos[recipe.id]?.src).length;
    $('#dialog-content').innerHTML=`<div class="about-copy"><p>收录 <strong>${recipes.length} 道家常做法</strong>。支持一次随机 1、2、3、4、5、6、7、8、9、10 道菜；“全菜系随机”排除小吃、甜品、烘焙和饮品，普通“随便都行”包含全部菜式。</p><div class="about-tags">${grouped.map(label=>`<span>${escape(label)}</span>`).join('')}</div><p>“逛菜谱”可以按热菜、凉菜、汤羹、主食、小吃、甜品、烘焙和饮品浏览，再搭配菜系、时间和食材搜索；每页显示 24 道。</p><p>冰箱匹配会核对配方中的主食材。勾选默认调料时，认为有常用油盐、酱醋、糖淀粉、葱姜蒜；特色酱料、肉汤和主食不会被自动忽略。缺少的食材会明确列出，数量和新鲜程度仍请实际检查。</p><p>每道菜以 2 人份为参考，多菜组合可适当减少每道份量。“素菜”不含肉鱼，可能含蛋奶。做法为家常参考版本，实际时间随食材和设备变化。</p><p>当前 ${photographed} 道有照片${photographed<recipes.length?`，${recipes.length-photographed} 道实拍待补充`:''}。摄影内容可能与家常配方的摆盘不同；同类菜参考会单独标注。点击照片来源可查看原作和授权信息。</p><p>收藏、历史、冰箱食材保存在当前浏览器，不上传，不会自动跨设备同步。文字菜单与筛选不依赖 AI 接口。</p><p class="about-small">菜谱参考和逐图来源见项目 <a href="https://github.com/jokerlixing/daily-dish" target="_blank" rel="noopener noreferrer">GitHub 仓库</a>中的 data 目录。</p></div>`;$('#collection-dialog').showModal();
  });
  const now=new Date();$('#today-label').textContent=`${now.getMonth()+1} 月 ${now.getDate()} 日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()]} · 好好吃饭，今天也一样`;
  $('#total-count').textContent=recipes.length;syncFilterControls();draw(false);$('#shuffle-button').querySelector('span').textContent='帮我选一道';updateFavoriteCount();
  window.addEventListener('storage',event=>{
    if(event.key!==storageKey)return;
    try{
      const next=JSON.parse(event.newValue||'{}');if(!next||typeof next!=='object'||Array.isArray(next))return;
      state.favorites=cleanIds(next.favorites);state.history=cleanIds(next.history).slice(0,20);updateFavoriteCount();
      const fridgeText=typeof next.fridgeText==='string'?next.fridgeText.slice(0,1000):'',includePantry=next.includePantry!==false;
      if($('#fridge-input').value!==fridgeText||$('#include-pantry').checked!==includePantry){
        $('#fridge-input').value=fridgeText;$('#include-pantry').checked=includePantry;if(state.fridgeHasRun)renderFridge();
      }
      const button=$('#favorite-recipe');if(button&&state.current){const saved=state.favorites.includes(state.current.id);button.setAttribute('aria-pressed',String(saved));button.querySelector('span').textContent=saved?'已收藏':'收藏这道菜';}
      if($('#collection-dialog').open&&state.dialogMode!=='about')renderCollection();
    }catch(_){}
  });
})();
