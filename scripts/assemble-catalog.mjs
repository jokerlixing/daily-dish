import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isVegetarian,inferFlavor} from './recipe-metadata.mjs';
import {readRecipes,expectedRecipeCount,canonicalRecipeName} from './catalog.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const existing=['cuisines-north-west','cuisines-east-south','snacks','expanded'].flatMap(file=>read(`data/${file}.json`));
const batches=['regional-and-hot','vegetable-cold-soup','staple-snack-dessert','home-meat'].flatMap(file=>read(`data/seeds/${file}-seeds.json`));
const categories=['热菜','凉菜','汤羹','主食','小吃','甜品','烘焙','饮品'];
const cuisines=['川菜','湘菜','粤菜','鲁菜','苏菜','浙菜','闽菜','徽菜','家常菜','小吃'];
const canonical=name=>name.replace(/[（(].*?[）)]|·.*$/g,'').replace(/西红柿/g,'番茄').replace(/马铃薯/g,'土豆').replace(/圆白菜|卷心菜/g,'包菜').trim();
const names=new Set(existing.map(r=>canonical(r.name))),errors=[];
const recipes=batches.map(seed=>{
  if(names.has(canonical(seed.name)))errors.push(`duplicate: ${seed.name}`);
  names.add(canonical(seed.name));
  const steps=Array.isArray(seed.notes)?seed.notes:seed.notes.split(/(?:^|[。；;\s])\d+[.、．]/).map(s=>s.trim()).filter(Boolean);
  if(steps.length<4||steps.some(s=>s.length<9))errors.push(`incomplete steps: ${seed.name} (${steps.map(s=>s.length)})`);
  if(!categories.includes(seed.category)||!cuisines.includes(seed.cuisine))errors.push(`invalid classification: ${seed.name}`);
  const ingredients=[...seed.mainIngredients,...seed.keySeasonings];
  if(ingredients.some(i=>!i.name||!i.amount)||!Number.isInteger(seed.time)||seed.time<=0)errors.push(`invalid ingredients/time: ${seed.name}`);
  const vegetarian=isVegetarian(ingredients);
  const type=['小吃','甜品','烘焙','饮品'].includes(seed.category)?'小吃':seed.category==='主食'?'主食':seed.category==='汤羹'?'汤羹':vegetarian?'素菜':'荤菜';
  const first=seed.mainIngredients.slice(0,3).map(i=>i.name).join('、');
  return {id:`cat-${createHash('sha1').update(seed.name).digest('hex').slice(0,12)}`,name:seed.name,cuisine:seed.cuisine,category:seed.category,type,method:seed.method,
    flavor:inferFlavor(seed),time:seed.time,
    difficulty:seed.difficulty||(/酥|炸|烤|焙|发酵|包|酿/.test(seed.method)||seed.time>80?'适中':'简单'),servings:2,
    description:seed.description||`${seed.name}的两人份家常做法，主要准备${first}。`,ingredients,
    steps:steps.map(s=>/[。！]$/.test(s)?s:s+'。'),tip:seed.tip||steps.at(-1),vegetarian,spicy:seed.spicy};
});
// One alias of the same sauerkraut-and-pork stew was merged in v2.2.0.
if(existing.length+recipes.length!==887)errors.push(`expected 887 retained recipes, got ${existing.length}+${recipes.length}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
fs.writeFileSync('data/catalog-expanded.json',JSON.stringify(recipes,null,2)+'\n');
const all=readRecipes(),count=field=>Object.fromEntries([...new Set(all.map(r=>r[field]))].map(value=>[value,all.filter(r=>r[field]===value).length]));
if(all.length!==expectedRecipeCount||new Set(all.map(r=>canonicalRecipeName(r.name))).size!==all.length)throw new Error('Full catalog is incomplete or contains duplicate dish names');
fs.writeFileSync('docs/catalog-1000-counts.json',JSON.stringify({total:all.length,cuisines:count('cuisine'),categories:count('category')},null,2)+'\n');
console.log(JSON.stringify({total:all.length,new:recipes.length,cuisines:count('cuisine'),categories:count('category')},null,2));
