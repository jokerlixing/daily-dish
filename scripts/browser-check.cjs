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
    const search=async text=>{await page.locator('#search-input').fill(text);await page.locator('#search-input').press('Enter');};
    const reset=async()=>{await search('xyz-no-results');await page.locator('#reset-filters').click();};
    await page.goto(url);await page.waitForSelector('#recipe-name');
    assert.equal(await page.locator('.cuisine-option').count(),11);
    assert.equal(await page.locator('#total-count').textContent(),'168');
    assert.ok(await page.locator('.step-row').count()>=4);
    const sequence=[await page.locator('#recipe-name').textContent()];
    for(let i=0;i<12;i++){await page.locator('#quick-draw').click();await ready();sequence.push(await page.locator('#recipe-name').textContent());}
    assert.equal(new Set(sequence).size,sequence.length);
    ok('168 recipes load with ingredients and steps; 13 single recommendations do not repeat');
    for(const cuisine of ['川菜','湘菜','粤菜','鲁菜','苏菜','浙菜','闽菜','徽菜','家常菜','小吃']){
      await page.locator(`[data-cuisine="${cuisine}"]`).click();
      assert.equal(await page.locator('.cuisine-badge').textContent(),cuisine);
      assert.equal(await page.locator('#pool-count').textContent(),`${cuisine==='小吃'?40:cuisine==='家常菜'?8:15} 道可选`);
    }
    ok('all eight cuisines, everyday dishes, and snacks have the expected coverage');
    await page.locator('#all-cuisines').click();
    assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#pool-count').textContent(),'不含小吃 · 123 道可选');
    for(const count of [2,3,4,5,6,7,8,10]){
      await page.locator(`[data-count="${count}"]`).click();await ready();
      const ids=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
      assert.equal(ids.length,count);assert.equal(new Set(ids).size,count);
      assert.ok(await page.evaluate(ids=>ids.every(id=>{const recipe=window.RECIPES.find(r=>r.id===id);return recipe.cuisine!=='小吃'&&recipe.type!=='小吃';}),ids));
    }
    await page.locator('#menu-grid button').nth(1).click();
    const selected=await page.locator('#recipe-name').textContent();
    await page.locator('.ingredient-row input').first().check();await page.locator('.step-checkbox').first().check();
    await page.locator('#menu-grid button').nth(2).click();await page.locator('#menu-grid button').nth(1).click();
    assert.equal(await page.locator('#recipe-name').textContent(),selected);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'recipe-name');
    assert.ok(await page.locator('.ingredient-row input').first().isChecked());assert.ok(await page.locator('.step-checkbox').first().isChecked());
    await page.locator('#save-menu').click();assert.equal(await page.locator('#favorite-count').textContent(),'10');
    ok('all batch sizes produce distinct main dishes; menu selection, checklists, and batch favorite work');
    await page.locator('[data-cuisine="家常菜"]').click();
    assert.equal(await page.locator('#all-cuisines').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('[data-menu-recipe]').count(),8);
    assert.match(await page.locator('#menu-description').textContent(),/只有 8 道/);
    await search('番茄炒蛋');assert.ok(!await page.locator('#menu-section').isVisible());
    assert.equal(await page.locator('#recipe-name').textContent(),'番茄炒蛋');
    assert.match(await page.locator('#shuffle-hint').textContent(),/只有 1 道/);
    await page.locator('#quick-draw').click();await ready();assert.equal(await page.locator('#recipe-name').textContent(),'番茄炒蛋');
    await search('不存在XYZ');assert.ok(await page.locator('#empty-state').isVisible());assert.ok(!await page.locator('#shuffle-dock').isVisible());
    await page.locator('#reset-filters').click();assert.equal(await page.locator('[data-menu-recipe]').count(),10);
    await page.locator('[data-count="1"]').click();await ready();
    await page.locator('#no-spicy').click();await page.locator('#vegetarian').click();await page.locator('#max-time').selectOption('30');await search('鸡蛋');
    const dish=await page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent));
    assert.equal(dish.spicy,false);assert.equal(dish.vegetarian,true);assert.ok(dish.time<=30);
    ok('small pools never repeat to fill a menu; empty and combined-filter states recover');
    await reset();await page.reload();assert.equal(await page.locator('#favorite-count').textContent(),'10');
    await page.locator('#favorites-button').click();assert.equal(await page.locator('.collection-row').count(),10);
    const favoriteName=await page.locator('.collection-info h3').first().textContent();
    await page.locator('[data-view]').first().click();assert.equal(await page.locator('#recipe-name').textContent(),favoriteName);
    await page.locator('#favorites-button').click();await page.locator('[data-remove]').first().click();assert.equal(await page.locator('.collection-row').count(),9);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#collection-dialog').evaluate(el=>el.open),false);
    await page.locator('#history-button').click();assert.ok(await page.locator('.collection-row').count()<=20);await page.locator('#close-dialog').click();
    ok('favorites survive reload, open and remove correctly; history is bounded and dialogs dismiss');
    await page.locator('#fridge-panel summary').click();
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
    await page.locator('#fridge-panel summary').click();await page.locator('#fridge-input').fill('鸡蛋、番茄');
    await peer.waitForFunction(()=>document.querySelector('#fridge-input').value==='鸡蛋、番茄');
    await peer.locator('#favorite-recipe').click();await peer.locator('#quick-draw').click();
    await page.reload();assert.equal(await page.locator('#fridge-input').inputValue(),'鸡蛋、番茄');await peer.close();
    ok('favorites and random draws in a second tab cannot overwrite saved fridge ingredients');
    for(const button of ['#favorites-button','#history-button','#about-button']){
      await reset();
      await page.evaluate(selector=>{const input=document.querySelector('#search-input');input.value='完全没有这道菜XYZ';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(selector).click();},button);
      await page.keyboard.press('Escape');assert.ok(await page.locator('#empty-state').isVisible());
    }
    ok('opening any dialog commits a pending search instead of silently discarding it');
    await reset();await search('麻婆豆腐');
    await page.waitForFunction(()=>{const img=document.querySelector('#recipe img');return img&&img.complete&&img.naturalWidth>0;});
    assert.ok(await page.locator('#recipe .photo-caption a').count()>=1);assert.equal(await page.locator('.food-art').count(),0);
    ok('local dish photograph loads with source attribution, replacing the old illustration');
    await reset();await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#quick-draw').click();await page.locator('[data-cuisine="湘菜"]').click();await page.waitForTimeout(500);
    assert.equal(await page.locator('.cuisine-badge').textContent(),'湘菜');
    await page.locator('#search-input').fill('不存在XYZ');await page.locator('#quick-draw').click();await page.waitForTimeout(500);
    assert.ok(await page.locator('#empty-state').isVisible());
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#reset-filters').click();
    ok('filter changes cancel random animations and pending search cannot expose stale recipes');
    for(const screen of screens){
      await page.setViewportSize(screen);await page.locator('[data-count="10"]').click();await ready();
      await page.locator('#fridge-panel summary').click();await page.locator('#fridge-input').fill('鸡蛋、番茄、土豆、青菜');await page.locator('#find-fridge').click();
      const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(sizes.scroll<=sizes.viewport,`${screen.width}px overflow: ${JSON.stringify(sizes)}`);
      if(screen.width<=390){const rect=await page.locator('#shuffle-button').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=screen.height);}
      await page.locator('#fridge-panel summary').click();await page.locator('[data-count="1"]').click();await ready();await search('宫保鸡丁');
      await page.waitForFunction(()=>{const img=document.querySelector('#recipe img');return img&&img.complete&&img.naturalWidth>0;});
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,`upgrade-${screen.width}.png`),fullPage:true});await search('');
    }
    ok('320, 390, 768, and 1440px menus and fridge layouts have no overflow; mobile draw control stays visible');
    const offline=await browser.newContext({viewport:screens[1],offline:true,reducedMotion:'reduce'});
    const file=await offline.newPage();file.on('pageerror',error=>errors.push(error.message));const network=[];
    file.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    await file.goto(pathToFileURL(path.join(root,'index.html')).href);
    await file.locator('#search-input').fill('麻婆豆腐');await file.locator('#search-input').press('Enter');
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
