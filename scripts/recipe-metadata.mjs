// Ingredients with animal words in their established plant names stay vegetarian.
// Eggs and dairy are allowed; meat, seafood and animal seasonings are excluded.
const plants=/鸡毛菜|鸡腿菇|鸡油菌|鸡枞菌|鸡骨草|蟹味菇|杏鲍菇|羊肚菌|牛肝菌|鱼腥草|牛蒡|牛至|肉桂|桂圆肉|龙眼肉|椰肉|果肉|素鸡|素鸭|素鹅|素蚝油/g;
const animal=/肉|鸡(?!蛋)|鸭(?!蛋)|鹅(?!蛋)|鱼|虾|蟹|蚝|蛤|蛎|蚬|蛏|贝|牛(?!奶)|羊|猪|排骨|骨汤|骨头|火腿|腊肠|香肠|肥肠|明胶|吉利丁|鱿|鳝|鳗|海参|鲍|海米|海蜇|海鲜|沙茶酱|花甲|螺|蚕蛹|兔|鸽(?!蛋)|鹌鹑(?!蛋)|鹧鸪/;
export function isVegetarian(ingredients){
  return !ingredients.some(ingredient=>animal.test(ingredient.name.replace(plants,'')));
}
export function inferFlavor(seed){
  if(seed.flavor)return seed.flavor;
  if(seed.spicy)return '香辣';
  const ingredients=[...seed.mainIngredients,...seed.keySeasonings],names=ingredients.map(i=>i.name).join('、');
  const sweet=/糖|蜂蜜|炼乳|豆沙|巧克力/.test(names);
  if(seed.category==='饮品'){
    if(/盐/.test(names))return '咸香';
    if(/咖啡|拿铁/.test(seed.name))return '咖啡香';
    if(/无糖.*豆/.test(seed.name))return '豆香';
    if(sweet)return '香甜';
    if(/茶/.test(seed.name))return '茶香';
    if(/奶|乳/.test(names))return '奶香';
    if(/豆/.test(seed.name))return '豆香';
    if(/汁/.test(seed.name))return '果香';
    return '清香';
  }
  if(seed.category==='烘焙')return sweet?'香甜':/芝士|奶酪|肉|火腿/.test(names)?'咸香':'麦香';
  if(seed.category==='甜品')return '香甜';
  return '咸鲜';
}
