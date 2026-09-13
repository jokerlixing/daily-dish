import fs from 'node:fs';
import {isVegetarian} from './recipe-metadata.mjs';
const files=['cuisines-north-west','cuisines-east-south','snacks','expanded'];
const groups={
  凉菜:['ex-garlic-pork','ex-mouthwatering-chicken','es-nanjing-salted-duck','es-yangzhou-hot-tofu-strips','ex-nanjing-mixed-vegetables','ex-suzhou-smoked-fish'],
  甜品:['nw-candied-sweet-potato','es-ningbo-sesame-tangyuan','es-fuzhou-taro-paste','es-xiamen-peanut-soup','sn-hongtang-ciba','sn-pumpkin-cake','sn-jiuniang-yuanzi','sn-double-skin-milk','ex-osmanthus-lotus','ex-bingfen','ex-redbean-soup','ex-mungbean-soup'],
  主食:['sn-jianbing-guozi','sn-shouzhua-bing','sn-congyou-bing','sn-pork-wonton','sn-roujiamo','sn-kaolengmian','sn-liangpi','sn-regan-mian','sn-youpo-mian','sn-suanla-fen','sn-congbao-hui','sn-ci-fantuan','sn-sticky-rice-shumai','sn-red-date-wotou','sn-chive-pocket','sn-egg-filled-pancake','sn-vegetable-rice-roll'],
  烘焙:['ex-egg-tarts']
};
const overrides=new Map(Object.entries(groups).flatMap(([category,ids])=>ids.map(id=>[id,category])));
for(const file of files){
  const filename=`data/${file}.json`,recipes=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  const unique=recipes.filter(recipe=>recipe.id!=='sn-sesame-tangyuan');
  for(const recipe of unique){
    recipe.category=overrides.get(recipe.id)||(['汤羹','主食','小吃'].includes(recipe.type)?recipe.type:'热菜');
    recipe.vegetarian=isVegetarian(recipe.ingredients);
    if(['荤菜','素菜'].includes(recipe.type))recipe.type=recipe.vegetarian?'素菜':'荤菜';
  }
  fs.writeFileSync(filename,JSON.stringify(unique,null,2)+'\n');
}
const photosFile='data/photos.json',photos=JSON.parse(fs.readFileSync(photosFile,'utf8').replace(/^\uFEFF/,''));
delete photos['sn-sesame-tangyuan'];
fs.writeFileSync(photosFile,JSON.stringify(photos,null,2)+'\n');
console.log('Classified the original catalog; merged duplicate sesame rice balls, preserving the Ningbo recipe.');
