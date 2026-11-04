# my-hackertube

A static, YouTube-style site of the videos Hacker News recommends. Served by GitHub Pages
from `docs/`, with no backend. The front end is plain HTML/CSS/JS with no framework and no build step.

## Layout

```
hackertube-data.zip        source of truth (committed)
data/hackertube-data/      unzipped raw data (gitignored; DATA.md documents it)
  videos.jsonl             6,454 videos, best score first; key `vid`
  mentions.jsonl           39,834 HN comments (~35 MB); `vid` -> videos
  related.jsonl            co-recommended videos; `vid`, `related[].vid`
  taxonomy.json            16 areas / 150 categories; `videos.categories[].id`
  embeddings.npy + embedding_ids.json   384-d vectors (not used by the site yet)
scripts/build.py           raw data -> docs/data/ (stdlib only)
docs/                      the site (GitHub Pages root)
  index.html               home: grid by score, area chips, search, news hidden by default
  category.html            no param: all areas/categories; ?c=<id>: that category
  watch.html?v=<vid>       embed, summary, why HN likes it, HN quotes, related
  paths.html               no param: all learning paths; ?p=<id>: that path
  timeline.html            recs-per-year chart, then each year (newest first); #y<year> jumps
  assets/app.js            all page logic (routes on <body data-page>)
  assets/style.css
  data/                    GENERATED, committed, so Pages can serve it
    videos.json            {"fields":[...], "rows":[[...]]} ~3.7 MB, score order
    taxonomy.json          areas -> categories with `count`
    v/<vid>.json           {"mentions":[top 5 recs], "related":[vid,...]}
    paths.json             learning paths, from scripts/paths.json (hand-curated)
    timeline.json          {"through":"YYYY-MM","years":[{y, recs, people, videos, new,
                           top:[[vid, recommenders that year]], debuts:[vid], standout:[cat id]}]}
  .nojekyll
```

`videos.json` fields: vid, title, channel, score, shelf, type, level, cats (category ids),
summary, why (why_hn), recs (hn.recommenders), y0/y1 (first/last year), quote.
Timeline years come from the month of rec/strong_rec comments. `top` ranks by distinct
recommenders that year, `debuts` are videos first recommended that year (best score first),
`standout` are categories over-represented that year versus all years (at least 8 recs).
Lists carry 24 entries including news so the UI can hide news and still show 12/8.
Per-video `mentions` are rec/strong_rec only, strong first. Videos with no recommendations
fall back to `reference` mentions, and the UI labels those "cited".

## Rebuild and preview

```bash
python3 scripts/build.py          # unzips the zip if data/ is missing, wipes and rewrites docs/data/
python3 -m http.server -d docs 8000
```

Commit `docs/data/` after rebuilding. Pages serves the committed files.

## Conventions

- Never print the big `.jsonl` files. Sample them with `head` or a short Python snippet.
- No frameworks, bundlers or npm. Keep the build stdlib-only Python.
- Keep `videos.json` around 4 MB. Add new per-video detail to `v/<vid>.json` instead.
- Insert data text only via `textContent` (the `el()` helper in app.js), never `innerHTML`.
- Use relative URLs and query-string routing so the site works under a Pages subpath.
- Thumbnails: `https://i.ytimg.com/vi/<vid>/hq2.jpg` (mid-video frame), falling back to
  `hqdefault.jpg` on error or on the 120px placeholder. Embed via `https://www.youtube-nocookie.com/embed/<vid>`.
- Every page keeps the footer attribution required by DATA.md (ODC-By 1.0: HackerTube,
  open-index/hacker-news, Y Combinator / comment authors, creators, no affiliation).
- The headless check: serve `docs/` and load each page in Playwright with console errors collected.
  YouTube hosts may be blocked in sandboxes, so ignore failures from those hosts only.
