#!/usr/bin/env python3
"""Build compact JSON for the static site in docs/ from data/hackertube-data/.

Usage: python3 scripts/build.py

Standard library only. Unzips hackertube-data.zip into data/ if needed.
Writes (and wipes first):
  docs/data/videos.json     all videos, array-of-arrays with a "fields" header
  docs/data/taxonomy.json   areas -> categories with video counts
  docs/data/v/<vid>.json    per video: top 5 HN mentions + related vids
  docs/data/paths.json      learning paths, from scripts/paths.json (curated by hand)
"""
import json
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "hackertube-data"
ZIP = ROOT / "hackertube-data.zip"
OUT = ROOT / "docs" / "data"

N_MENTIONS = 5
N_RELATED = 12
QUOTE_FALLBACK_CHARS = 280
VIDEOS_FIELDS = [
    "vid", "title", "channel", "score", "shelf", "type", "level", "cats",
    "summary", "why", "recs", "y0", "y1", "quote",
]
STANCE_RANK = {"strong_rec": 0, "rec": 1, "reference": 2, "critical": 3, "joke": 4}


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    return path.stat().st_size


def ensure_source():
    if (SRC / "videos.jsonl").exists():
        return
    print(f"unzipping {ZIP.name} -> data/")
    with zipfile.ZipFile(ZIP) as z:
        z.extractall(ROOT / "data")


def trim(text, n):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def mention_key(m):
    # strong recs first, then ones with a quote and a why, then most recent
    return (
        STANCE_RANK.get(m["stance"], 9),
        0 if m.get("quote") else 1,
        0 if m.get("why") else 1,
        "" if not m.get("month") else "".join(chr(255 - ord(c)) for c in m["month"]),
    )


def main():
    ensure_source()
    videos = list(read_jsonl(SRC / "videos.jsonl"))
    vids = {v["vid"] for v in videos}
    taxonomy = json.load(open(SRC / "taxonomy.json", encoding="utf-8"))

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    # videos.json -----------------------------------------------------------
    rows = []
    for v in videos:
        hn = v.get("hn") or {}
        q = v.get("quote") or {}
        rows.append([
            v["vid"], v["title"], v.get("channel") or "", v["score"],
            v.get("shelf_life") or "", v.get("content_type") or "",
            v.get("level") or "", [c["id"] for c in v.get("categories") or []],
            v.get("summary") or "", v.get("why_hn") or "",
            hn.get("recommenders", 0), hn.get("first_year"), hn.get("last_year"),
            q.get("text") or "",
        ])
    size = dump(OUT / "videos.json", {"fields": VIDEOS_FIELDS, "rows": rows})
    print(f"videos.json: {len(rows)} videos, {size / 1e6:.2f} MB")

    # taxonomy.json ---------------------------------------------------------
    counts = Counter(c for r in rows for c in r[7])
    tax = {"areas": [
        {"id": a["id"], "name": a["name"], "categories": [
            {"id": c["id"], "name": c["name"], "description": c.get("description", ""),
             "count": counts.get(c["id"], 0)}
            for c in a["categories"]
        ]}
        for a in taxonomy["areas"]
    ]}
    n_cats = sum(len(a["categories"]) for a in tax["areas"])
    dump(OUT / "taxonomy.json", tax)
    print(f"taxonomy.json: {len(tax['areas'])} areas, {n_cats} categories")

    # per-video files -------------------------------------------------------
    by_vid = defaultdict(list)
    for m in read_jsonl(SRC / "mentions.jsonl"):
        if m["vid"] in vids:
            by_vid[m["vid"]].append(m)
    related = {}
    for r in read_jsonl(SRC / "related.jsonl"):
        related[r["vid"]] = [x["vid"] for x in r["related"] if x["vid"] in vids][:N_RELATED]

    total = 0
    for v in videos:
        ms = by_vid.get(v["vid"], [])
        recs = [m for m in ms if m["stance"] in ("strong_rec", "rec")]
        # videos never recommended still get their best citations, flagged by stance
        pool = recs if recs else [m for m in ms if m["stance"] == "reference"]
        pool.sort(key=mention_key)
        out = [{
            "id": m["hn_comment_id"],
            "author": m.get("author") or "",
            "month": m.get("month") or "",
            "story": m.get("story_title") or "",
            "stance": m["stance"],
            "why": m.get("why") or "",
            "quote": m.get("quote") or trim(m.get("text") or "", QUOTE_FALLBACK_CHARS),
        } for m in pool[:N_MENTIONS]]
        total += dump(OUT / "v" / f"{v['vid']}.json",
                      {"mentions": out, "related": related.get(v["vid"], [])})
    print(f"v/*.json: {len(videos)} files, {total / 1e6:.2f} MB total")

    # paths.json ------------------------------------------------------------
    paths = json.load(open(ROOT / "scripts" / "paths.json", encoding="utf-8"))
    for p in paths:
        seen = set()
        if not 5 <= len(p["steps"]) <= 10:
            raise SystemExit(f"path {p['id']}: needs 5-10 steps, has {len(p['steps'])}")
        for s in p["steps"]:
            if s["vid"] not in vids:
                raise SystemExit(f"path {p['id']}: unknown video {s['vid']}")
            if s["vid"] in seen:
                raise SystemExit(f"path {p['id']}: duplicate video {s['vid']}")
            seen.add(s["vid"])
    dump(OUT / "paths.json", paths)
    print(f"paths.json: {len(paths)} paths, {sum(len(p['steps']) for p in paths)} steps")

    (ROOT / "docs" / ".nojekyll").touch()


if __name__ == "__main__":
    main()
