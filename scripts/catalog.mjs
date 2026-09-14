import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const expectedRecipeCount=1000;
export const recipeFiles=['cuisines-north-west','cuisines-east-south','snacks','expanded','catalog-expanded','additions-hot','additions-snack'];
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function readRecipes(rootDir=root){
  return recipeFiles.flatMap(name=>JSON.parse(fs.readFileSync(path.join(rootDir,`data/${name}.json`),'utf8').replace(/^\uFEFF/,'')));
}
export function canonicalRecipeName(name){
  return name.normalize('NFKC').replace(/[（(].*?[）)]|·.*$/g,'').replace(/西红柿/g,'番茄').replace(/马铃薯/g,'土豆').replace(/圆白菜|卷心菜/g,'包菜').replace(/宫爆/g,'宫保').replace(/木樨/g,'木须').replace(/\s+/g,'').trim();
}
