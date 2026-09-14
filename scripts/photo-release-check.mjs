// Shared photo validation and the release gate for complete Meishichina coverage.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readRecipes} from './catalog.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const authorizationRef='docs/photo-authorization.md';
export const authorizedLicense='经用户授权转载；原作者保留权利';
const parseUrl=value=>{
  if(typeof value!=='string'||!value.trim())return null;
  try{const url=new URL(value);return url.hostname&&!url.username&&!url.password?url:null;}catch{return null;}
};
export function isMeishichinaSource(value){
  const url=parseUrl(value),host=url?.hostname.toLowerCase();
  return Boolean(host&&(host==='meishichina.com'||host.endsWith('.meishichina.com')));
}
export function photoIssues(photo,{rootDir=root,requireMeishichina=false,checkFile=true}={}){
  if(!photo||typeof photo!=='object'||Array.isArray(photo))return ['missing photo metadata'];
  const issues=[];
  const validSrc=typeof photo.src==='string'&&/^assets\/photos\/[\w-]+\.webp$/.test(photo.src);
  if(!validSrc)issues.push('src must name a local assets/photos/*.webp file');
  for(const field of ['alt','credit','license','changes']){
    if(typeof photo[field]!=='string'||!photo[field].trim())issues.push(`${field} is required`);
  }
  if(typeof photo.exact!=='boolean')issues.push('exact must be boolean');
  const source=parseUrl(photo.source),imageSource=parseUrl(photo.imageSource);
  if(!source||!['https:','http:'].includes(source.protocol))issues.push('source must be an HTTP(S) original page URL');
  if(!imageSource||!['https:','http:'].includes(imageSource.protocol))issues.push('imageSource must be an HTTP(S) original image URL');
  const official=isMeishichinaSource(photo.source);
  if(official){
    if(source.protocol!=='https:'||!/^\/(?:recipe-\d+|space-\d+-do-blog-id-\d+)\.html$/.test(source.pathname))issues.push('Meishichina source must be an HTTPS original recipe or author blog page');
    if(photo.license!==authorizedLicense)issues.push('Meishichina license must retain the original author rights');
    if(photo.authorizationRef!==authorizationRef)issues.push('Meishichina authorizationRef must identify the recorded user authorization');
    if(photo.licenseUrl!==undefined&&photo.licenseUrl!==null&&photo.licenseUrl!=='')issues.push('Meishichina uses authorizationRef, not an invented public licenseUrl');
  }else{
    if(photo.authorizationRef)issues.push('the recorded user authorization only covers Meishichina photographs');
    const license=parseUrl(photo.licenseUrl);
    if(photo.rightsBasis==='source-attribution'){
      if(photo.licenseUrl)issues.push('unlicensed source attribution must not invent a public license URL');
      if(photo.license!=='原作者保留权利；来源页未声明开放许可')issues.push('source-attribution must accurately state the unspecified public license');
    }else if(!license||!['https:','http:'].includes(license.protocol))issues.push('licenseUrl must identify the original public license');
  }
  if(photo.authorizationRef===authorizationRef){
    const file=path.join(rootDir,authorizationRef);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.readFileSync(file,'utf8').trim())issues.push('authorization record is missing or empty');
  }
  if(photo.crop!==undefined&&photo.crop!==null){
    const crop=photo.crop;
    if(!Array.isArray(crop)||crop.length!==4||!crop.every(Number.isInteger)||crop[0]<0||crop[1]<0||crop[2]<=crop[0]||crop[3]<=crop[1])issues.push('crop must contain valid left, top, right, bottom pixel coordinates');
  }
  if(requireMeishichina){
    if(!official)issues.push('photo must come from Meishichina');
    if(photo.exact===false&&(!photo.sourceTitle?.trim()||!photo.referenceNote?.trim()))issues.push('reference photos must identify the actual source dish and explain differences');
  }
  if(checkFile&&validSrc){
    try{
      const bytes=fs.readFileSync(path.join(rootDir,photo.src));
      if(bytes.length<=1000||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')issues.push('photo file is not a valid shipped WebP');
    }catch{issues.push('photo file is missing or unreadable');}
  }
  return issues;
}
export function createPhotoReleaseReport(recipes,photos,{rootDir=root}={}){
  const report={total:recipes.length,ready:[],missing:[],needsReplacement:[],unknownIds:[],duplicateImages:[]};
  const ids=new Set(recipes.map(recipe=>recipe.id));
  report.unknownIds=Object.keys(photos).filter(id=>!ids.has(id));
  for(const recipe of recipes){
    const photo=photos[recipe.id],item={id:recipe.id,name:recipe.name,cuisine:recipe.cuisine,category:recipe.category};
    if(!photo?.src){report.missing.push(item);continue;}
    const issues=photoIssues(photo,{rootDir});
    if(photo.exact===false&&(!photo.sourceTitle?.trim()||!photo.referenceNote?.trim()))issues.push('reference photos require the actual dish title and differences');
    if(issues.length)report.needsReplacement.push({...item,issues});else report.ready.push(item);
  }
  const groups={file:new Map(),content:new Map(),original:new Map()};
  const remember=(type,key,id)=>{if(!key)return;const map=groups[type];map.set(key,[...(map.get(key)||[]),id]);};
  for(const recipe of recipes){
    const photo=photos[recipe.id];if(!photo)continue;
    if(typeof photo.src==='string'&&/^assets\/photos\/[\w-]+\.webp$/.test(photo.src)){
      remember('file',photo.src,recipe.id);
      try{remember('content',createHash('sha256').update(fs.readFileSync(path.join(rootDir,photo.src))).digest('hex'),recipe.id);}catch{}
    }
    const original=parseUrl(photo.imageSource);
    if(original){original.search='';original.hash='';remember('original',original.href,recipe.id);}
  }
  for(const [type,map] of Object.entries(groups))for(const [value,ids] of map)if(ids.length>1)report.duplicateImages.push({type,value,ids});
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
  const recipes=readRecipes();
  const report=createPhotoReleaseReport(recipes,read('data/photos.json'));
  fs.mkdirSync(path.join(root,'artifacts/1000'),{recursive:true});
  fs.writeFileSync(path.join(root,'artifacts/1000/photo-release-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({total:report.total,ready:report.ready.length,missing:report.missing.length,needsReplacement:report.needsReplacement.length,unknownIds:report.unknownIds.length,duplicateImages:report.duplicateImages.length}));
  if(report.missing.length||report.needsReplacement.length||report.unknownIds.length||report.duplicateImages.length)process.exitCode=1;
}
