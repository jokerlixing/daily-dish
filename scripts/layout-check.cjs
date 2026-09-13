/* Browser regression for visible controls hidden behind the former mobile dock. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts');
const url=process.env.TEST_URL||'http://localhost:4173/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||undefined});
  try{
    const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[],checks=[];
    page.on('pageerror',error=>errors.push(error.message));
    for(const width of [320,360,375,390,430,600,700,701,720,768,1024,1440]){
      const height=width<=375?740:900;await page.setViewportSize({width,height});await page.goto(url);await page.waitForSelector('[data-count="9"]');
      const layout=await page.evaluate(()=>{
        const controls=[...document.querySelectorAll('.selection-panel button,.selection-panel input,.selection-panel select')];
        const covered=controls.flatMap(el=>{const r=el.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);if(!r.width||!r.height||y<0||y>=innerHeight)return[];const hit=document.elementFromPoint(x,y);return el.contains(hit)?[]:[{control:el.getAttribute('aria-label')||el.textContent.trim(),cover:hit?.outerHTML.slice(0,140)}];});
        return{covered,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};
      });
      assert.deepEqual(layout.covered,[],`${width}px visible controls covered`);assert.ok(layout.scrollWidth<=layout.width,`${width}px horizontal overflow: ${JSON.stringify(layout)}`);
      const nine=page.locator('[data-count="9"]');await nine.scrollIntoViewIfNeeded();
      const r=await nine.boundingBox();
      assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-count]')?.dataset.count,{x:r.x+r.width/2,y:r.y+r.height/2}),'9');
      await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
      await page.waitForFunction(()=>document.querySelectorAll('[data-menu-recipe]').length===9);
      const ids=await page.locator('[data-menu-recipe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.menuRecipe));assert.equal(new Set(ids).size,9);
      if(width<=700){assert.equal(await page.locator('#shuffle-dock').evaluate(el=>getComputedStyle(el).position),'static');assert.ok(await page.locator('#quick-draw').isVisible());}
      await page.locator('#quick-draw').scrollIntoViewIfNeeded();await page.locator('#quick-draw').click();
      assert.equal(await page.locator('[data-menu-recipe]').count(),9);
      if([320,390,768,1440].includes(width)){
        await page.locator('[data-count="1"]').click();await page.locator('#search-input').fill('宫保鸡丁');await page.locator('#search-input').press('Enter');
        await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,`layout-fixed-${width}.png`),fullPage:false});
      }
      checks.push(`${width}px: visible filter controls receive real taps; nine unique dishes; no horizontal overflow`);
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'layout-results.json'),JSON.stringify({url,checkedAt:new Date().toISOString(),checks,errors},null,2));
    console.log(checks.map(check=>'PASS '+check).join('\n'));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
