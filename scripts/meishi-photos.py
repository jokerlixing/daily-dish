"""Acquire authorized dish photos through the user's web-image-downloader skill.

Only visits public links actually exposed on fetched pages. No search endpoint,
credentials, browser profile, proxies or access-control workarounds are used.
Raw files and per-image skill manifests are retained in the download directory.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urljoin, urlparse

from PIL import Image, ImageOps
import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'artifacts/meishi-cache'
WORK = ROOT / 'artifacts/meishi'
RAW = Path.home() / 'Downloads/网页图片/meishichina-20260914-015254'
SKILL = Path.home() / '.codex/skills/web-image-downloader/scripts/download_images.py'
spec = importlib.util.spec_from_file_location('web_image_downloader', SKILL)
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)
downloader.USER_AGENT = 'DailyDishAuthorizedImageDownloader/1.0'
local = threading.local()
halt = threading.Event()
url_locks = {}
locks_guard = threading.Lock()
for folder in (CACHE, WORK, RAW):
    folder.mkdir(parents=True, exist_ok=True)


def read(path, default=None):
    return json.loads(Path(path).read_text(encoding='utf-8-sig')) if Path(path).exists() else default


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.{threading.get_ident()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def session():
    if not hasattr(local, 'session'):
        local.session = requests.Session()
        local.session.headers['User-Agent'] = downloader.USER_AGENT
    return local.session


def image_entry(url, referer, args):
    key = hashlib.sha256(url.encode()).hexdigest()
    with locks_guard:
        lock = url_locks.setdefault(key, threading.Lock())
    with lock:
        cache = WORK / 'image-cache' / (key + '.json')
        denied = WORK / 'denied-images' / (key + '.json')
        if denied.exists():
            return read(denied)
        entry = read(cache)
        if entry and entry.get('path') and Path(entry['path']).is_file():
            return {**entry, 'status': 'skipped', 'reason': 'Reused validated local original'}
        one = {'images': []}
        downloader.save_candidates([{'url': url, 'source': 'recipe finished-dish image'}], requests.utils.requote_uri(referer), session(), args, one)
        entry = one['images'][0]
        if any(code in entry.get('error', '') for code in ('401 Client Error', '403 Client Error', '429 Client Error')):
            write(denied, entry)
        if entry.get('path'):
            write(cache, entry)
        return entry


def get(url):
    """Cache successful HTML; stop the batch on access denial or rate limiting."""
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:24] + '.html')
    if target.exists():
        return target.read_bytes()
    if halt.is_set():
        raise RuntimeError('Batch stopped after HTTP access/rate-limit response')
    time.sleep(.35)
    try:
        body, final, _ = downloader.bounded_get(session(), url, url)
    except requests.HTTPError as error:
        if error.response.status_code in (401, 403, 429):
            halt.set()
        raise
    target.write_bytes(body)
    write(target.with_suffix('.json'), {'url': url, 'finalUrl': final})
    return body


def soup(url):
    return downloader.BeautifulSoup(get(url), 'html.parser')


def canonical(name):
    name = re.split(r'[（(·]', name)[0]
    name = re.sub(r'[【】\[\]]|#.*?#', '', name)
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', name).replace('的做法', '')


def recipes():
    return sum((read(ROOT / ('data/' + name + '.json')) for name in
                ['cuisines-north-west', 'cuisines-east-south', 'snacks', 'expanded', 'catalog-expanded']), [])


def cards(page, origin):
    found = {}
    for link in page.select('a[href]'):
        url = urljoin(origin, link['href'])
        if not re.fullmatch(r'https://home\.meishichina\.com/recipe-\d+\.html', url):
            continue
        img = link.find('img')
        if not img:
            continue
        # Topic-page image alt text can be an SEO keyword shared by unrelated
        # recipes. Prefer the visible recipe heading and link title.
        parent = link.find_parent('li') or link.parent
        heading = parent.select_one('h2 a, h3 a')
        title = (heading.get_text(' ', strip=True) if heading else '') or link.get('title') or link.get_text(' ', strip=True) or img.get('alt')
        title = re.sub(r'的做法$', '', title)
        parent = link.find_parent('li') or link.parent
        author = parent.select_one('a.u')
        found[url] = {'title': title, 'url': url, 'topic': origin,
                      'credit': author.get_text(strip=True) if author else '',
                      'thumbnail': urljoin(origin, img.get('data-src') or img.get('src') or '')}
    return list(found.values())


def detail(url):
    page = soup(url)
    heading = page.select_one('h1.title > a') or page.select_one('h1.title')
    author = page.select_one('.detail h5 a[href*="/space-"]') or page.select_one('.recipe_De_author a')
    if not author:
        for block in page.select('.mbox .mt16'):
            if '来自 美食天下' in block.get_text(' ', strip=True):
                author = block.select_one('a[href]')
                break
    images = []
    for candidate in downloader.extract_html(str(page), url):
        path = urlparse(candidate['url']).path
        if '/atta/recipe/' in path or '/attachment/recipe/' in path:
            if candidate['url'] not in images:
                images.append(candidate['url'])
    if not images:
        box = page.select_one('.recipe_De_imgBox')
        if box:
            images = [c['url'] for c in downloader.extract_html(str(box), url) if 'blank.' not in c['url']]
    ingredients = []
    for row in page.select('fieldset .recipeCategory_sub_R li'):
        name, amount = row.select_one('.category_s1'), row.select_one('.category_s2')
        if name and amount:
            ingredients.append({'name': name.get_text(strip=True), 'amount': amount.get_text(strip=True)})
    steps = []
    for step in page.select('.recipeStep_word'):
        counter = step.select_one('.grey')
        if counter:
            counter.extract()
        steps.append(step.get_text(' ', strip=True))
    result = {'title': heading.get_text(' ', strip=True) if heading else '', 'url': url,
              'credit': author.get_text(' ', strip=True) if author else '', 'images': images,
              'ingredients': ingredients, 'steps': steps}
    if not result['title'] or not result['credit'] or not images:
        raise ValueError('Recipe missing dish title, author or exposed finished-dish image: ' + url)
    return result


def collect_topics(limit):
    topics = read(ROOT / 'artifacts/meishi-topics.json', [])
    if isinstance(topics, dict):
        topics = topics.get('topics', [])
    if not topics:
        page = downloader.BeautifulSoup((ROOT / 'artifacts/meishi-classic.html').read_bytes(), 'html.parser')
        topics = [{'name': a.get_text(strip=True), 'url': urljoin('https://www.meishichina.com', a['href'])}
                  for a in page.select('a[href]') if re.fullmatch('/mofang/[^/]+/', a['href'])]
    existing = read(WORK / 'cards.json', [])
    index = {item['url']: item for item in existing}
    completed = set(read(WORK / 'topics-done.json', []))
    # Relevant dish topics first; later topics supply exact-name cards too.
    pending_ids = {r['id'] for r in recipes() if not (WORK / 'downloaded' / (r['id'] + '.json')).exists()}
    names = {canonical(r['name']) for r in recipes() if r['id'] in pending_ids}
    for key, aliases in read(ROOT / 'data/meishi-name-aliases.json', {}).items():
        if key in pending_ids:
            names.update(canonical(alias) for alias in aliases)
    requested_urls = set()
    for file in list(WORK.glob('reference-*.json')) + list(WORK.glob('corrected-*.json')):
        for ref in read(file, []):
            if ref['id'] not in pending_ids:
                continue
            names.add(canonical(ref['sourceName']))
            if ref.get('topicUrl'):
                requested_urls.add(ref['topicUrl'])
            if ref.get('topicUrl') and not any(t['url'] == ref['topicUrl'] for t in topics):
                topics.append({'name': ref['sourceName'], 'url': ref['topicUrl']})
    topics.sort(key=lambda item: canonical(item.get('name', item.get('title', ''))) not in names)
    jobs = [t for t in topics if t['url'] not in completed and
            (canonical(t.get('name', t.get('title',''))) in names or t['url'] in requested_urls)][:limit]
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = {pool.submit(soup, t['url']): t for t in jobs}
        for future in as_completed(pending):
            topic = pending[future]
            try:
                page = future.result()
                for card in cards(page, topic['url']):
                    index.setdefault(card['url'], card)
                completed.add(topic['url'])
                write(WORK / 'cards.json', list(index.values()))
                write(WORK / 'topics-done.json', sorted(completed))
                print(f"TOPIC {len(completed)} {topic.get('name','')} cards={len(index)}", flush=True)
            except Exception as error:
                print('TOPIC ERROR', topic['url'], str(error), flush=True)
                if halt.is_set():
                    for job in pending:
                        job.cancel()
                    break


def match():
    index = {}
    source_cards = read(WORK / 'cards.json', [])
    for item in read(ROOT / 'artifacts/meishi-cuisine-candidates.json', []):
        source_cards.append({'title': item['name'], 'url': item['detailUrl'], 'credit': item['author'], 'topic': item['sourcePage'], 'thumbnail': item['imageUrl']})
    for card in source_cards:
        index.setdefault(canonical(card['title']), []).append(card)
    aliases = read(ROOT / 'data/meishi-name-aliases.json', {})
    result, missing = {}, []
    for recipe in recipes():
        names = [recipe['name']] + aliases.get(recipe['id'], [])
        options = []
        for name in names:
            options += index.get(canonical(name), [])
        if options:
            result[recipe['id']] = {'name': recipe['name'], 'candidates': list({c['url']: c for c in options}.values())}
        else:
            missing.append({'id': recipe['id'], 'name': recipe['name'], 'cuisine': recipe['cuisine'], 'category': recipe['category']})
    direct = len(result)
    for file in list(WORK.glob('reference-*.json')) + list(WORK.glob('corrected-*.json')):
        for ref in read(file, []):
            correction = file.name.startswith('corrected-')
            if ref['id'] in result and not correction:
                continue
            options = index.get(canonical(ref['sourceName']), [])
            if not options and ref.get('topicUrl'):
                options = [c for c in source_cards if c.get('topic') == ref['topicUrl'] and canonical(ref['sourceName']) in canonical(c['title'])]
                options.sort(key=lambda c: len(canonical(c['title'])))
            if ref.get('sourceUrl'):
                options = [{'url': ref['sourceUrl'], 'title': ref['sourceName']}] + options
            if options:
                result[ref['id']] = {'name': ref['name'], 'candidates': list({c['url']: c for c in options}.values()),
                                     'exact': ref.get('exactAlias', False), 'sourceName': ref['sourceName'],
                                     'referenceNote': ref.get('referenceNote', ''), 'correction': correction,
                                     **{key: ref[key] for key in ['sourceUrl','sourceImageUrl','sourceCredit','sourceTitle','license','licenseUrl','imageEvidence'] if ref.get(key)}}
    # A site's own dish topic can offer named variations when a plain-title
    # recipe is absent. Keep these explicitly marked as references.
    topic_names = {t['url']: canonical(t['name']) for t in read(ROOT / 'artifacts/meishi-topics.json', [])}
    for recipe in recipes():
        if recipe['id'] in result:
            continue
        terms = {canonical(v) for v in [recipe['name']] + aliases.get(recipe['id'], [])}
        options = [c for c in source_cards if topic_names.get(c.get('topic')) in terms and
                   any(len(term) >= 2 and term in canonical(c['title']) for term in terms)]
        options.sort(key=lambda c: len(canonical(c['title'])))
        if options:
            result[recipe['id']] = {'name': recipe['name'], 'candidates': options[:5], 'exact': False,
                'sourceName': options[0]['title'],
                'referenceNote': '照片来自同菜品专题中的具体做法；配料、调味和摆盘可能不同，请以本页食材与步骤为准。'}
    missing = [r for r in missing if r['id'] not in result]
    write(WORK / 'matches.json', result)
    write(WORK / 'unmatched.json', missing)
    print(json.dumps({'matched': len(result), 'direct': direct, 'referenceCandidates': len(result) - direct, 'unmatched': len(missing)}))


def needs_update(recipe_id, item):
    current = read(WORK / 'downloaded' / (recipe_id + '.json'))
    if not current:
        return True
    return bool(item.get('correction') and (
        current.get('source') != item.get('sourceUrl') or
        (item.get('sourceImageUrl') and current.get('imageSource') != item['sourceImageUrl'])))


def download_one(recipe_id, item, force=False):
    target = WORK / 'downloaded' / (recipe_id + '.json')
    if not force and not needs_update(recipe_id, item):
        return read(target)
    errors = []
    for candidate in item['candidates'][:3]:
        try:
            supplied = item.get('sourceImageUrl') and candidate['url'] == item.get('sourceUrl')
            if supplied:
                info = {'title': item.get('sourceTitle') or item['sourceName'], 'url': candidate['url'],
                        'credit': item.get('sourceCredit') or '原网页作者', 'images': [item['sourceImageUrl']],
                        'ingredients': [], 'steps': [], 'imageEvidence': item.get('imageEvidence', '公开来源页面或图片搜索中提供的成品图片')}
            else:
                info = detail(candidate['url'])
            # Matching is strict; any synonym must be documented in the alias file.
            allowed = {canonical(item.get('sourceName') or item['name'])} | {canonical(v) for v in read(ROOT / 'data/meishi-name-aliases.json', {}).get(recipe_id, [])}
            title_parts = re.split(r'——|---+|：|———|～', info['title']) + re.findall(r'【([^】]+)】', info['title'])
            title_parts.append(re.sub(r'【(?:川菜|湘菜|鲁菜|粤菜|苏菜|浙菜|闽菜|徽菜)】|^“[^”]+”', '', info['title']).strip())
            title_parts += [re.sub(r'^(传统闽菜|酸甜可口的|香滑的)', '', part) for part in title_parts]
            if supplied:
                title_parts.append(item['sourceName'])
            if item.get('exact', True) and not any(canonical(part) in allowed for part in [info['title']] + title_parts):
                raise ValueError('Detail title differs from reviewed name match: ' + info['title'])
            manifest = {'recipeId': recipe_id, 'recipeName': item['name'], 'source': info['url'], 'images': [], 'errors': []}
            args = SimpleNamespace(output=RAW, limit=1, list_only=False, min_width=360 if supplied else 600, min_height=280 if supplied else 450)
            for url in info['images'][:3]:
                if halt.is_set():
                    raise RuntimeError('Batch stopped')
                manifest['images'].append(image_entry(url, info['url'], args))
                entry = manifest['images'][-1]
                if entry.get('path') and entry['status'] in ('saved', 'skipped'):
                    break
                if '429' in entry.get('error', ''):
                    halt.set()
                    break
            write(RAW / ('manifest-' + recipe_id + '.json'), manifest)
            saved = next((i for i in manifest['images'] if i.get('path')), None)
            if not saved:
                raise ValueError('No valid large finished-dish photo: ' + str(manifest['images']))
            source_id = re.search(r'recipe-(\d+)', info['url'])
            stem = 'meishi-' + source_id[1] if source_id else 'web-' + hashlib.sha256(saved['url'].encode()).hexdigest()[:16]
            src = 'assets/photos/' + stem + '.webp'
            with Image.open(saved['path']) as picture:
                picture = ImageOps.exif_transpose(picture).convert('RGB')
                picture.thumbnail((1000, 900), Image.Resampling.LANCZOS)
                picture.save(ROOT / src, 'WEBP', quality=83, method=6)
                dimensions = picture.size
            exact = item.get('exact', True)
            result = {'id': recipe_id, 'name': item['name'], 'src': src, 'alt': info['title'] + ('成品实拍' if exact else '实拍，作为' + item['name'] + '的同类参考'),
                      'credit': info['credit'], 'source': info['url'], 'sourceTitle': info['title'],
                      'license': '经用户授权转载；原作者保留权利', 'authorizationRef': 'docs/photo-authorization.md',
                      'exact': exact, 'imageSource': saved['url'], 'crop': None,
                      'changes': '等比例缩放并压缩为 WebP；保留原图内容及水印',
                      'width': dimensions[0], 'height': dimensions[1], 'sha256': saved['sha256']}
            if not exact:
                result['referenceNote'] = item.get('referenceNote') or '照片为' + info['title'] + '，用于同类菜品的成品参考；实际食材和做法以本页菜谱为准。'
                if item.get('sourceName') and item['sourceName'] != info['title']:
                    result['referenceNote'] = result['referenceNote'].replace(item['sourceName'], info['title'])
            official = urlparse(info['url']).hostname.endswith('meishichina.com')
            if not official:
                result.pop('authorizationRef', None)
                result['license'] = item.get('license') if item.get('licenseUrl') else '原作者保留权利；来源页未声明开放许可'
                if item.get('licenseUrl'):
                    result['licenseUrl'] = item['licenseUrl']
                else:
                    result['rightsBasis'] = 'source-attribution'
            if supplied:
                result['imageEvidence'] = info['imageEvidence']
            write(target, result)
            write(WORK / 'details' / (recipe_id + '.json'), info)
            return result
        except Exception as error:
            errors.append(str(error))
            if halt.is_set():
                break
    raise ValueError('; '.join(errors))


def download(limit, workers=6):
    for manifest_file in RAW.glob('manifest-*.json'):
        for entry in read(manifest_file, {}).get('images', []):
            if entry.get('path'):
                write(WORK / 'image-cache' / (hashlib.sha256(entry['url'].encode()).hexdigest() + '.json'), entry)
    matches = read(WORK / 'matches.json', {})
    jobs = [(key, value) for key, value in matches.items() if needs_update(key, value)][:limit]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pending = {pool.submit(download_one, key, value): (key, value) for key, value in jobs}
        for future in as_completed(pending):
            key, item = pending[future]
            try:
                record = future.result()
                print('SAVED', key, item['name'], record['width'], record['height'], flush=True)
            except Exception as error:
                write(WORK / 'errors' / (key + '.json'), {'id': key, 'name': item['name'], 'error': str(error)})
                print('ERROR', item['name'], str(error)[:240], flush=True)
                if halt.is_set():
                    for job in pending:
                        job.cancel()
                    break


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['topics', 'match', 'download'])
    parser.add_argument('--limit', type=int, default=1000)
    parser.add_argument('--workers', type=int, default=6, choices=range(1, 7))
    args = parser.parse_args()
    if args.command == 'topics': collect_topics(args.limit)
    if args.command == 'match': match()
    if args.command == 'download': download(args.limit, args.workers)
