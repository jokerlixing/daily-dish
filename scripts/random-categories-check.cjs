/* Full category coverage, regular-meal exclusions and rapid random-filter changes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.TEST_URL||'http://localhost:4173/';
const categories=['热菜','凉菜','汤羹','主食','小吃','甜品','烘焙','饮品'],excluded=['小吃','甜品','烘焙','饮品'];
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined});
  const checks=[],errors=[];
  const pass=message=>{checks.push(message);console.log('PASS '+message);};
  try{
    const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.waitForSelector('#recipe-name');
    const recipes=await page.evaluate(()=>window.RECIPES.map(r=>({id:r.id,name:r.name,category:r.category,cuisine:r.cuisine,type:r.type,time:r.time,vegetarian:r.vegetarian,spicy:r.spicy})));
    const byId=new Map(recipes.map(r=>[r.id,r]));
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#quick-draw').disabled);
    const selectedIds=async()=>{
      const menu=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
      return menu.length?menu:[await page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent).id)];
    };
    const assertSelection=async(predicate,count)=>{const ids=await selectedIds();assert.equal(ids.length,count);assert.equal(new Set(ids).size,count);assert.ok(ids.every(id=>predicate(byId.get(id))),JSON.stringify(ids.map(id=>byId.get(id))));};
    const clearExtraFilters=async()=>{
      for(const selector of ['#no-spicy','#vegetarian'])if(await page.locator(selector).getAttribute('aria-pressed')==='true')await page.locator(selector).click();
      await page.locator('#max-time').selectOption('0');
    };
    const pressedCategories=()=>page.locator('[data-random-category][aria-pressed="true"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.randomCategory));
    const visibleCategories=await page.locator('#random-category-options [data-random-category]').evaluateAll(nodes=>nodes.map(n=>n.dataset.randomCategory));
    assert.deepEqual(visibleCategories,categories);assert.deepEqual([...new Set(recipes.map(r=>r.category))].sort(),[...categories].sort());
    assert.equal(recipes.length,1000);assert.equal(await page.locator('[data-cuisine="小吃"]').count(),0);
    assert.ok(await page.locator('#catalog-cuisine').evaluate(select=>[...select.options].some(option=>option.value==='小吃')));
    assert.match(await page.locator('#all-cuisines-note').textContent(),/不含.*小吃.*甜品.*烘焙.*饮品/);
    for(const category of categories){
      const pool=recipes.filter(r=>r.category===category),button=page.locator(`[data-random-category="${category}"]`);
      assert.match(await button.textContent(),new RegExp(String(pool.length)));
      await button.click();assert.deepEqual(await pressedCategories(),[category]);assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('[data-cuisine][aria-pressed="true"]').count(),0);
      assert.equal(await page.locator('#pool-count').textContent(),`${category} · ${pool.length} 道可选`);
      for(const count of [1,10]){await page.locator(`[data-count="${count}"]`).click();await ready();await assertSelection(r=>r.category===category,Math.min(count,pool.length));}
    }
    pass('all 1000 recipes belong to one of eight visible categories; each category draws exactly matching single dishes and unique menus');

    // Dietary and cooking-time constraints are retained when category or cuisine changes.
    await page.locator('#no-spicy').click();await page.locator('#vegetarian').click();await page.locator('#max-time').selectOption('30');
    for(const category of categories){
      await page.locator(`[data-random-category="${category}"]`).click();
      for(const selector of ['#no-spicy','#vegetarian'])assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#max-time').inputValue(),'30');
      const pool=recipes.filter(r=>r.category===category&&!r.spicy&&r.vegetarian&&r.time<=30);
      assert.equal(await page.locator('#pool-count').textContent(),`${category} · ${pool.length} 道可选`);
      if(pool.length)await assertSelection(r=>r.category===category&&!r.spicy&&r.vegetarian&&r.time<=30,Math.min(10,pool.length));
      else assert.ok(await page.locator('#empty-state').isVisible());
    }
    await page.locator('[data-cuisine="川菜"]').click();assert.deepEqual(await pressedCategories(),[]);
    await page.locator('[data-random-category="饮品"]').click();assert.equal(await page.locator('[data-cuisine][aria-pressed="true"]').count(),0);
    await page.locator('#all-cuisines').click();assert.deepEqual(await pressedCategories(),[]);
    for(const selector of ['#no-spicy','#vegetarian'])assert.equal(await page.locator(selector).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#max-time').inputValue(),'30');
    await clearExtraFilters();
    const mealPool=recipes.filter(r=>r.cuisine!=='小吃'&&r.type!=='小吃'&&!excluded.includes(r.category));
    const corePool=await page.evaluate(()=>window.RecipeCore.filterRecipes(window.RECIPES,{allCuisines:true}).map(r=>r.id));
    assert.deepEqual(corePool,mealPool.map(r=>r.id));
    assert.equal(await page.locator('#pool-count').textContent(),`正餐 · ${mealPool.length} 道可选`);
    for(let i=0;i<12;i++){await page.locator('#quick-draw').click();await ready();await assertSelection(r=>!excluded.includes(r.category)&&r.cuisine!=='小吃'&&r.type!=='小吃',10);}
    await page.locator('[data-random-category="甜品"]').click();assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'false');
    await page.locator('[data-cuisine="粤菜"]').click();assert.deepEqual(await pressedCategories(),[]);await assertSelection(r=>r.cuisine==='粤菜',10);
    await page.locator('[data-random-category="烘焙"]').click();await page.locator('[data-cuisine=""]').click();assert.deepEqual(await pressedCategories(),[]);assert.equal(await page.locator('#pool-count').textContent(),'1000 道可选');
    pass('category/cuisine/all-cuisine choices are mutually exclusive while dietary filters persist; every regular-meal candidate excludes all four non-meal categories');

    // Trigger the switch before the 320 ms animation callback can run, then wait past it.
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(const category of categories){
      await page.evaluate(category=>{document.querySelector('#quick-draw').click();document.querySelector(`[data-random-category="${category}"]`).click();},category);
      await page.waitForTimeout(380);await ready();await assertSelection(r=>r.category===category,10);
    }
    await page.evaluate(()=>{document.querySelector('#quick-draw').click();document.querySelector('#all-cuisines').click();});
    await page.waitForTimeout(380);await ready();await assertSelection(r=>!excluded.includes(r.category)&&r.cuisine!=='小吃'&&r.type!=='小吃',10);
    await page.evaluate(()=>{document.querySelector('#quick-draw').click();document.querySelector('[data-random-category="饮品"]').click();document.querySelector('[data-cuisine="湘菜"]').click();});
    await page.waitForTimeout(380);await ready();await assertSelection(r=>r.cuisine==='湘菜',10);
    await page.emulateMedia({reducedMotion:'reduce'});
    pass('rapid category, cuisine and all-cuisine switches cancel pending animations without stale recommendations');

    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:width===320?740:900});
      const note=page.locator('#all-cuisines-note');await note.scrollIntoViewIfNeeded();
      const noteLayout=await note.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,height:r.height,scroll:document.documentElement.scrollWidth,clipped:el.scrollWidth>el.clientWidth};});
      assert.ok(noteLayout.left>=0&&noteLayout.right<=width&&noteLayout.height>0&&noteLayout.scroll<=width&&!noteLayout.clipped,JSON.stringify(noteLayout));
      for(const category of categories){
        const button=page.locator(`[data-random-category="${category}"]`);await button.scrollIntoViewIfNeeded();
        const r=await button.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width&&r.height>=44,`${width}px ${category}`);
        assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-random-category]')?.dataset.randomCategory,{x:r.x+r.width/2,y:r.y+r.height/2}),category);
        await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await ready();await assertSelection(dish=>dish.category===category,10);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('#random-category-options').screenshot({path:path.resolve(__dirname,`../artifacts/random-categories-${width}.png`)});
      await page.locator('.selection-panel').screenshot({path:path.resolve(__dirname,`../artifacts/random-filters-${width}.png`)});
    }
    pass('all eight category buttons and the regular-meal note fit at 320, 390 and 1440px; actual pointer taps select the correct category');
    assert.deepEqual(errors,[]);pass('no browser runtime errors');
    fs.writeFileSync(path.resolve(__dirname,'../artifacts/random-categories-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),url,categoryCounts:Object.fromEntries(categories.map(category=>[category,recipes.filter(r=>r.category===category).length])),regularMealCount:mealPool.length,checks,errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
