#!/usr/bin/env python3
"""Collect public classic-food topic links; do not fetch topics or images.

Uses the installed web-image-downloader bounded_get with verified TLS.
Only follows next-page links actually present in the classic-topic index.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse


ROOT = Path(__file__).resolve().parents[1]
SKILL = Path("C:/Users/lixing/.codex/skills/web-image-downloader/scripts/download_images.py")
START = "https://www.meishichina.com/mofang/class/jingdianmeishi/"
USER_AGENT = "DailyDishAuthorizedImageDownloader/1.0"
CACHE = ROOT / "artifacts/meishi-cache"
OUTPUT = ROOT / "artifacts/meishi-topics.json"
REPORT = ROOT / "artifacts/meishi-topics-run.json"
INDEX_PATH = re.compile(r"/mofang/class/jingdianmeishi/(?:page/[1-9][0-9]*/)?$")
TOPIC_PATH = re.compile(r"/mofang/[^/]+/$")


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def allowed_index(url):
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.netloc == "www.meishichina.com" and bool(INDEX_PATH.fullmatch(parsed.path)) and not parsed.query


def parse_index(html, base, soup_class):
    soup = soup_class(html, "html.parser")
    topics = []
    for anchor in soup.select("ul.plist > li > a[href]"):
        url = urljoin(base, anchor["href"])
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "www.meishichina.com" or not TOPIC_PATH.fullmatch(parsed.path):
            continue
        label = anchor.find("div")
        name = label.get_text(" ", strip=True) if label else re.sub(r"的做法大全$", "", anchor.get("title", "")).strip()
        if name:
            topics.append({"name": name, "url": url, "sourcePage": base})
    next_url = None
    for anchor in soup.select(".ui-page-inner a[href]"):
        if anchor.get_text(" ", strip=True) == "下一页":
            next_url = urljoin(base, anchor["href"])
            if not allowed_index(next_url):
                raise ValueError("Next link leaves the authorized classic index: " + next_url)
            break
    if not topics:
        raise ValueError("Expected classic topic cards are missing; stop without treating this as the final page")
    return topics, next_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-pages", type=int, default=40)
    args = parser.parse_args()
    if not 1 <= args.max_pages <= 120:
        parser.error("--max-pages must be between 1 and 120")
    specification = importlib.util.spec_from_file_location("daily_dish_image_downloader", SKILL)
    downloader = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(downloader)
    downloader.USER_AGENT = USER_AGENT
    CACHE.mkdir(parents=True, exist_ok=True)
    topics, seen_pages, pages = {}, set(), []
    url, referer, last_finished = START, "https://www.meishichina.com/", None
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "startUrl": START, "maxPages": args.max_pages, "workers": 1, "minimumDelaySeconds": 0.5, "tlsVerification": True, "userAgent": USER_AGENT, "pages": pages, "status": "running"}
    try:
        with downloader.requests.Session() as session:
            session.headers["User-Agent"] = USER_AGENT
            session.verify = True
            while url and len(pages) < args.max_pages:
                if url in seen_pages:
                    raise ValueError("Repeated next-page URL: " + url)
                if not allowed_index(url):
                    raise ValueError("Unexpected index URL: " + url)
                seen_pages.add(url)
                digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
                html_file, meta_file = CACHE / ("classic-" + digest + ".html"), CACHE / ("classic-" + digest + ".json")
                cache_hit = html_file.exists() and meta_file.exists()
                seeded = False
                if cache_hit:
                    metadata = json.loads(meta_file.read_text(encoding="utf-8"))
                    if metadata.get("requestedUrl") != url:
                        raise ValueError("Cache URL mismatch")
                    final = metadata["finalUrl"]
                    body = html_file.read_bytes()
                elif url == START and (ROOT / "artifacts/meishi-classic.html").exists():
                    # Root already saved this exact index; validate its cards/next URL before reuse.
                    body = (ROOT / "artifacts/meishi-classic.html").read_bytes()
                    final, content_type, seeded = url, "text/html; cached by parent", True
                    parse_index(body.decode("utf-8"), final, downloader.BeautifulSoup)
                else:
                    if last_finished is not None:
                        time.sleep(max(0, 0.5 - (time.monotonic() - last_finished)))
                    try:
                        body, final, content_type = downloader.bounded_get(session, url, referer)
                    finally:
                        last_finished = time.monotonic()
                    if "text/html" not in content_type.lower():
                        raise ValueError("Unexpected response content type: " + content_type)
                if not allowed_index(final):
                    raise ValueError("Index redirected outside its authorized scope: " + final)
                found, next_url = parse_index(body.decode("utf-8"), final, downloader.BeautifulSoup)
                if not cache_hit:
                    html_file.write_bytes(body)
                    save_json(meta_file, {"requestedUrl": url, "finalUrl": final, "contentType": content_type, "savedAt": datetime.now(timezone.utc).isoformat(), "seededFromExistingHtml": seeded})
                for item in found:
                    topics.setdefault(item["url"], item)
                pages.append({"url": final, "topics": len(found), "cacheHit": cache_hit, "seededFromExistingHtml": seeded, "nextUrl": next_url})
                report["topicCount"] = len(topics)
                save_json(OUTPUT, list(topics.values()))
                save_json(REPORT, report)
                print(json.dumps({"page": len(pages), "found": len(found), "uniqueTopics": len(topics), "cacheHit": cache_hit, "next": next_url}, ensure_ascii=False), flush=True)
                referer, url = final, next_url
            report["status"] = "complete" if url is None else "page_limit"
            report["nextUrl"] = url
    except downloader.requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        report.update(status="blocked" if status in (403, 429) else "http_error", httpStatus=status, stoppedUrl=url, error=str(error))
    except Exception as error:
        report.update(status="error", stoppedUrl=url, error=str(error))
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["topicCount"] = len(topics)
        save_json(OUTPUT, list(topics.values()))
        save_json(REPORT, report)
    print(json.dumps({"status": report["status"], "pages": len(pages), "topics": len(topics), "output": str(OUTPUT), "error": report.get("error")}, ensure_ascii=False), flush=True)
    return 0 if report["status"] in ("complete", "page_limit") else 1


if __name__ == "__main__":
    raise SystemExit(main())
