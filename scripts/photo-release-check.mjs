// A release gate for the requested complete Meishichina photo replacement.
import fs from 'node:fs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const recipes=fs.readdirSync('data').filter(file=>file.endsWith('.json')&&!/^photos(?:[.-]|$)/i.test(file)).flatMap(file=>read(`data/${file}`));
const photos=read('data/photos.json');
const report={total:recipes.length,ready:[],missing:[],needsReplacement:[]};
for(const recipe of recipes){
  const photo=photos[recipe.id],item={id:recipe.id,name:recipe.name,cuisine:recipe.cuisine,category:recipe.category};
  if(!photo?.src){report.missing.push(item);continue;}
  let official=false;
  try{const host=new URL(photo.source).hostname;official=host==='meishichina.com'||host.endsWith('.meishichina.com');}catch{}
  const suitable=official&&photo.exact===true&&photo.credit&&fs.existsSync(photo.src);
  (suitable?report.ready:report.needsReplacement).push(item);
}
fs.mkdirSync('artifacts/888',{recursive:true});
fs.writeFileSync('artifacts/888/photo-release-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({total:report.total,ready:report.ready.length,missing:report.missing.length,needsReplacement:report.needsReplacement.length}));
if(report.missing.length||report.needsReplacement.length)process.exitCode=1;
