import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {photoIssues,createPhotoReleaseReport,authorizationRef,authorizedLicense} from './photo-release-check.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const recipeFiles=fs.readdirSync(path.join(root,'data')).filter(file=>file.endsWith('.json')&&!/^photos(?:[.-]|$)/i.test(file));
const recipes=recipeFiles.map(file=>read(`data/${file}`)).filter(Array.isArray).flat();
const photos=read('data/photos.json');
test('every recipe has a locally shipped, attributed real photograph',()=>{
  assert.equal(Object.keys(photos).length,recipes.length);
  for(const recipe of recipes){
    const photo=photos[recipe.id];assert.ok(photo,`${recipe.name}: missing photo`);
    assert.deepEqual(photoIssues(photo),[],recipe.name);
  }
});
test('all available photo entries retain valid restoration and rights metadata',()=>{
  const ids=new Set(recipes.map(recipe=>recipe.id));
  for(const [id,photo] of Object.entries(photos)){
    assert.ok(ids.has(id),`${id}: unknown recipe`);
    assert.deepEqual(photoIssues(photo),[],id);
  }
});
const authorizedPhoto={
  src:'assets/photos/authorization-test.webp',alt:'菜品实拍',credit:'原作者',exact:true,
  source:'https://home.meishichina.com/recipe-1.html',imageSource:'https://i8.meishichina.com/attachment/recipe/test.jpg',
  license:authorizedLicense,authorizationRef,crop:null,changes:'等比例缩放并压缩为 WebP'
};
test('user-authorized Meishichina photos use the local authorization record without a public license URL',()=>{
  assert.deepEqual(photoIssues(authorizedPhoto,{checkFile:false,requireMeishichina:true}),[]);
  assert.ok(photoIssues(authorizedPhoto,{rootDir:path.join(root,'__missing_authorization_fixture__'),checkFile:false}).some(issue=>issue.includes('authorization record')));
  for(const patch of [{authorizationRef:undefined},{authorizationRef:'../outside.md'},{license:'CC BY 4.0'},{licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}]){
    assert.ok(photoIssues({...authorizedPhoto,...patch},{checkFile:false}).length,JSON.stringify(patch));
  }
  const publicLicense={...authorizedPhoto,source:'https://commons.wikimedia.org/wiki/File:Food.jpg',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',authorizationRef:undefined};
  assert.deepEqual(photoIssues(publicLicense,{checkFile:false}),[]);
});
test('metadata rejects missing image URLs, invalid crop coordinates and unrelated authorization scopes',()=>{
  for(const imageSource of [undefined,'not a URL','data:image/png;base64,AA==','https://user:password@example.com/a.jpg']){
    assert.ok(photoIssues({...authorizedPhoto,imageSource},{checkFile:false}).some(issue=>issue.includes('imageSource')));
  }
  for(const crop of [[0,0,0,100],[-1,0,100,100],[0,0,100],[0,0,10.5,100]]){
    assert.ok(photoIssues({...authorizedPhoto,crop},{checkFile:false}).some(issue=>issue.includes('crop')));
  }
  assert.ok(photoIssues({...authorizedPhoto,source:'https://example.com/photo'},{checkFile:false}).some(issue=>issue.includes('only covers')));
  for(const field of ['alt','credit','changes'])assert.ok(photoIssues({...authorizedPhoto,[field]:' '},{checkFile:false}).length);
});
test('release validation requires original pages, disclosed references and existing image files',()=>{
  for(const patch of [{source:'https://meishichina.com/'},{source:'https://meishichina.com.example.org/recipe-1.html'},{exact:false},{credit:''}]){
    assert.ok(photoIssues({...authorizedPhoto,...patch},{checkFile:false,requireMeishichina:true}).length,JSON.stringify(patch));
  }
  assert.ok(photoIssues(authorizedPhoto,{requireMeishichina:true}).some(issue=>issue.includes('missing or unreadable')));
  const report=createPhotoReleaseReport([{id:'missing',name:'缺图'},{id:'reference',name:'参考'}],{reference:{...authorizedPhoto,exact:false},unknown:authorizedPhoto});
  assert.equal(report.ready.length,0);
  assert.equal(report.missing.length,1);
  assert.equal(report.needsReplacement.length,1);
  assert.deepEqual(report.unknownIds,['unknown']);
  // Reuse only a shipped file for the validator fixture; no test image is written.
  const localFile=Object.values(photos).find(photo=>fs.existsSync(path.join(root,photo.src))).src;
  const ready=createPhotoReleaseReport([{id:'verified',name:'已核对'}],{verified:{...authorizedPhoto,src:localFile}});
  assert.equal(ready.ready.length,1);
  assert.equal(ready.needsReplacement.length,0);
  const reference={...authorizedPhoto,src:localFile,exact:false,sourceTitle:'清炒冬瓜',referenceNote:'清炒冬瓜成品参考，具体调味以本页白油冬瓜菜谱为准。'};
  assert.deepEqual(photoIssues(reference,{requireMeishichina:true}),[]);
  assert.equal(createPhotoReleaseReport([{id:'reference',name:'白油冬瓜'}],{reference}).ready.length,1);
});
test('the shipped page contains the current photo manifest and sources',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const match=html.match(/window\.PHOTOS = (\{[^\r\n]*\});/);assert.ok(match,'missing photo manifest');
  const embedded=JSON.parse(match[1]);
  assert.deepEqual(embedded,photos);
  assert.ok(!html.includes('function foodArt('));
});
