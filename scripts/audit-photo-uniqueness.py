"""Audit actual image content; perceptual candidates require recorded visual review."""
import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
COS = [[math.cos((2*x+1)*u*math.pi/64) for x in range(32)] for u in range(8)]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def fingerprint(path):
    with Image.open(path) as original:
        original.load()
        picture = ImageOps.exif_transpose(original).convert('RGB')
        pixels = hashlib.sha256(picture.resize((256,256)).tobytes()).hexdigest()
        values = list(picture.resize((32,32)).convert('L').getdata())
        rows = [[sum(values[y*32+x]*COS[u][x] for x in range(32)) for u in range(8)] for y in range(32)]
        coefficients = [sum(rows[y][u]*COS[v][y] for y in range(32)) for v in range(8) for u in range(8)]
        median = sorted(coefficients[1:])[31]
        phash = sum((value > median) << i for i,value in enumerate(coefficients))
        reduced = list(picture.resize((9,8)).convert('L').getdata())
        dhash = sum((reduced[y*9+x] > reduced[y*9+x+1]) << (y*8+x) for y in range(8) for x in range(8))
        return {'pixelSha256':pixels,'phash':phash,'dhash':dhash,'width':picture.width,'height':picture.height}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--photos',default='data/photos.json')
    parser.add_argument('--output',default='artifacts/1000/photo-uniqueness.json')
    args=parser.parse_args()
    photos=json.loads((ROOT/args.photos).read_text(encoding='utf-8-sig'))
    cache={}
    rows=[]
    for recipe_id,photo in photos.items():
        path=(ROOT/photo['src']).resolve()
        if path not in cache: cache[path]={'sha256':digest(path),**fingerprint(path)}
        rows.append({'id':recipe_id,'src':photo['src'],**cache[path]})
    duplicates={}
    for field in ['src','sha256','pixelSha256']:
        groups=defaultdict(list)
        for row in rows: groups[row[field]].append(row['id'])
        duplicates[field]=[ids for ids in groups.values() if len(ids)>1]
    candidates=[]
    for i,left in enumerate(rows):
        for right in rows[i+1:]:
            if left['sha256']==right['sha256']: continue
            p=(left['phash']^right['phash']).bit_count()
            d=(left['dhash']^right['dhash']).bit_count()
            if p<=8 or d<=6:
                candidates.append({'ids':[left['id'],right['id']],'sha256':[left['sha256'],right['sha256']],'phashDistance':p,'dhashDistance':d})
    candidates.sort(key=lambda row:(row['phashDistance']+row['dhashDistance']))
    report={'total':len(rows),'uniqueFiles':len(cache),'exactDuplicates':duplicates,'similarityCandidates':candidates,
            'method':'SHA256, normalized RGB pixels, 64-bit DCT perceptual hash and difference hash. Similarity is a screening signal, not a duplicate verdict.',
            'images':rows}
    output=ROOT/args.output;output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'total':len(rows),'uniqueFiles':len(cache),'exactDuplicateGroups':{key:len(value) for key,value in duplicates.items()},'similarityCandidates':len(candidates)}))

if __name__=='__main__':main()
