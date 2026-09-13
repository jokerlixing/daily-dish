"""Download curated real food photographs and retain attribution.

Requires Pillow. Commands: restore, research, preview, curated, build, finalize. Research results and visual
contact sheets are cached in artifacts/photo-research, never shipped to the site.
Final mapping is recipe ID -> source provenance in data/photos.json.
No image generation, third-party viewer, or remote code execution is used.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, html, io, json, re, sys, time
from urllib.error import HTTPError
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'artifacts' / 'photo-research'
OUT = ROOT / 'assets' / 'photos'
HEADERS = {'User-Agent': 'EatWhatFoodPhotoCollection/1.0 (local educational recipe website; Wikimedia attribution preserved)'}
API = 'https://commons.wikimedia.org/w/api.php'
HOW_REPO = 'https://github.com/Anduin2017/HowToCook'
HOW_RAW = 'https://raw.githubusercontent.com/Anduin2017/HowToCook/master/'
HOW_IMAGES = {
 'nw-mapo-tofu': 'dishes/meat_dish/麻婆豆腐/1.jpeg',
 'nw-kung-pao-chicken': 'dishes/meat_dish/宫保鸡丁/宫保鸡丁.jpg',
 'nw-twice-cooked-pork': 'dishes/meat_dish/回锅肉/1.jpeg',
 'nw-farmhouse-bowl': 'dishes/meat_dish/农家一碗香/农家一碗香成品.jpg',
 'nw-hunan-beef': 'dishes/meat_dish/小炒黄牛肉/小炒黄牛肉.jpg',
 'nw-oil-braised-shrimp': 'dishes/aquatic/油焖大虾/油焖大虾.jpg',
 'es-steamed-perch': 'dishes/aquatic/清蒸鲈鱼/清蒸鲈鱼.jpg',
 'es-blanched-choysum': 'dishes/vegetable_dish/白灼菜心/白灼菜心.jpg',
 'es-suzhou-braised-pork': 'dishes/meat_dish/红烧肉/000.jpg',
 'ex-mouthwatering-chicken': 'dishes/meat_dish/口水鸡/口水鸡.jpg',
 'ex-dry-pot-cauliflower': 'dishes/vegetable_dish/干锅花菜/干锅花菜.jpg',
 'ex-tiger-peppers': 'dishes/vegetable_dish/虎皮青椒/虎皮青椒.jpg',
 'ex-lotus-root-dice': 'dishes/vegetable_dish/小炒藕丁/小炒藕丁.jpg',
 'ex-bingfen': 'dishes/drink/冰粉/石凉粉(冰粉)成品1.jpg',
 'ex-egg-tarts': 'dishes/dessert/烤蛋挞/烤蛋挞.png',
 'sn-youpo-mian': 'dishes/staple/陕西油泼面/成品.png',
}
QUERIES = {
 'es-chicken-claypot-rice': '香菇滑鸡 煲仔饭', 'es-pineapple-pork': 'sweet sour pork pineapple',
 'es-blackbean-ribs': 'steamed spare ribs black bean', 'es-beef-ho-fun':'beef chow fun',
 'es-hakka-stuffed-tofu': 'Yong tau foo tofu', 'es-wintermelon-scallop-soup': 'winter melon soup',
 'es-garlic-steamed-luffa':'steamed luffa garlic', 'es-boiled-tofu-strips': '大煮干丝',
 'es-lions-head-meatballs': 'lion head meatballs', 'es-yangzhou-fried-rice':'Yangzhou fried rice',
 'es-suzhou-sauteed-shrimp':'清炒虾仁', 'es-nanjing-salted-duck':'Nanjing salted duck',
 'es-yangzhou-hot-tofu-strips': '烫干丝', 'es-suzhou-red-soup-noodles':'Suzhou noodles',
 'es-duck-blood-vermicelli':'duck blood vermicelli soup', 'es-wuxi-sauced-ribs':'Wuxi spare ribs',
 'es-longjing-shrimp':'Longjing shrimp', 'es-dongpo-pork':'Dongpo pork',
 'es-preserved-vegetable-pork':'梅干菜 烧肉', 'es-pian-er-chuan':'Pian er chuan',
 'es-west-lake-beef-soup':'West lake beef soup', 'es-oil-braised-bamboo':'油焖笋',
 'es-pickled-greens-croaker':'雪菜 黄鱼', 'es-hangzhou-vegetarian-goose':'素烧鹅',
 'es-fried-tofu-skin-rolls':'干炸响铃', 'es-ningbo-sesame-tangyuan':'tangyuan sesame',
 'es-fuzhou-lychee-pork':'lychee pork', 'es-red-rice-wine-chicken':'红糟鸡',
 'es-fujian-fried-vermicelli':'Fujian fried noodles', 'es-quanzhou-radish-rice':'萝卜饭',
 'es-xiamen-satay-noodles':'shacha noodles', 'es-fujian-oyster-omelette':'oyster omelette Fujian',
 'es-fuzhou-fishball-soup':'Fuzhou fish balls', 'es-fuzhou-taro-paste':'taro paste',
 'es-shaxian-mixed-noodles':'Shaxian noodles', 'es-xiamen-peanut-soup':'peanut soup',
 'nw-water-boiled-pork':'水煮肉片', 'nw-ants-climbing-tree':'ants climbing tree',
 'nw-pickled-greens-fish':'Suancai fish', 'nw-fish-fragrant-eggplant':'yuxiang eggplant',
 'nw-dry-fried-green-beans':'dry fried green beans', 'nw-white-oil-winter-melon':'白油冬瓜',
 'nw-chili-pork':'辣椒炒肉', 'nw-chopped-chili-fish-head':'剁椒鱼头',
 'nw-pickled-beans-pork':'酸豆角肉末', 'nw-steamed-cured-meats':'腊味合蒸',
 'nw-chili-steamed-taro':'剁椒 芋头', 'nw-grandma-preserved-greens':'外婆菜',
 'nw-dongan-chicken':'Dongan chicken', 'nw-mushu-pork':'moo shu pork',
 'nw-sweet-sour-pork':'糖醋里脊', 'nw-guota-tofu':'锅塌豆腐',
 'nw-vinegar-cabbage':'醋溜白菜', 'nw-candied-sweet-potato':'拔丝地瓜',
 'nw-radish-fritters':'萝卜丸子', 'nw-bean-sauce-chicken':'酱爆鸡丁',
 'nw-yellow-braised-chicken':'黄焖鸡', 'nw-clear-pork-meatball-soup':'pork meatball soup',
 'nw-huizhou-one-pot':'一品锅', 'nw-huizhou-fermented-mandarin-fish':'臭鳜鱼',
 'nw-pan-fried-hairy-tofu':'毛豆腐', 'nw-dried-bamboo-pork':'笋干 烧肉',
 'nw-wenzheng-bamboo-shoots':'问政山笋', 'nw-zhonghe-soup':'中和汤',
 'nw-red-braised-fish-tail':'红烧划水', 'nw-daoban-cured-pork':'刀板香',
 'nw-huangshan-pigeon-soup':'pigeon soup', 'nw-huizhou-tofu-skin-rolls':'烧鹅颈',
 'sn-jianbing-guozi':'jianbing guozi', 'sn-shouzhua-bing':'手抓饼',
 'sn-congyou-bing':'scallion pancake', 'sn-hongtang-ciba':'ciba rice cake',
 'sn-sesame-tangyuan':'tangyuan sesame', 'sn-pork-wonton':'wonton soup',
 'sn-roujiamo':'roujiamo', 'sn-savory-douhua':'douhua savory',
 'sn-kaolengmian':'grilled cold noodles', 'sn-liangpi':'liangpi',
 'sn-regan-mian':'hot dry noodles', 'sn-suanla-fen':'hot sour noodles',
 'sn-congbao-hui':'cong bao hui', 'sn-ci-fantuan':'ci fan tuan',
 'sn-sticky-rice-shumai':'糯米烧麦', 'sn-pumpkin-cake':'南瓜饼',
 'sn-jiuniang-yuanzi':'jiuniang tangyuan', 'sn-red-date-wotou':'wotou',
 'sn-langya-potato':'狼牙土豆', 'sn-chive-pocket':'jiucai hezi',
 'sn-egg-filled-pancake':'鸡蛋灌饼', 'sn-double-skin-milk':'double skin milk',
 'sn-vegetable-rice-roll':'rice noodle roll',
 'ex-garlic-pork':'蒜泥白肉', 'ex-mala-dry-pot':'mala xiang guo',
 'ex-sour-spicy-potato':'酸辣土豆丝', 'ex-tofu-pork-stirfry':'香干炒肉',
 'ex-chicken-giblets':'鸡杂', 'ex-cured-pork-garlic':'腊肉 蒜苗',
 'ex-scallion-lamb':'葱爆羊肉', 'ex-dried-shrimp-cabbage':'海米 白菜',
 'ex-scallion-tofu':'葱烧豆腐', 'ex-garlic-pork-slices':'蒜爆肉片',
 'ex-stirfried-kidney':'腰花', 'ex-oyster-sauce-lettuce':'蚝油生菜',
 'ex-celery-lily':'西芹百合', 'ex-shrimp-eggs':'滑蛋虾仁',
 'ex-bittermelon-beef':'bitter melon beef', 'ex-soy-chicken-wings':'soy sauce chicken wings',
 'ex-nanjing-mixed-vegetables':'南京 什锦菜', 'ex-osmanthus-lotus':'糯米藕',
 'ex-wuxi-stuffed-gluten':'面筋塞肉', 'ex-suzhou-smoked-fish':'熏鱼',
 'ex-whitebait-eggs':'银鱼 鸡蛋', 'ex-song-sister-fish-soup':'宋嫂鱼羹',
 'ex-pickled-greens-edamame':'雪菜毛豆', 'ex-ningbo-rice-cakes':'炒年糕',
 'ex-scallion-razor-clams':'葱油蛏子', 'ex-ningbo-braised-greens':'宁波烤菜',
 'ex-ginger-duck':'ginger duck', 'ex-oyster-tofu-soup':'oyster tofu soup',
 'ex-soy-water-seafood':'酱油水', 'ex-minnan-braised-noodles':'Hokkien lor mee',
 'ex-red-wine-eggplant':'红糟茄子', 'ex-huizhou-steamed-chicken':'徽州蒸鸡',
 'ex-mushroom-chestnut':'香菇 板栗', 'ex-jixi-flatbread':'绩溪 挞粿',
 'ex-jixi-fried-vermicelli':'绩溪 炒粉丝', 'ex-fengyang-stuffed-tofu':'凤阳酿豆腐',
 'ex-zhajiang-noodles':'zhajiangmian', 'ex-dandan-noodles':'dandan noodles',
 'ex-pan-fried-buns':'水煎包', 'ex-cabbage-dumplings':'jiaozi boiled',
 'ex-redbean-buns':'red bean baozi', 'ex-tea-eggs':'tea eggs',
 'ex-braised-chicken-feet':'braised chicken feet', 'ex-sesame-cold-noodles':'sesame cold noodles',
 'ex-redbean-soup':'red bean soup', 'ex-mungbean-soup':'mung bean soup',
 'ex-baked-sweet-potato':'roasted sweet potato', 'ex-salt-pepper-mushrooms':'椒盐蘑菇',
 'ex-fried-chicken-strips':'fried chicken strips', 'ex-scallion-oil-noodles':'葱油拌面',
 'ex-tomato-eggs':'tomato scrambled eggs', 'ex-potato-beef':'土豆 炖牛肉',
 'ex-cucumber-eggs':'黄瓜 鸡蛋', 'ex-mushroom-greens':'香菇 青菜',
 'ex-garlic-broccoli':'garlic broccoli', 'ex-cola-chicken-wings':'coca cola chicken wings',
 'ex-seaweed-egg-soup':'seaweed egg soup', 'ex-minced-pork-custard':'steamed egg minced pork',
 'ref-mushrooms':'stir fried mushrooms', 'ref-edamame':'edamame mustard greens',
 'ref-luffa':'steamed loofah', 'ref-sour-potato':'Sichuan shredded potatoes',
 'ref-cabbage':'stir fried cabbage', 'ref-lamb':'scallion lamb',
 'ref-fried-tofu':'pan fried tofu', 'ref-bamboo':'braised bamboo shoots',
 'ref-pickled-beans':'minced pork pickled beans', 'ref-cured-meat':'steamed Chinese sausage',
 'ref-vermicelli':'fried vermicelli', 'ref-razor-clams':'steamed razor clams',
 'ref-rice-cakes':'Shanghai rice cakes', 'ref-pork-soup':'Chinese meatball soup',
 'ref-minced-tofu':'tofu mushroom soup', 'ref-crispy-mushroom':'fried oyster mushroom',
 'ref-steamed-chicken':'Chinese steamed chicken', 'ref-cold-chicken':'mouth watering chicken',
 'ref-broccoli':'cooked broccoli', 'ref-bokchoy':'bok choy mushroom',
 'ref-egg-soup':'egg drop soup', 'ref-tofu-pudding':'savoury tofu pudding'
}
def fetch(url):
    disk = CACHE / 'downloads' / (hashlib.sha256(url.split('?utm_')[0].encode()).hexdigest()+'.bin')
    cacheable = '/w/api.php?' not in url
    if cacheable and disk.exists(): return disk.read_bytes()
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=HEADERS), timeout=35) as response:
                content=response.read()
                if cacheable:
                    disk.parent.mkdir(parents=True,exist_ok=True);disk.write_bytes(content)
                return content
        except HTTPError as error:
            if attempt == 2: raise
            delay = max(4, int(error.headers.get('Retry-After', '60'))) if error.code == 429 else 3
            print('SERVER BACKOFF',error.code,delay,flush=True)
            time.sleep(delay)
        except Exception:
            if attempt == 2: raise
            time.sleep(1 + attempt)
def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', str(value)))).strip()
def recipes():
    result = []
    for path in sorted((ROOT / 'data').glob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(data, list): result.extend(data)
    return result
def search_recipe(recipe):
    rid = recipe['id']; cache = CACHE / (rid + '.json')
    if cache.exists(): return rid, len(json.loads(cache.read_text(encoding='utf-8')))
    query = QUERIES.get(rid, re.split('[（·]', recipe['name'])[0])
    params = dict(action='query', format='json', generator='search', gsrsearch=query,
                  gsrnamespace=6, gsrlimit=5, prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=900)
    raw = json.loads(fetch(API + '?' + urlencode(params)))
    choices = []
    for page in sorted(raw.get('query',{}).get('pages',{}).values(), key=lambda p:p.get('index',99)):
        info = page.get('imageinfo',[{}])[0]; meta=info.get('extmetadata',{})
        text = clean(' '.join(str(m.get('value','')) for m in meta.values()))
        if re.search(r'AI.generated|AI-generated|stable diffusion|midjourney|DALL.E|generative AI',text,re.I): continue
        if not re.search(r'\.(jpe?g|png|webp)$',page['title'],re.I): continue
        license = meta.get('LicenseShortName',{}).get('value','')
        if not re.search(r'CC|Public domain|GFDL',license,re.I): continue
        choices.append(dict(title=page['title'],query=query,description=clean(meta.get('ImageDescription',{}).get('value','')),
            categories=clean(meta.get('Categories',{}).get('value','')),
            image=info.get('thumburl',info.get('url')),original=info.get('url'),source=info.get('descriptionurl'),
            credit=clean(meta.get('Artist',{}).get('value','Wikimedia Commons contributor')),
            license=clean(license),licenseUrl=meta.get('LicenseUrl',{}).get('value',''),
            width=info.get('width'),height=info.get('height')))
    cache.write_text(json.dumps(choices,ensure_ascii=False,indent=2),encoding='utf-8')
    return rid,len(choices)
def research():
    CACHE.mkdir(parents=True,exist_ok=True)
    allrecipes=recipes()
    existing={r['id'] for r in allrecipes}
    allrecipes += [dict(id=rid,name=query) for rid,query in QUERIES.items() if rid not in existing]
    for recipe in allrecipes:
        cached=(CACHE/(recipe['id']+'.json')).exists()
        try: print(*search_recipe(recipe),flush=True)
        except Exception as e: print('FAILED',recipe['id'],str(e),flush=True)
        if not cached: time.sleep(6.2)
def preview():
    from math import ceil
    CACHE.mkdir(parents=True,exist_ok=True)
    thumbdir=CACHE/'thumbnails';thumbdir.mkdir(exist_ok=True)
    tasks=[]
    for recipe in recipes():
        cache=CACHE/(recipe['id']+'.json')
        if cache.exists():
            for index,entry in enumerate(json.loads(cache.read_text(encoding='utf-8'))[:3]):
                tasks.append((recipe,index,entry))
    def thumb(task):
        recipe,index,entry=task; path=thumbdir/(recipe['id']+'-'+str(index)+'.jpg')
        if not path.exists():
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(fetch(entry['image'])))).convert('RGB')
            im.thumbnail((300,200));im.save(path,quality=80)
        return task,path
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for f in concurrent.futures.as_completed([pool.submit(thumb,t) for t in tasks]):
            try:results.append(f.result())
            except Exception as e:print('THUMB FAILED',str(e),flush=True)
    results.sort(key=lambda p:(p[0][0]['id'],p[0][1]))
    for offset in range(0,len(results),30):
        batch=results[offset:offset+30];sheet=Image.new('RGB',(1500,ceil(len(batch)/5)*245),'#fff')
        draw=ImageDraw.Draw(sheet)
        for i,((recipe,index,entry),path) in enumerate(batch):
            col=i%5;row=i//5; im=Image.open(path);sheet.paste(im,(col*300,row*245))
            draw.text((col*300+3,row*245+200),recipe['id']+' #'+str(index),font=font,fill='#111')
            draw.text((col*300+3,row*245+220),recipe['name'][:18],font=font,fill='#111')
        sheet.save(CACHE/('sheet-'+str(offset//30+1)+'.jpg'),quality=88)
    print('previewed',len(results),'candidates')
def curated():
    """Download one manually selected candidate per dish, serially and slowly."""
    choices=json.loads((CACHE/'review-choices.json').read_text(encoding='utf-8'))
    thumbdir=CACHE/'thumbnails';thumbdir.mkdir(exist_ok=True)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
    results=[]
    for rid,index in choices.items():
        meta=CACHE/(rid+'.json')
        if not meta.exists(): continue
        data=json.loads(meta.read_text(encoding='utf-8'))
        if index>=len(data):continue
        entry=data[index]; path=thumbdir/(rid+'-'+str(index)+'.jpg')
        try:
            content=fetch(entry['image'])
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert('RGB')
            im.thumbnail((300,200));im.save(path,quality=88)
            results.append((rid,index,path));print('REVIEW',rid,index,flush=True)
            time.sleep(2.5)
        except Exception as e:print('REVIEW FAILED',rid,str(e),flush=True)
    for offset in range(0,len(results),30):
        batch=results[offset:offset+30];sheet=Image.new('RGB',(1500,((len(batch)+4)//5)*240),'white');draw=ImageDraw.Draw(sheet)
        for i,(rid,index,path) in enumerate(batch):
            col=i%5;row=i//5;sheet.paste(Image.open(path),(col*300,row*240))
            draw.text((col*300+3,row*240+202),rid+' #'+str(index),font=font,fill='#111')
        sheet.save(CACHE/('curated-'+str(offset//30+1)+'.jpg'),quality=91)
    print('CURATED',len(results),flush=True)
def build():
    selected=json.loads((CACHE/'selected.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True,exist_ok=True);result={}
    byid={r['id']:r for r in recipes()}
    byid.update({rid:dict(id=rid,name=query) for rid,query in QUERIES.items() if rid not in byid})
    def make(pair):
        rid,selection=pair;recipe=byid[rid]
        if selection.get('how'):
            path=selection['how']; image=HOW_RAW+quote(path)
            entry=dict(image=image,source=HOW_REPO+'/blob/master/'+quote(path),credit='HowToCook contributors',license='Unlicense',licenseUrl='https://unlicense.org/')
        else:
            entry=json.loads((CACHE/(selection.get('from',rid)+'.json')).read_text(encoding='utf-8'))[selection['index']]
        dest=OUT/(rid+'.webp')
        if not dest.exists() or selection.get('refresh'):
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(fetch(entry['image'])))).convert('RGB')
            if selection.get('crop'): im=im.crop(tuple(selection['crop']))
            im.thumbnail((1000,900));im.save(dest,'WEBP',quality=83,method=6)
        exact=selection.get('exact',True)
        return rid,dict(src='assets/photos/'+dest.name,alt=selection.get('alt',recipe['name']+'的实拍照片'),credit=entry['credit'],source=entry['source'],license=entry['license'],exact=exact,licenseUrl=entry.get('licenseUrl') or entry['source'],imageSource=entry['image'],crop=selection.get('crop'),changes='缩放并压缩为 WebP'+('；裁切画面' if selection.get('crop') else ''))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futuremap={pool.submit(make,p):p[0] for p in selected.items()}
        for f in concurrent.futures.as_completed(futuremap):
            try:rid,entry=f.result();result[rid]=entry;print('SAVED',rid,flush=True)
            except Exception as e:print('BUILD FAILED',futuremap[f],str(e),flush=True)
    extra=ROOT/'data'/'photos-extra.json'
    if extra.exists():
        for rid,entry in json.loads(extra.read_text(encoding='utf-8')).items():
            if rid not in result and (ROOT/entry['src']).exists():result[rid]=entry
    (ROOT/'data'/'photos.json').write_text(json.dumps(dict(sorted(result.items())),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# 真实菜品照片来源与许可','', '所有图片来自公开原始菜谱或 Wikimedia Commons 文件页，未使用 AI 生图。图片仅作烹饪外观参考，不是本项目配方实测成品。','', '已对源图进行方向校正、等比例缩小和 WebP 压缩；单独注明时另有裁切。CC BY-SA 图片的改编仍按同一许可提供，项目其他文件的许可不影响这些图片。','', '| 菜谱 | 实际图像 / 匹配 | 作者 | 许可 | 来源 |','| --- | --- | --- | --- | --- |']
    for rid,e in sorted(result.items()):
        lines.append('| '+byid[rid]['name']+' | '+e['alt']+('（同类菜参考）' if not e['exact'] else '')+' | '+e['credit'].replace('|','/')+' | ['+e['license']+']('+e.get('licenseUrl',e['source'])+') | [原始文件页]('+e['source']+') |')
    (ROOT/'data'/'photo-credits.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('TOTAL',len(result),'EXACT',sum(e['exact'] for e in result.values()),flush=True)
def restore():
    """Restore missing final assets from the shipped manifest, no research cache needed.

    URLs, licenses, and crop coordinates come from the reviewed final manifest.
    Existing assets are never overwritten. Network requests are sequential and
    rate-limited; a server Retry-After response is respected by fetch().
    """
    manifest=json.loads((ROOT/'data'/'photos.json').read_text(encoding='utf-8'))
    restored=set()
    for rid,entry in manifest.items():
        dest=ROOT/entry['src']
        if dest.exists() or str(dest) in restored:continue
        if dest.parent.resolve()!=OUT.resolve():raise ValueError('Asset path outside photos directory')
        im=ImageOps.exif_transpose(Image.open(io.BytesIO(fetch(entry['imageSource'])))).convert('RGB')
        if entry.get('crop'):im=im.crop(tuple(entry['crop']))
        im.thumbnail((1000,900));dest.parent.mkdir(parents=True,exist_ok=True)
        im.save(dest,'WEBP',quality=83,method=6);restored.add(str(dest))
        print('RESTORED',entry['src'],flush=True);time.sleep(3)
    print('RESTORED FILES',len(restored),flush=True)
def finalize():
    """Deduplicate reviewed assets and refresh the human-readable credits."""
    CACHE.mkdir(parents=True,exist_ok=True)
    path=ROOT/'data'/'photos.json';manifest=json.loads(path.read_text(encoding='utf-8'))
    canonical={}
    for rid,entry in sorted(manifest.items()):
        dest=ROOT/entry['src'];digest=hashlib.sha256(dest.read_bytes()).hexdigest()
        if digest in canonical:entry['src']=canonical[digest]
        else:canonical[digest]=entry['src']
    path.write_text(json.dumps(dict(sorted(manifest.items())),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    byid={r['id']:r for r in recipes()};missing=[r['name'] for r in byid.values() if r['id'] not in manifest]
    lines=['# 真实菜品照片来源与许可','',
        '所有采用的图片均为真实摄影，来源为 HowToCook 原始菜谱、Wikimedia Commons、Flickr 或逐图保留许可的 Unitools 镜像。未使用 AI 生图。图片仅作烹饪外观参考，不是本项目配方实测成品。','',
        f'当前覆盖 {len(manifest)} 道菜：{sum(e["exact"] for e in manifest.values())} 道菜名匹配、{sum(not e["exact"] for e in manifest.values())} 道明确标注同类/主材/做法参考。独立照片 {len(canonical)} 张。',
        '尚未配图的菜谱：'+('、'.join(missing) if missing else '无')+'。','',
        '同类参考的差异在网页可见图注中逐条说明，包括配料、荤素、地区、部位和制作方法；精确匹配也不意味着照片来自本页配方。','',
        '图片已等比例缩放、方向校正、压缩为 WebP，个别图片裁切至主要菜品。CC BY-SA 图片的改编保留相同许可；各图片许可不受项目代码许可影响。','',
        '恢复资源：安装 Pillow 后运行 `python scripts/fetch-photos.py restore`。脚本仅下载 manifest 中已审定的缺失资源，保留已有文件，串行请求并遵守服务器 Retry-After。','',
        '| 菜谱 | 实际图像 / 匹配 | 作者 | 许可 | 来源 |','| --- | --- | --- | --- | --- |']
    for rid,e in sorted(manifest.items()):
        lines.append('| '+byid[rid]['name']+' | '+e['alt']+('（参考）' if not e['exact'] else '')+' | '+e['credit'].replace('|','/')+' | ['+e['license']+']('+e['licenseUrl']+') | [原始来源记录]('+e['source']+') |')
    (ROOT/'data'/'photo-credits.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    used={entry['src'] for entry in manifest.values()}
    unused=[str(p.resolve()) for p in OUT.glob('*.webp') if p.relative_to(ROOT).as_posix() not in used]
    (CACHE/'unused-assets.json').write_text(json.dumps(unused),encoding='utf-8')
    print('PHOTOS',len(manifest),'EXACT',sum(e['exact'] for e in manifest.values()),'REFERENCE',sum(not e['exact'] for e in manifest.values()),'UNIQUE',len(canonical),'UNUSED',len(unused),flush=True)
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('command',nargs='?',default='restore',choices=['restore','research','preview','curated','build','finalize']);args=parser.parse_args()
    globals()[args.command]()
