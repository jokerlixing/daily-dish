/* Browser boundaries for 1000-item collections. The five extra recipes exist only in this test browser. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.TEST_URL||'http://localhost:4173/';
const storageKey='chishane.v1',limit=1000;
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined});
  const errors=[],checks=[];
  const pass=message=>{checks.push(message);console.log('PASS '+message);};
  const saved=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
  const write=async(page,value)=>page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value});
  const ready=page=>page.waitForFunction(()=>document.querySelector('#recipe-name')&&!document.querySelector('#quick-draw').disabled);
  const currentId=page=>page.evaluate(()=>window.RECIPES.find(r=>r.name===document.querySelector('#recipe-name').textContent).id);
  const bounded=ids=>{assert.ok(ids.length<=limit);assert.equal(new Set(ids).size,ids.length);};
  const open=async(page,mode)=>{if(await page.locator('#collection-dialog').evaluate(el=>el.open))await page.locator('#close-dialog').click();await page.locator(mode==='favorites'?'#favorites-button':'#history-button').click();};
  const select=async(page,id)=>{
    if(await page.locator('#collection-dialog').evaluate(el=>el.open))await page.locator('#close-dialog').click();
    const name=await page.evaluate(id=>window.RECIPES.find(r=>r.id===id).name,id);
    await page.locator('#catalog-view-button').click();await page.locator('#catalog-reset').click();await page.locator('#catalog-search').fill(name);
    await page.locator(`[data-catalog-recipe="${id}"]`).click();
  };
  const track=page=>page.on('pageerror',error=>errors.push(error.message));
  const marker={fridgeText:'鸡蛋、番茄',includePantry:false,retainedNote:'unrelated saved data'};
  const preservesMarker=value=>{for(const key of Object.keys(marker))assert.equal(value[key],marker[key]);};
  try{
    const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:320,height:740}});
    const page=await context.newPage();track(page);await page.goto(url);await ready(page);
    const ids=await page.evaluate(()=>window.RECIPES.map(r=>r.id));assert.equal(ids.length,limit);
    await write(page,{...marker,favorites:ids,history:ids});await page.reload();await ready(page);
    let value=await saved(page);assert.deepEqual(value.favorites,ids);assert.equal(value.history.length,limit);
    assert.deepEqual([...value.history].sort(),[...ids].sort());assert.equal(value.history[0],await currentId(page));preservesMarker(value);
    for(const mode of ['favorites','history']){await open(page,mode);assert.equal(await page.locator('.collection-row').count(),limit);assert.match(await page.locator('#dialog-eyebrow').textContent(),/1000/);}
    await page.locator('#close-dialog').click();
    for(let i=0;i<3;i++){
      await page.locator('#quick-draw').click();await ready(page);value=await saved(page);bounded(value.history);assert.equal(value.history.length,limit);assert.equal(value.history[0],await currentId(page));
    }
    await page.locator('[data-count="10"]').click();await ready(page);
    for(let i=0;i<3;i++){
      if(i){await page.locator('#quick-draw').click();await ready(page);}
      const menu=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
      assert.equal(menu.length,10);assert.equal(new Set(menu).size,10);value=await saved(page);bounded(value.history);assert.equal(value.history.length,limit);assert.deepEqual(value.history.slice(0,10),menu);
      await page.locator('#save-menu').click();value=await saved(page);bounded(value.favorites);assert.equal(value.favorites.length,limit);assert.deepEqual(value.favorites.slice(0,10),menu);
    }
    pass('all 1000 real favorites and history entries survive reload; single and batch draws keep unique newest entries first');
    const peer=await context.newPage();track(peer);await peer.goto(url);await ready(peer);
    await open(page,'favorites');
    const before=await saved(page),clear=page.locator('[data-clear-collection="favorites"]');
    await clear.scrollIntoViewIfNeeded();
    const geometry=await clear.evaluate(el=>{const r=el.getBoundingClientRect();return{width:innerWidth,scroll:document.documentElement.scrollWidth,dialogScroll:document.querySelector('#collection-dialog').scrollWidth,dialogWidth:document.querySelector('#collection-dialog').clientWidth,left:r.left,right:r.right,height:r.height,uncovered:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};});
    assert.ok(geometry.scroll<=geometry.width);assert.ok(geometry.dialogScroll<=geometry.dialogWidth);assert.ok(geometry.left>=0&&geometry.right<=320&&geometry.height>=44&&geometry.uncovered,JSON.stringify(geometry));
    await clear.click();assert.equal(await page.locator('.collection-row').count(),0);assert.ok(await clear.isDisabled());
    await peer.waitForFunction(()=>document.querySelector('#favorite-count').textContent==='0');
    value=await saved(page);assert.deepEqual(value.favorites,[]);assert.deepEqual(value.history,before.history);preservesMarker(value);
    await write(peer,{...value,favorites:ids});await page.waitForFunction(()=>document.querySelectorAll('.collection-row').length===1000);
    assert.equal(await page.locator('#favorite-count').textContent(),'1000');
    await open(page,'history');await page.locator('[data-clear-collection="history"]').click();value=await saved(page);
    assert.deepEqual(value.history,[]);assert.deepEqual(value.favorites,ids);preservesMarker(value);
    await write(peer,{...value,history:ids});await page.waitForFunction(()=>document.querySelectorAll('.collection-row').length===1000);
    await page.locator('#close-dialog').click();await page.reload();await ready(page);
    value=await saved(page);assert.equal(value.favorites.length,limit);assert.equal(value.history.length,limit);preservesMarker(value);
    pass('1000-item dialogs clear independently, restore and sync across tabs; the clear button is tappable without overflow at 320px');
    await context.close();

    const synthetic=await browser.newContext({reducedMotion:'reduce'});
    await synthetic.addInitScript(()=>{
      Object.defineProperty(window,'RECIPES',{configurable:true,set(recipes){
        const additions=Array.from({length:5},(_,i)=>({...recipes[0],id:`collection-boundary-${i}`,name:`收藏边界测试菜${i}`}));
        Object.defineProperty(window,'RECIPES',{configurable:true,writable:true,value:[...recipes,...additions]});
      }});
    });
    const boundary=await synthetic.newPage();track(boundary);await boundary.goto(url);await ready(boundary);
    const allIds=await boundary.evaluate(()=>window.RECIPES.map(r=>r.id));assert.equal(allIds.length,1005);
    const malformed=[...allIds,allIds[0],'missing-recipe',null,42];
    await write(boundary,{...marker,favorites:malformed,history:malformed});await boundary.reload();await ready(boundary);
    value=await saved(boundary);assert.deepEqual(value.favorites,allIds.slice(0,limit));bounded(value.history);assert.equal(value.history.length,limit);preservesMarker(value);
    await open(boundary,'favorites');assert.equal(await boundary.locator('.collection-row').count(),limit);
    await select(boundary,allIds[1000]);await boundary.locator('#favorite-recipe').click();
    value=await saved(boundary);assert.deepEqual(value.favorites,[allIds[1000],...allIds.slice(0,999)]);assert.equal(value.history[0],allIds[1000]);bounded(value.history);
    const initialHistory=value.history;
    await select(boundary,allIds[1004]);value=await saved(boundary);assert.deepEqual(value.history,[allIds[1004],...initialHistory.filter(id=>id!==allIds[1004])].slice(0,limit));
    pass('an isolated 1005-recipe fixture proves restore and single-item additions cap at 1000, trim oldest entries and reject invalid IDs');
    const second=await synthetic.newPage();track(second);await second.goto(url);await ready(second);
    await open(boundary,'favorites');
    const reversed=[...allIds].reverse();await write(second,{...marker,favorites:reversed,history:reversed});
    await boundary.waitForFunction(id=>document.querySelector('[data-view]')?.dataset.view===id,allIds.at(-1));
    assert.equal(await boundary.locator('.collection-row').count(),limit);assert.equal(await boundary.locator('#favorite-count').textContent(),'1000');
    await open(boundary,'history');assert.equal(await boundary.locator('.collection-row').count(),limit);
    assert.deepEqual(await boundary.locator('[data-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.view)),reversed.slice(0,limit));
    await boundary.locator('#close-dialog').click();
    // A subsequent user action persists the bounded cross-tab state and leaves unrelated settings intact.
    await boundary.locator('[data-count="10"]').click();await ready(boundary);
    const menu=await boundary.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
    await write(second,{...marker,favorites:allIds.filter(id=>!menu.includes(id)),history:reversed});
    await boundary.waitForFunction(()=>document.querySelector('#favorite-count').textContent==='995');
    await boundary.locator('#save-menu').click();value=await saved(boundary);
    assert.equal(value.favorites.length,limit);assert.deepEqual(value.favorites.slice(0,10),menu);bounded(value.favorites);bounded(value.history);preservesMarker(value);
    await boundary.locator('#quick-draw').click();await ready(boundary);
    const freshMenu=await boundary.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));
    value=await saved(boundary);assert.equal(value.history.length,limit);assert.deepEqual(value.history.slice(0,10),freshMenu);bounded(value.history);
    pass('oversized cross-tab lists show at most 1000; batch favorites and recommendations preserve that cap when all ten entries are new');
    await synthetic.close();
    assert.deepEqual(errors,[]);pass('no browser runtime errors');
    const output=path.resolve(__dirname,'../artifacts');fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'collection-limits-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),url,checks,errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
