/* Set PLAYWRIGHT_MODULE, BROWSER_EXE and optionally TEST_URL. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts');
const url=process.env.TEST_URL||'http://localhost:4173';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined});
  const errors=[],checks=[],screens=[{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:1050}];
  const ok=message=>{checks.push(message);console.log(`PASS ${message}`);};
  try{
    const context=await browser.newContext({viewport:screens[3],reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#quick-draw').disabled);
    const chooseRecipe=async(target,name)=>{
      await target.locator('#catalog-view-button').click();await target.locator('#catalog-reset').click();
      await target.locator('#catalog-search').fill(name);
      await target.locator('#catalog-grid').getByRole('button',{name:`查看${name}做法`,exact:true}).click();
      assert.equal(await target.evaluate(()=>document.activeElement.id),'cooking-steps');
      assert.ok((await target.locator('#cooking-title').textContent()).includes(name));
    };
    const applyRandomFilters=async({cuisine='',noSpicy=false,vegetarian=false,maxTime=0}={})=>{
      await page.locator('#random-view-button').click();await page.locator(`[data-cuisine="${cuisine}"]`).click();
      for(const [selector,value] of [['#no-spicy',noSpicy],['#vegetarian',vegetarian]]){
        if((await page.locator(selector).getAttribute('aria-pressed')==='true')!==value)await page.locator(selector).click();
      }
      await page.locator('#max-time').selectOption(String(maxTime));
    };
    const reset=()=>applyRandomFilters();
    const openFridge=async(open=true)=>{if(await page.locator('#fridge-panel').evaluate(el=>el.open)!==open)await page.locator('#fridge-panel summary').click();};
    await page.goto(url);await page.waitForSelector('#recipe-name');
    assert.equal(await page.locator('#cuisine-options [data-cuisine]').count(),10);
    assert.deepEqual(await page.locator('#random-category-options [data-random-category]').evaluateAll(nodes=>nodes.map(n=>n.dataset.randomCategory)),['热菜','凉菜','汤羹','主食','小吃','甜品','烘焙','饮品']);
    assert.deepEqual(await page.locator('.batch-option').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.count))),[1,2,3,4,5,6,7,8,9,10]);
    assert.equal(await page.locator('[data-count="9"]').getAttribute('aria-label'),'随机九道菜');
    assert.equal(await page.locator('#total-count').textContent(),'1000');
    assert.equal(await page.locator('#search-input').count(),0);
    assert.equal(await page.locator('#random-view input[type="search"]').count(),0);
    assert.equal(await page.getByPlaceholder('搜菜名，或冰箱里的食材').count(),0);
    assert.equal(await page.locator('#fridge-input').count(),1);
    const catalog=await page.evaluate(()=>window.RECIPES.map(r=>({id:r.id,cuisine:r.cuisine,type:r.type,category:r.category,spicy:r.spicy,vegetarian:r.vegetarian,time:r.time})));
    const excludedMealKinds=['小吃','甜品','烘焙','饮品'];
    const isMeal=recipe=>recipe.cuisine!=='小吃'&&!excludedMealKinds.includes(recipe.category)&&!excludedMealKinds.includes(recipe.type);
    const filterCases=[];
    for(const cuisine of [...new Set(catalog.map(r=>r.cuisine))].filter(cuisine=>cuisine!=='小吃'))for(const noSpicy of [false,true])for(const vegetarian of [false,true])for(const maxTime of [15,30,60]){
      const ids=catalog.filter(r=>r.cuisine===cuisine&&isMeal(r)&&(!noSpicy||!r.spicy)&&(!vegetarian||r.vegetarian)&&r.time<=maxTime).map(r=>r.id);
      filterCases.push({cuisine,noSpicy,vegetarian,maxTime,ids});
    }
    const smallPool=filterCases.find(f=>f.ids.length>0&&f.ids.length<10),emptyPool=filterCases.find(f=>!f.ids.length);
    assert.ok(smallPool&&emptyPool,'the real catalog supplies bounded and empty combinations of visible filters');
    ok('main-page search is absent while dedicated fridge input remains available');
    assert.ok(await page.locator('.step-row').count()>=4);
    const sequence=[await page.locator('#recipe-name').textContent()];
    for(let i=0;i<12;i++){await page.locator('#quick-draw').click();await ready();sequence.push(await page.locator('#recipe-name').textContent());}
    assert.equal(new Set(sequence).size,sequence.length);
    ok('1000 recipes load with ingredients and steps; 13 single recommendations do not repeat');
    for(const cuisine of ['川菜','湘菜','粤菜','鲁菜','苏菜','浙菜','闽菜','徽菜','家常菜']){
      await page.locator(`[data-cuisine="${cuisine}"]`).click();
      assert.equal(await page.locator('.cuisine-badge').textContent(),cuisine);
      const expected=catalog.filter(r=>r.cuisine===cuisine&&isMeal(r));
      assert.equal(await page.locator('#pool-count').textContent(),`${expected.length} 道可选`);
      const single=await page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent));
      assert.ok(isMeal(single),`${cuisine}: single draw excludes treats`);
      const candidateIds=await page.evaluate(cuisine=>window.RecipeCore.filterRandomRecipes(window.RECIPES,{cuisine}).map(recipe=>recipe.id),cuisine);
      assert.deepEqual(candidateIds,expected.map(recipe=>recipe.id),`${cuisine}: complete candidates`);
      await page.locator('[data-count="10"]').click();await ready();
      const drawn=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
      assert.equal(drawn.length,10);assert.equal(new Set(drawn).size,10);
      assert.ok(drawn.every(id=>expected.some(recipe=>recipe.id===id)),`${cuisine}: ten-dish batch excludes treats`);
      await page.locator('[data-count="1"]').click();await ready();
    }
    for(const category of ['热菜','凉菜','汤羹','主食','小吃','甜品','烘焙','饮品']){
      await page.locator(`[data-random-category="${category}"]`).click();
      assert.equal(await page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent).category),category);
      assert.equal(await page.locator('#pool-count').textContent(),`${category} · ${catalog.filter(r=>r.category===category).length} 道可选`);
    }
    for(const category of excludedMealKinds){
      await page.locator('#catalog-view-button').click();await page.locator('#catalog-reset').click();
      await page.locator(`[data-category="${category}"]`).click();
      const ids=await page.locator('.catalog-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.catalogRecipe));
      assert.ok(ids.length>0);assert.ok(ids.every(id=>catalog.find(recipe=>recipe.id===id).category===category));
    }
    await page.locator('#random-view-button').click();
    ok('nine meal cuisines exclude snacks, sweets, baking and drinks in singles and ten-dish batches; dedicated categories and browsing preserve them');
    await page.locator('#all-cuisines').click();
    assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'true');
    assert.ok((await page.locator('#pool-count').textContent()).endsWith(`${catalog.filter(isMeal).length} 道可选`));
    for(const count of [2,3,4,5,6,7,8,9,10]){
      await page.locator(`[data-count="${count}"]`).click();await ready();
      const ids=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
      assert.equal(ids.length,count);assert.equal(new Set(ids).size,count);
      assert.ok(ids.every(id=>isMeal(catalog.find(recipe=>recipe.id===id))));
    }
    await page.locator('#menu-grid .menu-card-open').nth(1).click();
    const selected=await page.locator('#recipe-name').textContent();
    await page.locator('.ingredient-row input').first().check();await page.locator('.step-checkbox').first().check();
    await page.locator('#menu-grid .menu-card-open').nth(2).click();await page.locator('#menu-grid .menu-card-open').nth(1).click();
    assert.equal(await page.locator('#recipe-name').textContent(),selected);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'recipe-name');
    assert.ok(await page.locator('.ingredient-row input').first().isChecked());assert.ok(await page.locator('.step-checkbox').first().isChecked());
    await page.locator('#save-menu').click();assert.equal(await page.locator('#favorite-count').textContent(),'10');
    ok('all batch sizes produce distinct main dishes; menu selection, checklists, and batch favorite work');
    await page.locator('[data-cuisine="家常菜"]').click();
    assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('[data-menu-recipe]').count(),10);
    await chooseRecipe(page,'番茄炒蛋');assert.ok(!await page.locator('#menu-section').isVisible());
    assert.equal(await page.locator('#recipe-name').textContent(),'番茄炒蛋');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'cooking-steps');
    await applyRandomFilters(smallPool);
    const smallIds=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
    if(smallPool.ids.length>1)assert.deepEqual([...smallIds].sort(),[...smallPool.ids].sort());
    else{assert.equal(smallIds.length,0);assert.ok(!await page.locator('#menu-section').isVisible());}
    assert.match(await page.locator('#shuffle-hint').textContent(),new RegExp(`只有 ${smallPool.ids.length} 道`));
    await page.locator('#quick-draw').click();await ready();
    assert.equal(await page.locator('[data-menu-recipe]').count(),smallPool.ids.length>1?smallPool.ids.length:0);
    await applyRandomFilters(emptyPool);assert.ok(await page.locator('#empty-state').isVisible());assert.ok(!await page.locator('#shuffle-dock').isVisible());
    await page.locator('#reset-filters').click();assert.equal(await page.locator('[data-menu-recipe]').count(),10);
    await page.locator('[data-count="1"]').click();await ready();
    await applyRandomFilters({noSpicy:true,vegetarian:true,maxTime:30});
    const dish=await page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent));
    assert.equal(dish.spicy,false);assert.equal(dish.vegetarian,true);assert.ok(dish.time<=30);
    ok('small pools never repeat to fill a menu; empty and combined-filter states recover');
    await reset();await page.reload();assert.equal(await page.locator('#favorite-count').textContent(),'10');
    await page.locator('#favorites-button').click();assert.equal(await page.locator('.collection-row').count(),10);
    const favoriteName=await page.locator('.collection-info h3').first().textContent();
    await page.locator('[data-view]').first().click();assert.equal(await page.locator('#recipe-name').textContent(),favoriteName);
    await page.locator('#favorites-button').click();await page.locator('[data-remove]').first().click();assert.equal(await page.locator('.collection-row').count(),9);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#collection-dialog').evaluate(el=>el.open),false);
    await page.locator('#history-button').click();assert.ok(await page.locator('.collection-row').count()<=1000);await page.locator('#close-dialog').click();
    ok('favorites survive reload, open and remove correctly; history is bounded and dialogs dismiss');
    await openFridge();
    await page.locator('#find-fridge').click();assert.match(await page.locator('#fridge-results').textContent(),/先填入/);
    await page.locator('#fridge-input').fill('西红柿2个、鸡蛋3个');await page.locator('#find-fridge').click();
    const tomato=page.locator('.fridge-card').filter({has:page.locator('h3',{hasText:'番茄炒蛋'})});
    assert.equal(await tomato.locator('.match-badge').textContent(),'主料已齐');
    await page.locator('#include-pantry').uncheck();assert.match(await tomato.locator('.match-badge').textContent(),/还差/);
    await page.locator('#include-pantry').check();await tomato.locator('[data-fridge-view]').click();
    assert.equal(await page.locator('#recipe-name').textContent(),'番茄炒蛋');
    await page.locator('#fridge-input').fill('番茄');assert.equal(await page.locator('#fridge-results').textContent(),'');
    await page.locator('#find-fridge').click();assert.match(await tomato.locator('.fridge-missing').textContent(),/鸡蛋/);
    await page.reload();assert.equal(await page.locator('#fridge-input').inputValue(),'番茄');
    ok('fridge aliases, missing ingredients, pantry switch, recipe navigation, clearing, and persistence work');
    const peer=await context.newPage();await peer.goto(url);
    await openFridge();await page.locator('#fridge-input').fill('鸡蛋、番茄');
    await peer.waitForFunction(()=>document.querySelector('#fridge-input').value==='鸡蛋、番茄');
    await peer.locator('#favorite-recipe').click();await peer.locator('#quick-draw').click();
    await page.reload();assert.equal(await page.locator('#fridge-input').inputValue(),'鸡蛋、番茄');await peer.close();
    ok('favorites and random draws in a second tab cannot overwrite saved fridge ingredients');
    await page.locator('[data-count="3"]').click();await ready();
    const menuBeforeClear=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
    const nameBeforeClear=await page.locator('#recipe-name').textContent();
    if(await page.locator('#favorite-recipe').getAttribute('aria-pressed')!=='true')await page.locator('#favorite-recipe').click();
    const clearPeer=await context.newPage();clearPeer.on('pageerror',error=>errors.push(error.message));await clearPeer.goto(url);
    await chooseRecipe(clearPeer,nameBeforeClear);
    const storageBeforeClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('chishane.v1')));
    assert.ok(storageBeforeClear.history.length>=3);assert.ok(storageBeforeClear.favorites.length>0);
    await page.locator('#favorites-button').click();await page.locator('[data-clear-collection="favorites"]').click();
    assert.equal(await page.locator('#favorite-count').textContent(),'0');assert.equal(await page.locator('#favorite-recipe').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('.collection-row').count(),0);assert.ok(await page.locator('[data-clear-collection="favorites"]').isDisabled());
    await clearPeer.waitForFunction(()=>document.querySelector('#favorite-count').textContent==='0'&&document.querySelector('#favorite-recipe').getAttribute('aria-pressed')==='false');
    const afterFavoriteClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('chishane.v1')));
    assert.deepEqual(afterFavoriteClear.favorites,[]);assert.deepEqual(afterFavoriteClear.history,storageBeforeClear.history);
    for(const field of ['fridgeText','includePantry'])assert.equal(afterFavoriteClear[field],storageBeforeClear[field]);
    await page.keyboard.press('Escape');await page.locator('#favorite-recipe').click();
    const favoritesBeforeHistoryClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('chishane.v1')).favorites);
    assert.equal(favoritesBeforeHistoryClear.length,1);await clearPeer.locator('#history-button').click();
    await page.locator('#history-button').click();await page.locator('[data-clear-collection="history"]').click();
    assert.equal(await page.locator('.collection-row').count(),0);assert.ok(await page.locator('[data-clear-collection="history"]').isDisabled());
    assert.equal(await page.locator('#recipe-name').textContent(),nameBeforeClear);
    assert.deepEqual(await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe)),menuBeforeClear);
    await clearPeer.waitForFunction(()=>document.querySelectorAll('.collection-row').length===0&&document.querySelector('[data-clear-collection="history"]').disabled);
    const afterHistoryClear=await page.evaluate(()=>JSON.parse(localStorage.getItem('chishane.v1')));
    assert.deepEqual(afterHistoryClear.history,[]);assert.deepEqual(afterHistoryClear.favorites,favoritesBeforeHistoryClear);
    for(const field of ['fridgeText','includePantry'])assert.equal(afterHistoryClear[field],storageBeforeClear[field]);
    await page.keyboard.press('Escape');await page.reload();
    const reloadStorage=await page.evaluate(()=>({saved:JSON.parse(localStorage.getItem('chishane.v1')),currentId:window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent).id}));
    assert.deepEqual(reloadStorage.saved.favorites,favoritesBeforeHistoryClear);assert.deepEqual(reloadStorage.saved.history,[reloadStorage.currentId]);
    for(const field of ['fridgeText','includePantry'])assert.equal(reloadStorage.saved[field],storageBeforeClear[field]);
    await clearPeer.close();
    ok('clearing favorites and history is independent, persists and syncs across tabs without changing the menu or fridge; reload adds only its new draw');
    for(const button of ['#favorites-button','#history-button','#about-button']){
      const name=await page.locator('#recipe-name').textContent();
      await page.locator(button).click();await page.keyboard.press('Escape');
      assert.equal(await page.locator('#recipe-name').textContent(),name);
    }
    await page.locator('#catalog-view-button').click();await page.locator('#catalog-reset').click();
    await page.locator('#catalog-search').fill('不存在XYZ');assert.ok(await page.locator('#catalog-empty').isVisible());
    await chooseRecipe(page,'麻婆豆腐');
    ok('dialogs preserve the selected recipe; catalog-only search recovers from no results and opens a dish');
    await page.waitForFunction(()=>{const img=document.querySelector('#recipe img');return img&&img.complete&&img.naturalWidth>0;});
    assert.ok(await page.locator('#recipe .photo-caption a').count()>=1);assert.equal(await page.locator('.food-art').count(),0);
    ok('local dish photograph loads with source attribution, replacing the old illustration');
    await reset();await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#quick-draw').click();await page.locator('[data-cuisine="湘菜"]').click();await page.waitForTimeout(500);
    assert.equal(await page.locator('.cuisine-badge').textContent(),'湘菜');
    await page.locator('#quick-draw').click();await applyRandomFilters(emptyPool);await page.waitForTimeout(500);
    assert.ok(await page.locator('#empty-state').isVisible());
    await page.locator('#reset-filters').click();await page.locator('#quick-draw').click();
    await chooseRecipe(page,'宫保鸡丁');await page.waitForTimeout(500);
    assert.equal(await page.locator('#recipe-name').textContent(),'宫保鸡丁');
    await page.emulateMedia({reducedMotion:'reduce'});await reset();
    ok('filter changes and catalog navigation cancel random animations without exposing stale recipes');
    for(const screen of screens){
      await page.setViewportSize(screen);await page.locator('[data-count="10"]').click();await ready();
      await openFridge();await page.locator('#fridge-input').fill('鸡蛋、番茄、土豆、青菜');await page.locator('#find-fridge').click();
      const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(sizes.scroll<=sizes.viewport,`${screen.width}px overflow: ${JSON.stringify(sizes)}`);
      if(screen.width<=390){assert.equal(await page.locator('#shuffle-dock').evaluate(el=>getComputedStyle(el).position),'static');assert.ok(await page.locator('#quick-draw').isVisible());}
      await openFridge(false);await page.locator('[data-count="1"]').click();await ready();await chooseRecipe(page,'宫保鸡丁');
      await page.waitForFunction(()=>{const img=document.querySelector('#recipe img');return img&&img.complete&&img.naturalWidth>0;});
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,`upgrade-${screen.width}.png`),fullPage:true});await reset();
    }
    ok('320, 390, 768, and 1440px menus and fridge layouts have no overflow; mobile redraw remains in document flow');
    const offline=await browser.newContext({viewport:screens[1],offline:true,reducedMotion:'reduce'});
    const file=await offline.newPage();file.on('pageerror',error=>errors.push(error.message));const network=[];
    file.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    await file.goto(pathToFileURL(path.join(root,'index.html')).href);
    assert.equal(await file.locator('#search-input').count(),0);await chooseRecipe(file,'麻婆豆腐');
    await file.waitForFunction(()=>{const img=document.querySelector('#recipe img');return img&&img.complete&&img.naturalWidth>0;});
    assert.deepEqual(network,[]);ok('HTML plus its photo folder works offline without runtime network requests');
    for(const blocked of [true,false]){
      const safe=await browser.newContext({reducedMotion:'reduce'});
      await safe.addInitScript(blocked=>{if(blocked)Object.defineProperty(window,'localStorage',{get(){throw Error('Storage blocked for test');}});else localStorage.setItem('chishane.v1','{broken');},blocked);
      const p=await safe.newPage();p.on('pageerror',error=>errors.push(error.message));await p.goto(url);
      await p.locator('#favorite-recipe').click();assert.equal(await p.locator('#favorite-count').textContent(),'1');
      await p.locator('[data-count="3"]').click();assert.equal(await p.locator('[data-menu-recipe]').count(),3);await safe.close();
    }
    ok('blocked or corrupted storage does not break recommendations or session favorites');
    assert.deepEqual(errors,[]);ok('no browser runtime errors');
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),url,checks,errors,viewports:screens},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
