// Import acquired photos without dropping earlier, still-needed mappings.
import fs from 'node:fs';
import path from 'node:path';
import {createPhotoReleaseReport} from './photo-release-check.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const files=['cuisines-north-west','cuisines-east-south','snacks','expanded','catalog-expanded'];
const recipes=files.flatMap(name=>read(`data/${name}.json`));
const photos=read('data/photos.json');
for(const file of fs.readdirSync('artifacts/meishi/downloaded').filter(file=>file.endsWith('.json'))){
  const {id,name,sha256,...photo}=read(path.join('artifacts/meishi/downloaded',file));
  if(!recipes.some(recipe=>recipe.id===id))throw new Error(`Unknown recipe ${id}`);
  photos[id]=photo;
}
const ordered=Object.fromEntries(recipes.filter(recipe=>photos[recipe.id]).map(recipe=>[recipe.id,photos[recipe.id]]));
const report=createPhotoReleaseReport(recipes,ordered);
if(process.argv.includes('--complete')&&(report.ready.length!==888||report.unknownIds.length)){
  throw new Error(`Photo release is incomplete: ${report.ready.length}/888`);
}
fs.writeFileSync('data/photos.json',JSON.stringify(ordered,null,2)+'\n');
const official=Object.values(ordered).filter(photo=>photo.authorizationRef==='docs/photo-authorization.md');
const exact=Object.values(ordered).filter(photo=>photo.exact).length,reference=Object.keys(ordered).length-exact;
const escape=value=>String(value||'').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
const lines=[
  '# 菜品照片来源与授权',
  '',
  `菜库共 ${recipes.length} 道；照片覆盖 ${Object.keys(ordered).length} 道，其中美食天下来源 ${official.length} 道。同名或同义菜品实拍 ${exact} 道、明确标注的同类参考图 ${reference} 道。`,
  '',
  '美食天下图片依据项目用户确认的转载授权使用；下厨房等其他公开来源依据用户选择补充，并逐项保留原作者、来源页和实际许可说明。参见 [来源与授权记录](../docs/photo-authorization.md)。本项目代码的 MIT 许可不涵盖照片。',
  '',
  '原作者水印保留；图片等比例缩放并压缩为 WebP。参考图的实际菜名、食材或做法差异在网页中单独说明，不改变本项目菜谱。完整的原图 URL、作者和加工记录保存在 `data/photos.json`。',
  '',
  '| 本页菜名 | 图片实际标题 | 类型 | 作者 | 来源 |',
  '| --- | --- | --- | --- | --- |'
];
for(const recipe of recipes){
  const photo=ordered[recipe.id];
  if(photo)lines.push(`| ${escape(recipe.name)} | ${escape(photo.sourceTitle||photo.alt)} | ${photo.exact?'对应实拍':'同类参考图'} | ${escape(photo.credit)} | [原菜谱](${photo.source}) |`);
}
fs.writeFileSync('data/photo-credits.md',lines.join('\n')+'\n');
console.log(JSON.stringify({recipes:recipes.length,meishichina:official.length,exact,reference,ready:report.ready.length,missing:report.missing.length,replacement:report.needsReplacement.length}));
