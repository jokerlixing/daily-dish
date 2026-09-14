/* Today-plan integration, persistence, cross-tab changes and real mobile controls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.TEST_URL||'http://localhost:4173/',storageKey='chishane.v1';
const output=path.resolve(__dirname,'../artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined}),checks=[],errors=[];
  const pass=message=>{checks.push(message);console.log('PASS '+message);};
  const ready=page=>page.waitForFunction(()=>document.querySelector('#recipe-name')&&!document.querySelector('#quick-draw').disabled);
  const track=page=>page.on('pageerror',error=>errors.push(error.message));
  const saved=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),storageKey);
  const setSaved=(page,value)=>page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value});
  const plan=async page=>(await saved(page)).todayPlan||[];
  const current=page=>page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent).id);
  const today=async page=>{if(await page.locator('#collection-dialog').evaluate(el=>el.open))await page.locator('#close-dialog').click();await page.locator('#today-view-button').click();assert.ok(await page.locator('#today-view').isVisible());assert.ok(!await page.locator('#catalog-view').isVisible());assert.ok(!await page.locator('#random-view').isVisible());};
  const showRecipe=async(page,id)=>{
    if(await page.locator('#collection-dialog').evaluate(el=>el.open))await page.locator('#close-dialog').click();
    const name=await page.evaluate(id=>window.RECIPES.find(r=>r.id===id).name,id);
    await page.locator('#catalog-view-button').click();await page.locator('#catalog-reset').click();await page.locator('#catalog-search').fill(name);
    await page.locator(`[data-catalog-recipe="${id}"] .catalog-open`).click();assert.equal(await current(page),id);
  };
  const unaffected=(before,after,fields=['favorites','history','fridgeText','includePantry','testNote'])=>{for(const key of fields)assert.deepEqual(after[key],before[key],key+' must be preserved');};
  const inSlot=(page,id,slot)=>page.locator(`[data-today-slot="${slot}"] [data-today-item="${id}"]`);
  const unique=entries=>{assert.ok(entries.length<=1000);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);assert.ok(entries.every(e=>['lobby','breakfast','lunch','dinner'].includes(e.slot)));};
  const tap=async(page,button)=>{
    await button.scrollIntoViewIfNeeded();const r=await button.boundingBox(),width=page.viewportSize().width;
    assert.ok(r.x>=0&&r.x+r.width<=width&&r.height>=44,JSON.stringify({width,...r}));
    assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
    await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
  };
  try{
    const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}}),page=await context.newPage();track(page);
    await page.goto(url);await ready(page);
    const ids=await page.evaluate(()=>window.RECIPES.map(r=>r.id));assert.equal(ids.length,1000);
    await setSaved(page,{...(await saved(page)),testNote:'keep unrelated data',fridgeText:'番茄、鸡蛋',includePantry:true});await page.reload();await ready(page);
    assert.deepEqual(await page.locator('.view-switch button').evaluateAll(nodes=>nodes.map(n=>n.id)),['random-view-button','catalog-view-button','today-view-button']);
    assert.equal(await page.locator('#today-total').textContent(),'0');
    await today(page);assert.deepEqual(await page.locator('#today-plan-board [data-today-slot]').evaluateAll(nodes=>nodes.map(n=>n.dataset.todaySlot)),['lobby','breakfast','lunch','dinner']);
    assert.equal(await page.locator('[data-today-item]').count(),0);assert.ok(await page.locator('#clear-today-plan').isDisabled());
    await page.locator('#random-view-button').click();
    const added=[];
    const addAndKeep=async(button,kind)=>{
      const id=await button.getAttribute('data-add-today'),before=await saved(page),oldCount=(before.todayPlan||[]).length;
      await button.scrollIntoViewIfNeeded();const beforeLocation=await page.evaluate(()=>({scroll:scrollY,activeView:['random-view','catalog-view','today-view'].find(id=>!document.getElementById(id).hidden),dialog:document.querySelector('#collection-dialog').open,catalogPage:document.querySelector('#catalog-page').textContent}));
      await button.click();const after=await saved(page);assert.equal(after.todayPlan.length,oldCount+1);assert.deepEqual(after.todayPlan.find(e=>e.id===id),{id,slot:'lobby'});unaffected(before,after);
      const afterLocation=await page.evaluate(()=>({scroll:scrollY,activeView:['random-view','catalog-view','today-view'].find(id=>!document.getElementById(id).hidden),dialog:document.querySelector('#collection-dialog').open,catalogPage:document.querySelector('#catalog-page').textContent}));
      assert.deepEqual({...afterLocation,scroll:0},{...beforeLocation,scroll:0});assert.ok(Math.abs(beforeLocation.scroll-afterLocation.scroll)<=2,kind+' must retain scroll position');
      assert.ok(await page.locator(`[data-add-today="${id}"]`).evaluateAll(nodes=>nodes.length>0&&nodes.every(button=>button.disabled&&/已加入/.test(button.textContent))));assert.equal(await page.locator('#today-total').textContent(),String(oldCount+1));unique(after.todayPlan);added.push(id);return id;
    };
    const detailId=await addAndKeep(page.locator('#recipe [data-add-today]'),'recipe detail');
    await page.locator('[data-count="3"]').click();await ready(page);
    await addAndKeep(page.locator('#menu-grid [data-add-today]:not([disabled])').first(),'random menu');
    await page.locator('#catalog-view-button').click();await page.locator('#catalog-reset').click();await page.locator('#catalog-next').click();
    await addAndKeep(page.locator('#catalog-grid [data-add-today]:not([disabled])').first(),'catalog page');
    const favoriteId=ids.find(id=>!added.includes(id));await showRecipe(page,favoriteId);
    if(await page.locator('#favorite-recipe').getAttribute('aria-pressed')!=='true')await page.locator('#favorite-recipe').click();
    await page.locator('#favorites-button').click();await addAndKeep(page.locator(`#dialog-content [data-add-today="${favoriteId}"]`),'favorites dialog');await page.locator('#close-dialog').click();
    const historyId=ids.find(id=>!added.includes(id));await showRecipe(page,historyId);
    await page.locator('#history-button').click();await addAndKeep(page.locator(`#dialog-content [data-add-today="${historyId}"]`),'history dialog');await page.locator('#close-dialog').click();
    if(!await page.locator('#fridge-panel').evaluate(el=>el.open))await page.locator('#fridge-panel summary').click();
    await page.locator('#fridge-input').fill('鸡蛋、番茄、土豆、豆腐、青菜、猪肉');await page.locator('#find-fridge').click();
    await addAndKeep(page.locator('#fridge-results [data-add-today]:not([disabled])').first(),'fridge recommendation');
    assert.equal((await plan(page)).length,6);await today(page);assert.equal(await page.locator('[data-today-item]').count(),6);assert.equal(await page.locator('[data-today-slot="lobby"] [data-today-item]').count(),6);
    pass('all six recipe entry points add to the lobby without navigating, scrolling, changing favorites/history or duplicating dishes');

    for(const [i,slot] of ['breakfast','lunch','dinner'].entries()){
      const id=added[i],before=await saved(page);await page.locator(`[data-today-move="${id}"]`).selectOption(slot);
      assert.equal(await inSlot(page,id,slot).count(),1);assert.equal(await page.locator(`[data-today-item="${id}"]`).count(),1);assert.equal((await plan(page)).find(e=>e.id===id).slot,slot);unaffected(before,await saved(page));
    }
    await page.locator(`[data-today-move="${added[2]}"]`).selectOption('lobby');assert.equal(await inSlot(page,added[2],'lobby').count(),1);
    await page.locator(`[data-today-move="${added[2]}"]`).selectOption('dinner');
    await page.locator(`[data-today-view="${detailId}"]`).click();assert.ok(await page.locator('#random-view').isVisible());assert.equal(await current(page),detailId);
    const duplicate=page.locator(`#recipe [data-add-today="${detailId}"]`);assert.ok(await duplicate.isDisabled());assert.match(await duplicate.textContent(),/已加入/);
    // Disabled UI plus the delegated handler must both reject re-adding, preserving its meal assignment.
    await duplicate.evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.deepEqual((await plan(page)).find(e=>e.id===detailId),{id:detailId,slot:'breakfast'});assert.equal((await plan(page)).length,6);
    const beforeReload=await plan(page);await page.reload();await ready(page);await today(page);assert.deepEqual(await plan(page),beforeReload);assert.equal(await inSlot(page,detailId,'breakfast').count(),1);
    await page.addInitScript(()=>{const RealDate=Date;const tomorrow=RealDate.now()+86400000;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[tomorrow]));}static now(){return tomorrow;}};});
    await page.reload();await ready(page);await today(page);assert.deepEqual(await plan(page),beforeReload);
    pass('breakfast/lunch/dinner assignments, return to lobby and recipe details work; duplicate adds and next-day reloads preserve the plan');

    const peer=await context.newPage();track(peer);await peer.goto(url);await ready(peer);
    const peerId=ids.find(id=>!added.includes(id));await showRecipe(peer,peerId);await peer.locator('#recipe [data-add-today]').click();
    await page.waitForFunction(id=>!!document.querySelector(`[data-today-item="${id}"]`),peerId);assert.equal(await page.locator('#today-total').textContent(),'7');
    await page.locator(`[data-today-move="${peerId}"]`).selectOption('lunch');await today(peer);
    await peer.waitForFunction(id=>!!document.querySelector(`[data-today-slot="lunch"] [data-today-item="${id}"]`),peerId);
    await showRecipe(peer,peerId);await peer.locator('#favorite-recipe').click();
    if(!await peer.locator('#fridge-panel').evaluate(el=>el.open))await peer.locator('#fridge-panel summary').click();
    await peer.locator('#fridge-input').fill('跨标签保存的鸡蛋、番茄');await peer.locator('#include-pantry').uncheck();
    await page.waitForFunction(()=>document.querySelector('#fridge-input').value==='跨标签保存的鸡蛋、番茄'&&!document.querySelector('#include-pantry').checked&&JSON.parse(localStorage.getItem('chishane.v1')).includePantry===false);
    const beforeMove=await saved(page);await page.locator(`[data-today-move="${added[1]}"]`).selectOption('dinner');unaffected(beforeMove,await saved(page));
    const beforeRemove=await saved(page);await page.locator(`[data-today-remove="${detailId}"]`).click();assert.equal(await page.locator(`[data-today-item="${detailId}"]`).count(),0);assert.equal((await plan(page)).length,6);unaffected(beforeRemove,await saved(page));
    await showRecipe(page,detailId);assert.ok(await page.locator(`#recipe [data-add-today="${detailId}"]`).isEnabled());
    await page.locator(`#recipe [data-add-today="${detailId}"]`).click();assert.deepEqual((await plan(page)).find(e=>e.id===detailId),{id:detailId,slot:'lobby'});
    await today(peer);await today(page);const beforeClear=await saved(page);await page.locator('#clear-today-plan').click();assert.equal(await page.locator('[data-today-item]').count(),0);assert.ok(await page.locator('#clear-today-plan').isDisabled());
    await peer.waitForFunction(()=>document.querySelector('#today-total').textContent==='0'&&document.querySelectorAll('[data-today-item]').length===0);
    const afterClear=await saved(page);assert.deepEqual(afterClear.todayPlan,[]);unaffected(beforeClear,afterClear);await page.reload();await ready(page);await today(page);assert.equal(await page.locator('[data-today-item]').count(),0);
    pass('adding, moving, removing and clearing sync across tabs while preserving favorites, history, fridge preferences and unrelated saved fields');
    await context.close();

    for(const width of [320,390,1440]){
      const mobile=await browser.newContext({viewport:{width,height:width===320?740:900},reducedMotion:'reduce'}),p=await mobile.newPage();track(p);await p.goto(url);await ready(p);
      const id=await current(p);await tap(p,p.locator('#recipe [data-add-today]'));await tap(p,p.locator('#today-view-button'));
      const select=p.locator(`[data-today-move="${id}"]`);await select.scrollIntoViewIfNeeded();
      const r=await select.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width&&r.height>=44);
      assert.ok(await select.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
      await select.selectOption('breakfast');assert.equal(await inSlot(p,id,'breakfast').count(),1);
      await tap(p,p.locator(`[data-today-view="${id}"]`));assert.equal(await current(p),id);await tap(p,p.locator('#today-view-button'));
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px horizontal overflow');
      await p.locator('#today-view').screenshot({path:path.join(output,`today-plan-${width}.png`)});
      await tap(p,p.locator(`[data-today-remove="${id}"]`));assert.equal(await p.locator('[data-today-item]').count(),0);
      await p.locator('#random-view-button').click();await tap(p,p.locator('#recipe [data-add-today]'));await tap(p,p.locator('#today-view-button'));await tap(p,p.locator('#clear-today-plan'));assert.equal(await p.locator('#today-total').textContent(),'0');
      await mobile.close();
    }
    pass('320, 390 and 1440px layouts keep add, move, view, remove and clear controls inside the viewport and reachable by real taps');

    const dirty=await browser.newContext({reducedMotion:'reduce'});
    await dirty.addInitScript(({key,ids})=>localStorage.setItem(key,JSON.stringify({favorites:[ids[3]],history:[ids[4]],fridgeText:'鸡蛋',includePantry:false,todayPlan:[{id:ids[0],slot:'lunch'},{id:ids[0],slot:'dinner'},{id:ids[1],slot:'unknown'},{id:'does-not-exist',slot:'lobby'},null,42,{id:ids[2],slot:'breakfast'}]})),{key:storageKey,ids});
    const dirtyPage=await dirty.newPage();track(dirtyPage);await dirtyPage.goto(url);await ready(dirtyPage);await today(dirtyPage);
    const recovered=await dirtyPage.locator('#today-plan-board [data-today-item]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.todayItem,slot:node.closest('[data-today-slot]').dataset.todaySlot})));unique(recovered);assert.ok(recovered.some(e=>e.id===ids[0]&&e.slot==='lunch'));assert.ok(recovered.some(e=>e.id===ids[1]&&e.slot==='lobby'));assert.ok(recovered.some(e=>e.id===ids[2]&&e.slot==='breakfast'));assert.ok(recovered.every(e=>ids.includes(e.id)));
    await dirtyPage.locator(`[data-today-move="${ids[0]}"]`).selectOption('dinner');unique(await plan(dirtyPage));assert.equal((await plan(dirtyPage)).length,3);
    assert.equal(await dirtyPage.locator(`[data-today-item="${ids[0]}"]`).count(),1);assert.equal(await dirtyPage.locator('#fridge-input').inputValue(),'鸡蛋');assert.ok(!await dirtyPage.locator('#include-pantry').isChecked());
    await dirty.close();
    for(const blocked of [false,true]){
      const safe=await browser.newContext({reducedMotion:'reduce'});
      await safe.addInitScript(({key,blocked})=>{if(blocked)Object.defineProperty(window,'localStorage',{get(){throw Error('Storage blocked for test');}});else localStorage.setItem(key,'{broken');},{key:storageKey,blocked});
      const p=await safe.newPage();track(p);await p.goto(url);await ready(p);await p.locator('#recipe [data-add-today]').click();await today(p);assert.equal(await p.locator('[data-today-item]').count(),1);
      await p.locator('[data-today-move]').selectOption('dinner');assert.equal(await p.locator('[data-today-slot="dinner"] [data-today-item]').count(),1);await p.locator('#clear-today-plan').click();assert.equal(await p.locator('[data-today-item]').count(),0);await safe.close();
    }
    const writeDenied=await browser.newContext({reducedMotion:'reduce'});
    await writeDenied.addInitScript(key=>{localStorage.setItem(key,JSON.stringify({todayPlan:[],fridgeText:'鸡蛋'}));Storage.prototype.setItem=function(){throw Error('Storage writes denied for test');};},storageKey);
    const memoryPage=await writeDenied.newPage();track(memoryPage);await memoryPage.goto(url);await ready(memoryPage);
    const memoryFirst=await current(memoryPage);await memoryPage.locator('#recipe [data-add-today]').click();
    const memorySecond=ids.find(id=>id!==memoryFirst);await showRecipe(memoryPage,memorySecond);await memoryPage.locator('#recipe [data-add-today]').click();await today(memoryPage);
    assert.equal(await memoryPage.locator('[data-today-item]').count(),2);await memoryPage.locator(`[data-today-move="${memoryFirst}"]`).selectOption('lunch');
    assert.equal(await inSlot(memoryPage,memoryFirst,'lunch').count(),1);assert.equal(await inSlot(memoryPage,memorySecond,'lobby').count(),1);assert.deepEqual(await plan(memoryPage),[]);
    await memoryPage.locator('#clear-today-plan').click();assert.equal(await memoryPage.locator('[data-today-item]').count(),0);await writeDenied.close();
    pass('malformed entries, duplicate IDs, corrupt storage and denied storage recover safely without breaking the session plan');

    const intermittent=await browser.newContext({reducedMotion:'reduce'});
    await intermittent.addInitScript(key=>{
      const originalSet=Storage.prototype.setItem;
      if(localStorage.getItem(key)===null)originalSet.call(localStorage,key,JSON.stringify({todayPlan:[],favorites:[],fridgeText:'鸡蛋'}));
      window.__rejectedTodayWrites=0;
      Storage.prototype.setItem=function(name,value){
        if(name===key&&window.__rejectTodayId&&JSON.parse(value).todayPlan?.some(item=>item.id===window.__rejectTodayId)){
          window.__rejectedTodayWrites++;throw Error('Only unsaved today-plan writes are denied for test');
        }
        return originalSet.call(this,name,value);
      };
    },storageKey);
    const unsavedPage=await intermittent.newPage();track(unsavedPage);await unsavedPage.goto(url);await ready(unsavedPage);
    const unsavedId=ids[0],laterId=ids[1];await showRecipe(unsavedPage,unsavedId);
    await unsavedPage.evaluate(id=>window.__rejectTodayId=id,unsavedId);await unsavedPage.locator('#recipe [data-add-today]').click();
    assert.equal(await unsavedPage.evaluate(()=>window.__rejectedTodayWrites),1);assert.deepEqual(await plan(unsavedPage),[]);
    await unsavedPage.locator('#favorite-recipe').click();assert.ok((await saved(unsavedPage)).favorites.includes(unsavedId));
    await today(unsavedPage);assert.equal(await inSlot(unsavedPage,unsavedId,'lobby').count(),1);
    const unrelatedPeer=await intermittent.newPage();track(unrelatedPeer);await unrelatedPeer.goto(url);await ready(unrelatedPeer);
    await unrelatedPeer.locator('#fridge-panel summary').click();await unrelatedPeer.locator('#fridge-input').fill('其他标签保存的豆腐');
    await unsavedPage.waitForFunction(()=>document.querySelector('#fridge-input').value==='其他标签保存的豆腐');
    assert.equal(await inSlot(unsavedPage,unsavedId,'lobby').count(),1);assert.deepEqual(await plan(unsavedPage),[]);
    await unsavedPage.evaluate(()=>window.__rejectTodayId=null);await showRecipe(unsavedPage,laterId);await unsavedPage.locator('#recipe [data-add-today]').click();await today(unsavedPage);
    const recoveredPlan=await plan(unsavedPage);assert.equal(recoveredPlan.length,2);assert.ok(recoveredPlan.some(item=>item.id===unsavedId&&item.slot==='lobby'));assert.ok(recoveredPlan.some(item=>item.id===laterId&&item.slot==='lobby'));
    assert.ok((await saved(unsavedPage)).favorites.includes(unsavedId));assert.equal((await saved(unsavedPage)).fridgeText,'其他标签保存的豆腐');
    await today(unrelatedPeer);await unrelatedPeer.waitForFunction(id=>!!document.querySelector(`[data-today-item="${id}"]`),laterId);
    await unrelatedPeer.locator(`[data-today-move="${laterId}"]`).selectOption('lunch');
    await unsavedPage.waitForFunction(id=>!!document.querySelector(`[data-today-slot="lunch"] [data-today-item="${id}"]`),laterId);assert.equal(await inSlot(unsavedPage,unsavedId,'lobby').count(),1);
    await intermittent.close();
    pass('an unsaved plan survives successful favorite/history writes and unrelated cross-tab saves; recovery persists both dishes and resumes plan synchronization');
    assert.deepEqual(errors,[]);pass('no browser runtime errors');
    fs.writeFileSync(path.join(output,'today-plan-browser-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),url,checks,errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
