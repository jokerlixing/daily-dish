import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const recipes=['cuisines-north-west','cuisines-east-south','snacks','expanded'].flatMap(file=>read(`data/${file}.json`));
const photos=read('data/photos.json');
test('every recipe has a locally shipped, attributed real photograph',()=>{
  assert.equal(Object.keys(photos).length,recipes.length);
  const webpFiles=new Set();
  for(const recipe of recipes){
    const photo=photos[recipe.id];assert.ok(photo,`${recipe.name}: missing photo`);
    assert.match(photo.src,/^assets\/photos\/[\w-]+\.webp$/,recipe.name);
    assert.equal(typeof photo.exact,'boolean',recipe.name);
    for(const field of ['alt','credit','license'])assert.ok(typeof photo[field]==='string'&&photo[field].trim(),`${recipe.name}: ${field}`);
    for(const field of ['source','licenseUrl'])assert.match(photo[field],/^https?:\/\//,`${recipe.name}: ${field}`);
    webpFiles.add(photo.src);
  }
  for(const file of webpFiles){
    const bytes=fs.readFileSync(path.join(root,file));
    assert.ok(bytes.length>1000,`${file}: suspiciously small photo`);
    assert.equal(bytes.toString('ascii',0,4),'RIFF',file);
    assert.equal(bytes.toString('ascii',8,12),'WEBP',file);
  }
});
test('the shipped page contains the current photo manifest and sources',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const match=html.match(/window\.PHOTOS = (\{[^\r\n]*\});/);assert.ok(match,'missing photo manifest');
  const embedded=JSON.parse(match[1]);
  assert.deepEqual(embedded,photos);
  assert.ok(!html.includes('function foodArt('));
});
