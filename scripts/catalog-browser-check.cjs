const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.TEST_URL||'http://localhost:4173/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined});
  const errors=[],report=[];
  try{
    const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});await page.goto(url);await page.waitForSelector('#recipe-name');
      await page.locator('#catalog-view-button').click();
      assert.equal(await page.locator('.catalog-card').count(),24);
      assert.equal(await page.locator('#random-view').isVisible(),false);
      assert.ok(await page.locator('#catalog-prev').isDisabled());
      const first=await page.locator('.catalog-card').first().getAttribute('data-catalog-recipe');
      await page.locator('#catalog-next').click();
      assert.notEqual(await page.locator('.catalog-card').first().getAttribute('data-catalog-recipe'),first);
      assert.match(await page.locator('#catalog-page').textContent(),/^2 \/ /);
      await page.locator('[data-category="汤羹"]').click();
      assert.match(await page.locator('#catalog-page').textContent(),/^1 \/ /);
      const ids=await page.locator('.catalog-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.catalogRecipe));
      assert.ok(ids.length>0);assert.ok(await page.evaluate(ids=>ids.every(id=>window.RECIPES.find(r=>r.id===id).category==='汤羹'),ids));
      await page.locator('#catalog-search').fill('不存在菜谱XYZ');
      assert.equal(await page.locator('.catalog-card').count(),0);assert.ok(await page.locator('#catalog-empty').isVisible());
      await page.locator('#catalog-reset').click();
      await page.locator('#catalog-search').fill('番茄炒蛋');
      assert.equal(await page.locator('.catalog-card').count(),1);
      await page.locator('.catalog-card').click();
      assert.equal(await page.locator('#recipe-name').textContent(),'番茄炒蛋');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'recipe-name');
      await page.locator('#catalog-view-button').click();
      assert.equal(await page.locator('#catalog-search').inputValue(),'番茄炒蛋');
      await page.locator('#catalog-reset').click();
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('#catalog-grid')).gridTemplateColumns.split(' ').length}));
      assert.ok(layout.scroll<=width,JSON.stringify(layout));assert.equal(layout.columns,width<=700?2:width<=1000?3:4);
      await page.locator('#catalog-view-button').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(__dirname,`../artifacts/catalog-${width}.png`),fullPage:true});
      report.push({width,cards:24,columns:layout.columns,passed:true});
    }
    const allIds=[];
    do{
      allIds.push(...await page.locator('.catalog-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.catalogRecipe)));
      if(await page.locator('#catalog-next').isDisabled())break;
      await page.locator('#catalog-next').click();
    }while(true);
    assert.equal(allIds.length,888);assert.equal(new Set(allIds).size,888);
    assert.equal(await page.locator('#catalog-page').textContent(),'37 / 37');
    const migrated=await browser.newContext({reducedMotion:'reduce'});
    await migrated.addInitScript(()=>localStorage.setItem('chishane.v1',JSON.stringify({favorites:['sn-sesame-tangyuan'],history:['sn-sesame-tangyuan']})));
    const oldFavorite=await migrated.newPage();await oldFavorite.goto(url);await oldFavorite.locator('#favorites-button').click();
    assert.equal(await oldFavorite.locator('[data-view="es-ningbo-sesame-tangyuan"]').count(),1);
    await oldFavorite.locator('[data-view="es-ningbo-sesame-tangyuan"]').click();
    assert.equal(await oldFavorite.locator('#recipe-name').textContent(),'宁波黑芝麻汤圆');await migrated.close();
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'../artifacts/catalog-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
