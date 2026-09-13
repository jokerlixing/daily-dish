import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const files = ['data/cuisines-north-west.json','data/cuisines-east-south.json','data/snacks.json','data/expanded.json','data/catalog-expanded.json'];
const recipes = files.flatMap(file => JSON.parse(read(file)));
const photos = JSON.parse(read('data/photos.json'));
let html = read('src/template.html');
html = html.replace('/* APP_STYLES */', () => read('src/styles.css'))
  .replace('/* RECIPE_DATA */', () => `window.RECIPES = ${JSON.stringify(recipes).replace(/</g, '\\u003c')};\nwindow.PHOTOS = ${JSON.stringify(photos).replace(/</g, '\\u003c')};`)
  .replace('/* CORE_SCRIPT */', () => read('src/core.js'))
  .replace('/* APP_SCRIPT */', () => read('src/app.js'));
html = html.replace(/\r\n/g, '\n');
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`Built index.html: ${recipes.length} recipes, ${Object.keys(photos).length} photo mappings, ${(Buffer.byteLength(html)/1024).toFixed(1)} KB.`);
