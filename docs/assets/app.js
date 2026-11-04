/* HackerTube static front end. No framework; every page calls one of the
 * page functions at the bottom based on <body data-page="...">.
 * Data text is only ever inserted with textContent (see el()). */
(function () {
  "use strict";

  var PAGE_SIZE = 60;
  var params = new URLSearchParams(location.search);

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (children || []).forEach(function (c) {
      if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function $(sel) { return document.querySelector(sel); }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": HTTP " + r.status);
      return r.json();
    });
  }

  var dataPromise = null;
  function loadVideos() {
    if (!dataPromise) {
      dataPromise = Promise.all([getJSON("data/videos.json"), getJSON("data/taxonomy.json")])
        .then(function (res) {
          var f = res[0].fields;
          var videos = res[0].rows.map(function (r) {
            var o = {};
            for (var i = 0; i < f.length; i++) o[f[i]] = r[i];
            o.hay = (o.title + " " + o.channel + " " + o.summary).toLowerCase();
            return o;
          });
          var byVid = {};
          videos.forEach(function (v) { byVid[v.vid] = v; });
          var cats = {}, areaOfCat = {};
          res[1].areas.forEach(function (a) {
            a.categories.forEach(function (c) { cats[c.id] = c; areaOfCat[c.id] = a; });
          });
          return { videos: videos, byVid: byVid, taxonomy: res[1], cats: cats, areaOfCat: areaOfCat };
        });
    }
    return dataPromise;
  }

  function thumbURL(vid, name) { return "https://i.ytimg.com/vi/" + vid + "/" + name + ".jpg"; }
  function fallbackThumb(img) {
    if (img.dataset.fb) return;
    img.dataset.fb = "1";
    img.src = thumbURL(img.dataset.vid, "hqdefault");
  }
  function thumb(vid, score) {
    var img = el("img", { src: thumbURL(vid, "hq2"), alt: "", loading: "lazy", decoding: "async", "data-vid": vid });
    img.addEventListener("error", function () { fallbackThumb(img); });
    // YouTube serves a 120x90 grey placeholder when hq2 is missing
    img.addEventListener("load", function () { if (img.naturalWidth <= 120) fallbackThumb(img); });
    return el("span", { class: "thumb" }, [img, score != null ? el("span", { class: "badge", title: "HackerTube score", text: "★ " + score }) : null]);
  }
  function plural(n, one, many) { return n.toLocaleString() + " " + (n === 1 ? one : many); }
  // extra: optional meta strings shown after the channel instead of recommenders + years
  function card(v, extra) {
    var meta = [el("span", { text: v.channel })];
    if (extra) extra.forEach(function (t) { meta.push(el("span", { class: "dot", text: t })); });
    else {
      if (v.recs) meta.push(el("span", { class: "dot", text: plural(v.recs, "HN recommender", "HN recommenders") }));
      if (v.y0) meta.push(el("span", { class: "dot", text: v.y0 === v.y1 ? String(v.y0) : v.y0 + "–" + v.y1 }));
    }
    return el("a", { class: "card", href: "watch.html?v=" + encodeURIComponent(v.vid), title: v.title }, [
      thumb(v.vid, v.score),
      el("h3", { text: v.title }),
      el("div", { class: "meta" }, meta),
    ]);
  }

  // Renders a filtered list into a grid in pages of PAGE_SIZE as the user scrolls.
  function pagedGrid(container) {
    var grid = el("div", { class: "grid" });
    var sentinel = el("div", { class: "sentinel" });
    container.appendChild(grid);
    container.appendChild(sentinel);
    var list = [], shown = 0;
    function more() {
      var frag = document.createDocumentFragment();
      list.slice(shown, shown + PAGE_SIZE).forEach(function (v) { frag.appendChild(card(v)); });
      shown = Math.min(list.length, shown + PAGE_SIZE);
      grid.appendChild(frag);
    }
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
      if (es[0].isIntersecting && shown < list.length) more();
    }, { rootMargin: "1200px" }) : null;
    if (io) io.observe(sentinel);
    return function set(newList) {
      list = newList; shown = 0;
      grid.textContent = "";
      if (!list.length) grid.appendChild(el("p", { class: "empty", text: "No videos match." }));
      more();
      if (!io) while (shown < list.length) more();
    };
  }

  function newsToggle(onChange) {
    var box = el("input", { type: "checkbox" });
    box.checked = params.get("news") === "1";
    box.addEventListener("change", function () { onChange(box.checked); });
    return { node: el("label", { class: "toggle" }, [box, "Show news"]), get: function () { return box.checked; } };
  }

  function wireSearch(onInput) {
    var input = $("#q");
    if (!input) return;
    if (params.get("q")) input.value = params.get("q");
    if (onInput) {
      var t;
      input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(onInput, 120); });
      input.form.addEventListener("submit", function (e) { e.preventDefault(); onInput(); });
    }
  }
  function query() { var i = $("#q"); return i ? i.value.trim().toLowerCase() : ""; }
  function matches(v, q) {
    if (!q) return true;
    return q.split(/\s+/).every(function (w) { return v.hay.indexOf(w) !== -1; });
  }

  function fail(err) {
    console.warn(err);
    var m = $("main");
    m.textContent = "";
    m.appendChild(el("p", { class: "empty", text: "Couldn't load data. " + err.message }));
  }

  // ---------- home ----------
  function home(d) {
    var main = $("main");
    var area = params.get("area") || "";
    var chips = el("div", { class: "chips", role: "tablist" });
    var count = el("span", { class: "count" });
    var news = newsToggle(update);
    var set;

    function addChip(id, name) {
      var b = el("button", { class: "chip" + (id === area ? " active" : ""), type: "button", text: name });
      b.addEventListener("click", function () {
        area = id;
        Array.prototype.forEach.call(chips.children, function (c) { c.classList.remove("active"); });
        b.classList.add("active");
        update();
      });
      chips.appendChild(b);
    }
    addChip("", "All");
    d.taxonomy.areas.forEach(function (a) { addChip(a.id, a.name); });

    function update() {
      var q = query(), showNews = news.get();
      var list = d.videos.filter(function (v) {
        if (!showNews && v.shelf === "news") return false;
        if (area && !v.cats.some(function (c) { return d.areaOfCat[c] && d.areaOfCat[c].id === area; })) return false;
        return matches(v, q);
      });
      count.textContent = list.length.toLocaleString() + " videos";
      set(list);
    }

    main.textContent = "";
    main.appendChild(chips);
    main.appendChild(el("div", { class: "toolbar" }, [news.node, count]));
    set = pagedGrid(main);
    wireSearch(update);
    update();
  }

  // ---------- categories ----------
  function categoryIndex(d) {
    var main = $("main");
    main.textContent = "";
    document.title = "Categories · HackerTube";
    main.appendChild(el("div", { class: "page-head" }, [
      el("h1", { text: "Categories" }),
      el("p", { text: d.taxonomy.areas.length + " areas, " + Object.keys(d.cats).length + " categories. A video can be in up to three." }),
    ]));
    var wrap = el("div", { class: "areas" });
    d.taxonomy.areas.forEach(function (a) {
      wrap.appendChild(el("section", { class: "area" }, [
        el("h2", { text: a.name }),
        el("ul", null, a.categories.map(function (c) {
          return el("li", null, [el("a", { href: "category.html?c=" + encodeURIComponent(c.id), title: c.description }, [
            c.name, el("span", { text: String(c.count) }),
          ])]);
        })),
      ]));
    });
    main.appendChild(wrap);
  }

  function categoryPage(d, id) {
    var c = d.cats[id];
    if (!c) return categoryIndex(d);
    var a = d.areaOfCat[id];
    var main = $("main");
    document.title = c.name + " · HackerTube";
    var count = el("span", { class: "count" });
    var news = newsToggle(update);
    var set;
    function update() {
      var q = query(), showNews = news.get();
      var list = d.videos.filter(function (v) {
        return v.cats.indexOf(id) !== -1 && (showNews || v.shelf !== "news") && matches(v, q);
      });
      count.textContent = list.length.toLocaleString() + " videos";
      set(list);
    }
    main.textContent = "";
    main.appendChild(el("div", { class: "page-head" }, [
      el("div", { class: "crumb" }, [el("a", { href: "category.html", text: "Categories" }), " / " + a.name]),
      el("h1", { text: c.name }),
      el("p", { text: c.description }),
    ]));
    var siblings = el("div", { class: "chips" }, a.categories.map(function (s) {
      return el("a", { class: "chip" + (s.id === id ? " active" : ""), href: "category.html?c=" + encodeURIComponent(s.id), text: s.name });
    }));
    main.appendChild(siblings);
    main.appendChild(el("div", { class: "toolbar" }, [news.node, count]));
    set = pagedGrid(main);
    wireSearch(update);
    update();
    var active = siblings.querySelector(".active");
    if (active) siblings.scrollLeft = active.offsetLeft - 16;
  }

  // ---------- watch ----------
  var STANCE_LABEL = { strong_rec: "strong rec", rec: "rec", reference: "cited" };

  function watch(d, vid) {
    var v = d.byVid[vid];
    var main = $("main");
    main.textContent = "";
    if (!v) {
      main.appendChild(el("p", { class: "empty" }, ["Video not found. ", el("a", { href: "./", text: "Back home" })]));
      return;
    }
    document.title = v.title + " · HackerTube";
    var yt = "https://www.youtube.com/watch?v=" + encodeURIComponent(vid);

    var primary = el("div", { class: "primary" }, [
      el("div", { class: "player" }, [el("iframe", {
        src: "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(vid) + "?rel=0",
        title: v.title, loading: "lazy", allowfullscreen: true,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        referrerpolicy: "strict-origin-when-cross-origin",
      })]),
      el("h1", { text: v.title }),
      el("div", { class: "watch-meta" }, [
        el("span", { text: v.channel }),
        el("span", { class: "dot", text: "★ " + v.score }),
        v.recs ? el("span", { class: "dot", text: v.recs + " HN recommenders" }) : null,
        el("a", { class: "yt-link", href: yt, target: "_blank", rel: "noopener", text: "Watch on YouTube" }),
      ]),
      el("div", { class: "panel" }, [
        el("p", { text: v.summary }),
        el("div", { class: "chips" }, v.cats.filter(function (c) { return d.cats[c]; }).map(function (c) {
          return el("a", { class: "chip", href: "category.html?c=" + encodeURIComponent(c), text: d.cats[c].name });
        })),
      ]),
      v.why ? el("div", { class: "panel" }, [el("h2", { text: "Why HN likes it" }), el("p", { text: v.why })]) : null,
    ]);
    var quotes = el("section", { class: "quotes" });
    primary.appendChild(quotes);
    var side = el("aside", { class: "side" });
    main.appendChild(el("div", { class: "watch" }, [primary, side]));

    getJSON("data/v/" + encodeURIComponent(vid) + ".json").then(function (x) {
      if (x.mentions.length) {
        var allRecs = x.mentions.every(function (m) { return m.stance === "rec" || m.stance === "strong_rec"; });
        quotes.appendChild(el("h2", { text: allRecs ? "What HN says" : "Where HN cited it" }));
        x.mentions.forEach(function (m) {
          quotes.appendChild(el("a", {
            class: "quote", href: "https://news.ycombinator.com/item?id=" + m.id, target: "_blank", rel: "noopener",
          }, [
            el("blockquote", { text: "“" + m.quote + "”" }),
            m.why ? el("p", { class: "why", text: m.why }) : null,
            el("div", { class: "meta" }, [
              el("span", { class: "stance " + m.stance, text: STANCE_LABEL[m.stance] || m.stance }), " ",
              el("b", { text: m.author }),
              el("span", { class: "dot", text: m.month }),
              m.story ? el("span", { class: "dot", text: "on “" + m.story + "”" }) : null,
            ]),
          ]));
        });
      }
      var rel = x.related.map(function (r) { return d.byVid[r]; }).filter(Boolean);
      var label = "Recommended by the same HN people";
      if (rel.length < 4) {
        // pad with top videos from the main category
        var seen = {}; seen[vid] = 1;
        rel.forEach(function (r) { seen[r.vid] = 1; });
        var cat = v.cats[0];
        var extra = d.videos.filter(function (o) {
          return !seen[o.vid] && o.shelf !== "news" && o.cats.indexOf(cat) !== -1;
        }).slice(0, 12 - rel.length);
        if (!rel.length) label = "More in " + (d.cats[cat] ? d.cats[cat].name : "this category");
        rel = rel.concat(extra);
      }
      side.appendChild(el("h2", { text: label }));
      side.appendChild(el("div", { class: "side-list" }, rel.map(card)));
    }).catch(function (e) { console.warn(e); });
  }

  // ---------- learning paths ----------
  var LEVEL_LABEL = { intro: "Intro", general: "General", intermediate: "Intermediate", advanced: "Advanced" };

  function pathsPage(d, id) {
    var main = $("main");
    main.textContent = "";
    getJSON("data/paths.json").then(function (paths) {
      var p = paths.filter(function (x) { return x.id === id; })[0];
      if (!p) return pathsIndex(main, d, paths);
      document.title = p.title + " · Learning paths · HackerTube";
      main.appendChild(el("div", { class: "page-head" }, [
        el("div", { class: "crumb" }, [el("a", { href: "paths.html", text: "Paths" })]),
        el("h1", { text: p.title }),
        el("p", { text: p.blurb + " " + p.steps.length + " videos, ordered from first steps to harder material." }),
      ]));
      var list = el("ol", { class: "steps" });
      p.steps.forEach(function (s, i) {
        var v = d.byVid[s.vid];
        if (!v) return;
        list.appendChild(el("li", { class: "step" }, [
          el("span", { class: "step-n", text: String(i + 1) }),
          el("a", { class: "card", href: "watch.html?v=" + encodeURIComponent(v.vid), title: v.title }, [thumb(v.vid, null)]),
          el("div", { class: "step-body" }, [
            el("p", { class: "step-line", text: s.line }),
            el("a", { class: "step-title", href: "watch.html?v=" + encodeURIComponent(v.vid), text: v.title }),
            el("div", { class: "meta" }, [
              el("span", { text: v.channel }),
              LEVEL_LABEL[v.level] ? el("span", { class: "dot", text: LEVEL_LABEL[v.level] }) : null,
            ]),
          ]),
        ]));
      });
      main.appendChild(list);
    }).catch(fail);
  }

  function pathsIndex(main, d, paths) {
    document.title = "Learning paths · HackerTube";
    main.textContent = "";
    main.appendChild(el("div", { class: "page-head" }, [
      el("h1", { text: "Learning paths" }),
      el("p", { text: paths.length + " short reading lists from the videos HN recommends, each ordered from intro to advanced." }),
    ]));
    var grid = el("div", { class: "grid" });
    paths.forEach(function (p) {
      var first = d.byVid[p.steps[0].vid];
      grid.appendChild(el("a", { class: "card", href: "paths.html?p=" + encodeURIComponent(p.id) }, [
        first ? thumb(first.vid, null) : null,
        el("h3", { text: p.title }),
        el("div", { class: "meta" }, [el("span", { text: p.steps.length + " videos" })]),
        el("p", { class: "path-blurb", text: p.blurb }),
      ]));
    });
    main.appendChild(grid);
  }

  // ---------- timeline ----------
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var TL_TOP = 12, TL_DEBUTS = 8;

  function timeline(d) {
    var main = $("main");
    main.textContent = "";
    document.title = "Timeline · HackerTube";
    getJSON("data/timeline.json").then(function (tl) {
      var years = tl.years;
      var lastYear = years[years.length - 1].y;
      var throughMonth = +tl.through.slice(5, 7);
      var partial = throughMonth < 12 ? "Jan–" + MONTHS[throughMonth - 1] : "";
      var news = newsToggle(render);
      var body = el("div", { class: "years" });

      main.appendChild(el("div", { class: "page-head" }, [
        el("h1", { text: "Timeline" }),
        el("p", { text: "What Hacker News recommended each year, " + years[0].y + "–" + lastYear +
          ". Bars count comments recommending a video" + (partial ? "; " + lastYear + " runs " + partial + "." : ".") }),
      ]));
      main.appendChild(yearChart(years, lastYear, partial));
      main.appendChild(el("div", { class: "toolbar" }, [news.node]));
      main.appendChild(body);

      function render() {
        var showNews = news.get();
        function keep(v) { return v && (showNews || v.shelf !== "news"); }
        body.textContent = "";
        years.slice().reverse().forEach(function (yr) {
          var top = yr.top.map(function (t) { return [d.byVid[t[0]], t[1]]; })
            .filter(function (t) { return keep(t[0]); }).slice(0, TL_TOP);
          var debuts = yr.debuts.map(function (vid) { return d.byVid[vid]; }).filter(keep).slice(0, TL_DEBUTS);
          var standout = yr.standout.filter(function (c) { return d.cats[c]; });
          body.appendChild(el("section", { class: "year", id: "y" + yr.y }, [
            el("div", { class: "year-head" }, [
              el("h2", null, [String(yr.y), yr.y === lastYear && partial ? el("span", { class: "partial", text: partial }) : null]),
              el("p", { class: "meta", text: plural(yr.recs, "recommendation", "recommendations") + " from " +
                plural(yr.people, "person", "people") + " · " + plural(yr.videos, "video", "videos") + " · " +
                yr.new.toLocaleString() + " recommended for the first time" }),
            ]),
            standout.length ? el("div", { class: "chips standout" }, [el("span", { class: "label", text: "Stood out" })].concat(
              standout.map(function (c) {
                return el("a", { class: "chip", href: "category.html?c=" + encodeURIComponent(c), text: d.cats[c].name });
              }))) : null,
            top.length ? el("h3", { text: "Most recommended" }) : null,
            top.length ? el("div", { class: "shelf" }, top.map(function (t) {
              return card(t[0], [plural(t[1], "recommender", "recommenders") + " in " + yr.y]);
            })) : null,
            debuts.length ? el("h3", { text: "First recommended in " + yr.y }) : null,
            debuts.length ? el("div", { class: "shelf" }, debuts.map(function (v) { return card(v); })) : null,
          ]));
        });
      }
      render();
      var target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }).catch(fail);
  }

  // Column chart of recommendation comments per year. Each column links to its year.
  function yearChart(years, lastYear, partial) {
    var max = Math.max.apply(null, years.map(function (y) { return y.recs; }));
    var peak = years.filter(function (y) { return y.recs === max; })[0].y;
    var readout = el("p", { class: "tl-readout", "aria-live": "polite" });
    function describe(yr) {
      return yr.y + (yr.y === lastYear && partial ? " (" + partial + ")" : "") + ": " +
        plural(yr.recs, "recommendation", "recommendations") + " from " + plural(yr.people, "person", "people");
    }
    var resting = describe(years.filter(function (y) { return y.y === peak; })[0]) + " (peak)";
    readout.textContent = resting;
    var cols = el("div", { class: "tl-cols" }, years.map(function (yr) {
      var label = yr.y === peak || yr.y === lastYear ? yr.recs.toLocaleString() : null;
      var a = el("a", { class: "tl-col", href: "#y" + yr.y, "aria-label": describe(yr) }, [
        el("span", { class: "tl-plot" }, [
          // 88% leaves headroom for the value label above the tallest bar
          el("span", { class: "tl-bar" + (yr.y === lastYear && partial ? " partial" : ""), style: "height:" + (88 * yr.recs / max).toFixed(1) + "%" },
            [label ? el("span", { class: "tl-val", text: label }) : null]),
        ]),
        el("span", { class: "tl-year", text: yr.y === years[0].y || yr.y === lastYear ||
          (yr.y % 5 === 0 && yr.y - years[0].y > 1 && lastYear - yr.y > 1) ? String(yr.y) : "" }),
      ]);
      function on() { readout.textContent = describe(yr); }
      function off() { readout.textContent = resting; }
      a.addEventListener("mouseenter", on); a.addEventListener("focus", on);
      a.addEventListener("mouseleave", off); a.addEventListener("blur", off);
      return a;
    }));
    return el("figure", { class: "tl-chart" }, [
      el("figcaption", { text: "HN comments recommending a video, per year" }), cols, readout,
    ]);
  }

  // ---------- boot ----------
  var page = document.body.dataset.page;
  if (page !== "home") wireSearch(null); // header search submits to the home page
  loadVideos().then(function (d) {
    if (page === "home") home(d);
    else if (page === "category") params.get("c") ? categoryPage(d, params.get("c")) : categoryIndex(d);
    else if (page === "paths") pathsPage(d, params.get("p"));
    else if (page === "watch") watch(d, params.get("v"));
    else if (page === "timeline") timeline(d);
  }).catch(fail);
})();
