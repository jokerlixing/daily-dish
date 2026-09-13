import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {filterRecipes,ShuffleBag,cuisines,parseIngredients,matchFridge}=require('../src/core.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,'');
const recipeFiles=fs.readdirSync(path.join(root,'data')).filter(name=>name.endsWith('.json')&&!/^photos(?:[.-]|$)/i.test(name)).sort();
const recipes=recipeFiles.flatMap(name=>JSON.parse(read(`data/${name}`)));

test('168 recipes cover eight cuisines, everyday dishes and snacks without duplicate identities',()=>{
  assert.equal(recipes.length,168);
  assert.equal(new Set(recipes.map(r=>r.id)).size,recipes.length);
  assert.equal(new Set(recipes.map(r=>r.name)).size,recipes.length);
  for(const cuisine of cuisines) assert.equal(recipes.filter(r=>r.cuisine===cuisine).length,cuisine==='小吃'?40:cuisine==='家常菜'?8:15,cuisine);
});
test('every recipe has usable quantities, preparation steps, and valid filter metadata',()=>{
  for(const recipe of recipes){
    for(const key of ['id','name','description','tip','flavor','type'])assert.equal(typeof recipe[key],'string',`${recipe.name}: ${key}`);
    assert.ok(recipe.time>0&&Number.isInteger(recipe.time),recipe.name);
    assert.equal(recipe.servings,2,recipe.name);
    assert.equal(typeof recipe.vegetarian,'boolean',recipe.name);
    assert.equal(typeof recipe.spicy,'boolean',recipe.name);
    assert.ok(recipe.ingredients.length>=1,recipe.name);
    assert.ok(recipe.steps.length>=4&&recipe.steps.every(step=>typeof step==='string'&&step.length>8),recipe.name);
    for(const ingredient of recipe.ingredients)assert.ok(ingredient.name&&ingredient.amount,`${recipe.name}: missing ingredient amount`);
  }
});
test('combined filters return only matching recipes, including ingredient searches',()=>{
  const pool=filterRecipes(recipes,{noSpicy:true,vegetarian:true,maxTime:30,query:'鸡蛋'});
  assert.ok(pool.length>0);
  for(const recipe of pool){assert.equal(recipe.spicy,false);assert.equal(recipe.vegetarian,true);assert.ok(recipe.time<=30);assert.ok(recipe.name.includes('鸡蛋')||recipe.ingredients.some(i=>i.name.includes('鸡蛋')));}
  assert.equal(filterRecipes(recipes,{query:'不存在的菜谱XYZ'}).length,0);
  assert.ok(filterRecipes(recipes,{cuisine:'川菜'}).every(r=>r.cuisine==='川菜'));
});

test('all-cuisines includes everyday dishes, overrides one cuisine and still respects other filters',()=>{
  const sample=[
    {id:'home',name:'鸡蛋',cuisine:'家常菜',spicy:false,vegetarian:true,time:10,ingredients:[]},
    {id:'sichuan',name:'鸡蛋',cuisine:'川菜',spicy:false,vegetarian:true,time:15,ingredients:[]},
    {id:'snack',name:'鸡蛋',cuisine:'小吃',spicy:false,vegetarian:true,time:10,ingredients:[]},
    {id:'regional-snack',name:'鸡蛋',cuisine:'闽菜',type:'小吃',spicy:false,vegetarian:true,time:10,ingredients:[]},
    {id:'spicy',name:'鸡蛋',cuisine:'湘菜',spicy:true,vegetarian:true,time:10,ingredients:[]},
    {id:'meat',name:'鸡蛋',cuisine:'粤菜',spicy:false,vegetarian:false,time:10,ingredients:[]},
    {id:'slow',name:'鸡蛋',cuisine:'鲁菜',spicy:false,vegetarian:true,time:60,ingredients:[]},
    {id:'other',name:'豆腐',cuisine:'苏菜',spicy:false,vegetarian:true,time:10,ingredients:[]}
  ];
  assert.deepEqual(filterRecipes(sample,{allCuisines:true,cuisine:'小吃',noSpicy:true,vegetarian:true,maxTime:15,query:'鸡蛋'}).map(r=>r.id),['home','sichuan']);
  assert.ok(filterRecipes(recipes,{allCuisines:true}).every(r=>r.cuisine!=='小吃'&&r.type!=='小吃'));
  assert.equal(filterRecipes(recipes,{allCuisines:true}).length,123);
  assert.deepEqual(filterRecipes(sample,{cuisine:'小吃'}).map(r=>r.id),['snack']);
});
test('a full random cycle has no repetitions and the next cycle does not repeat its boundary',()=>{
  const pool=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
  for(const random of [()=>0,()=>0.4,()=>0.999]){
    const bag=new ShuffleBag(random);let current=null;
    for(let cycle=0;cycle<5;cycle++){
      const round=[];
      for(let i=0;i<pool.length;i++){const next=bag.next(pool,current);assert.notEqual(next.id,current);round.push(next.id);current=next.id;}
      assert.equal(new Set(round).size,pool.length);
    }
  }
});
test('changing the candidate pool never leaks excluded dishes, empty and singleton pools are safe',()=>{
  const bag=new ShuffleBag(()=>0.1);
  bag.next(recipes);
  const limited=recipes.filter(r=>r.cuisine==='小吃').slice(0,3);
  for(let i=0;i<10;i++)assert.ok(limited.includes(bag.next(limited)));
  assert.equal(bag.next([]),null);
  assert.equal(bag.next([recipes[0]],recipes[0].id),recipes[0]);
});
test('manually opening a favorite cannot cause the next random draw to immediately repeat it',()=>{
  const pool=[{id:'a'},{id:'b'},{id:'c'}],bag=new ShuffleBag(()=>0.99);
  assert.equal(bag.next(pool).id,'c');
  assert.notEqual(bag.next(pool,'b').id,'b');
  assert.notEqual(bag.next(pool,'b').id,'b');
});

test('batches remain unique when they cross a shuffle cycle and preserve complete fair cycles',()=>{
  for(const size of [2,3,5,8]) for(const count of [1,2,3,5]) for(const random of [()=>0,()=>0.4,()=>0.999]){
    const pool=Array.from({length:size},(_,i)=>({id:String(i)})),bag=new ShuffleBag(random),drawn=[];
    let current=[];
    for(let round=0;round<30;round++){
      const batch=bag.nextBatch(pool,count,current);
      assert.equal(batch.length,Math.min(size,count));
      assert.equal(new Set(batch.map(r=>r.id)).size,batch.length,`duplicate in size=${size}, count=${count}`);
      if(count===1&&size>1&&current.length)assert.notEqual(batch[0].id,current[0]);
      drawn.push(...batch.map(r=>r.id));current=batch.map(r=>r.id);
    }
    for(let offset=0;offset+size<=drawn.length;offset+=size)assert.equal(new Set(drawn.slice(offset,offset+size)).size,size,`unfair cycle in size=${size}, count=${count}`);
  }
});

test('small or duplicated pools never fabricate extra batch choices, and invalid requests are empty',()=>{
  const a={id:'a'},b={id:'b'},bag=new ShuffleBag(()=>0.5);
  assert.deepEqual(new Set(bag.nextBatch([a,b,a],10).map(r=>r.id)),new Set(['a','b']));
  assert.deepEqual(bag.nextBatch([a],3,['a']),[a]);
  assert.deepEqual(bag.nextBatch([],3),[]);
  for(const count of [0,-1,NaN,Infinity])assert.deepEqual(bag.nextBatch([a,b],count),[]);
  assert.equal(bag.nextBatch([a,b],1.9).length,1);
});

test('reordering an unchanged pool does not reset the ongoing random cycle',()=>{
  const pool=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}],bag=new ShuffleBag(()=>0.99);
  const first=bag.nextBatch(pool,2);
  const second=bag.nextBatch([...pool].reverse(),2,first.map(r=>r.id));
  assert.equal(new Set([...first,...second].map(r=>r.id)).size,4);
});

test('successive batches avoid all currently shown dishes when enough alternatives exist',()=>{
  let seed=17;
  const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(const size of [4,5,6,8]){
    const pool=Array.from({length:size},(_,i)=>({id:String(i)})),bag=new ShuffleBag(random);
    let current=[];
    for(let round=0;round<40;round++){
      const batch=bag.nextBatch(pool,2,current).map(r=>r.id);
      assert.ok(batch.every(id=>!current.includes(id)),`avoidable repeat in pool of ${size}`);
      current=batch;
    }
  }
});

const dish=(id,names,time=20)=>({id,name:id,time,ingredients:names.map(name=>({name,amount:'适量'}))});
test('fridge input normalizes aliases, quantities, separators and cuts without losing food identity',()=>{
  assert.deepEqual(parseIngredients(' 西红柿，番茄、马铃薯2个;土豆块\n鸡蛋 蛋；去皮切丁胡萝卜，牛肉丝，鸡胸肉丁 '),['番茄','土豆','鸡蛋','胡萝卜','牛肉','鸡胸肉']);
  assert.deepEqual(parseIngredients('鱼豆腐、鱼、粉丝、鸡蛋清'),['鱼豆腐','鱼','粉丝','蛋清']);
  assert.deepEqual(parseIngredients('番茄 2 个，鸡蛋 200 g，切好的土豆'),['番茄','鸡蛋','土豆']);
  assert.deepEqual(parseIngredients(''),[]);
  assert.deepEqual(parseIngredients(null),[]);
  assert.deepEqual(parseIngredients('__proto__,constructor,土豆'),['__proto__','constructor','土豆']);
});

test('canCook requires every main ingredient, shows original names and ranks complete recipes first',()=>{
  const full=dish('番茄炒蛋',['西红柿','鸡蛋','盐','食用油','清水']);
  const partial=dish('番茄牛肉',['番茄','牛肉丝','姜片','生抽']);
  const unknown=dish('鱼汤',['鲈鱼','水']);
  const result=matchFridge([partial,unknown,full],parseIngredients('番茄、蛋'));
  assert.deepEqual(result.map(row=>row.recipe.id),['番茄炒蛋','番茄牛肉']);
  assert.deepEqual(result[0].matched,['西红柿','鸡蛋']);
  assert.deepEqual(result[0].missing,[]);assert.equal(result[0].canCook,true);assert.equal(result[0].score,1);
  assert.deepEqual(result[1].matched,['番茄']);assert.deepEqual(result[1].missing,['牛肉丝']);
  assert.equal(result[1].canCook,false);assert.equal(result[1].score,0.5);
});

test('the pantry switch changes required seasonings but never assumes eggs, flour, rice, noodles or broth',()=>{
  const tomato=dish('tomato',['番茄','鸡蛋','盐','植物油','水']);
  const withoutPantry=matchFridge([tomato],['西红柿','蛋'],{includePantry:false})[0];
  assert.equal(withoutPantry.canCook,false);assert.deepEqual(withoutPantry.missing,['盐','植物油']);
  assert.equal(matchFridge([tomato],['番茄','鸡蛋','盐','油'],{includePantry:false})[0].canCook,true);
  for(const name of ['鸡蛋','面粉','大米','面条','鸡汤','无盐鸡汤','猪肉','鱼','虾','糯米粉']){
    const row=matchFridge([dish(name,['土豆',name,'姜','葱','蒜','玉米淀粉'])],['马铃薯'])[0];
    assert.equal(row.canCook,false,name);assert.deepEqual(row.missing,[name]);
  }
});

test('specialty starches and steaming sauce are required even when a basic pantry is assumed',()=>{
  for(const name of ['蒸鱼豉油','小麦淀粉','红薯淀粉','土豆淀粉']){
    const row=matchFridge([dish(name,['鸡蛋',name])],['鸡蛋'])[0];
    assert.equal(row.canCook,false);assert.deepEqual(row.missing,[name]);
  }
});

test('fridge matching uses safe identities rather than ambiguous substring matches',()=>{
  const sample=[dish('beef',['土豆','牛肉丝']),dish('chicken',['土豆','鸡胸肉']),dish('fish',['土豆','鱼']),dish('tofu',['土豆','豆腐'])];
  const result=matchFridge(sample,['土豆','鸡胸肉丁','鱼豆腐']);
  assert.equal(result.find(row=>row.recipe.id==='chicken').canCook,true);
  for(const id of ['beef','fish','tofu'])assert.equal(result.find(row=>row.recipe.id===id).canCook,false,id);
  assert.equal(matchFridge([dish('eggs',['鸡蛋'])],['蛋清']).length,0);
  assert.equal(matchFridge([dish('eggwhite',['鸡蛋蛋清'])],['鸡蛋'])[0].canCook,true);
  assert.equal(matchFridge([dish('rice',['熟米饭'])],['大米']).length,0);
});

test('empty, water-only and unrelated fridge contents do not recommend all recipes',()=>{
  const sample=[dish('eggs',['鸡蛋','盐']),dish('tomato',['番茄','水'])];
  for(const input of ['',[],null,['水'],['不存在的食材']])assert.deepEqual(matchFridge(sample,input),[]);
  assert.deepEqual(matchFridge(sample,['盐']),[]);
});

test('explicit alternative ingredients work without treating required meat broth as water',()=>{
  assert.equal(matchFridge([dish('soup',['土豆','清水或现成无盐骨汤'])],['土豆'])[0].canCook,true);
  const row=matchFridge([dish('soup',['土豆','无盐鸭汤或鸡汤'])],['土豆','鸡汤'])[0];
  assert.equal(row.canCook,true);assert.deepEqual(row.matched,['土豆','无盐鸭汤或鸡汤']);
});
test('fridge matches ordinary ingredient names against the shipped recipe vocabulary',()=>{
  const cases=[
    ['ex-baked-sweet-potato','红薯'],
    ['es-ginger-scallion-shrimp','虾'],
    ['ex-zhajiang-noodles','面条、五花肉、黄瓜、黄豆酱、甜面酱'],
    ['es-shaxian-mixed-noodles','面条、花生酱'],
    ['ex-sesame-cold-noodles','面条、黄瓜、胡萝卜、纯芝麻酱']
  ];
  for(const [id,input] of cases){
    const recipe=recipes.find(recipe=>recipe.id===id);assert.ok(recipe,id);
    const row=matchFridge([recipe],input)[0];assert.ok(row,`${id}: no result`);
    assert.equal(row.canCook,true,`${id}: ${row.missing.join('、')}`);
    assert.deepEqual(row.missing,[]);
  }
});

test('the shipped combined pepper ingredient requires both colors and reports the missing one',()=>{
  const recipe=recipes.find(recipe=>recipe.id==='es-pineapple-pork');
  const base=['猪里脊','菠萝','鸡蛋','番茄酱'];
  const missingBoth=matchFridge([recipe],base)[0];
  assert.deepEqual(missingBoth.missing,['青甜椒','红甜椒']);
  const missingRed=matchFridge([recipe],[...base,'青甜椒'])[0];
  assert.equal(missingRed.canCook,false);assert.deepEqual(missingRed.missing,['红甜椒']);
  assert.ok(missingRed.matched.includes('青甜椒'));
  for(const peppers of [['青甜椒','红甜椒'],['青椒','红椒'],['青红甜椒']]){
    const complete=matchFridge([recipe],[...base,...peppers])[0];
    assert.equal(complete.canCook,true);assert.deepEqual(complete.missing,[]);
  }
});

test('new real-recipe aliases preserve species, cooked foods and distinctive sauce boundaries',()=>{
  const mapo=recipes.find(recipe=>recipe.id==='nw-mapo-tofu');
  const wrongMeat=matchFridge([mapo],['豆腐','猪肉','郫县豆瓣酱'])[0];
  assert.equal(wrongMeat.canCook,false);assert.ok(wrongMeat.missing.includes('牛肉末'));
  const wrongSauce=matchFridge([mapo],['豆腐','牛肉','豆瓣酱'])[0];
  assert.equal(wrongSauce.canCook,false);assert.ok(wrongSauce.missing.includes('郫县豆瓣酱'));
  const rice=recipes.find(recipe=>recipe.id==='es-yangzhou-fried-rice');
  const uncookedRice=matchFridge([rice],['大米','鸡蛋','虾仁','熟火腿','青豆','胡萝卜'])[0];
  assert.equal(uncookedRice.canCook,false);assert.ok(uncookedRice.missing.includes('熟米饭'));
  const noodles=recipes.find(recipe=>recipe.id==='es-shaxian-mixed-noodles');
  const wrongNut=matchFridge([noodles],['面条','芝麻酱'])[0];
  assert.equal(wrongNut.canCook,false);assert.ok(wrongNut.missing.includes('无糖花生酱'));
  const noPantry=matchFridge([recipes.find(recipe=>recipe.id==='es-ginger-scallion-shrimp')],['虾'],{includePantry:false})[0];
  assert.equal(noPantry.canCook,false);assert.ok(noPantry.missing.includes('生抽'));
});

test('the shipped HTML contains the complete data and has no external runtime assets',()=>{
  const html=read('index.html');
  assert.ok(html.includes('window.RECIPES = '));
  assert.ok(!/\b(?:src|href)=["']https?:\/\//.test(html.replace(/<a\b[^>]*>/g,'')));
  assert.ok(!html.includes('/* RECIPE_DATA */'));
  assert.ok(!html.includes('/* APP_SCRIPT */'));
  for(const recipe of recipes)assert.ok(html.includes(recipe.name));
});
