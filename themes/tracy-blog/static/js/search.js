(function () {
  let fuse = null;
  let indexData = [];
  let debounceTimer = null;

  async function init() {
    const input = document.getElementById("search-input");
    const box = document.getElementById("search-results");
    const list = document.getElementById("search-results-list");
    const empty = document.getElementById("search-empty");
    const loading = document.getElementById("search-loading");

    if (!input || !box || !list || !empty || !loading) return;

    // 打开/关闭
    function openBox() { box.classList.remove("hidden"); }
    function closeBox() { box.classList.add("hidden"); }

    // 点击外部关闭
    document.addEventListener("click", (e) => {
      const wrap = document.getElementById("search-wrap");
      if (wrap && !wrap.contains(e.target)) closeBox();
    });

    input.addEventListener("focus", () => openBox());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        render([]);
        closeBox();
      }
    });

    // 拉取索引
    loading.classList.remove("hidden");
    try {
      const res = await fetch("/index.json", { cache: "no-store" });
      indexData = await res.json();

      fuse = new Fuse(indexData, {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.2,
        minMatchCharLength: 2,
        keys: [
          { name: "title", weight: 0.55 },
          { name: "tags", weight: 0.20 },
          { name: "summary", weight: 0.15 },
          { name: "content", weight: 0.10 }
        ]
      });
    } catch (err) {
      // 索引失败时直接禁用输入
      input.placeholder = "搜索不可用（索引加载失败）";
      input.disabled = true;
    } finally {
      loading.classList.add("hidden");
    }

    function highlight(text, q) {
      if (!text || !q) return text || "";
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return text.replace(new RegExp(safe, "ig"), (m) => `<mark class="bg-yellow-200/60 rounded px-1">${m}</mark>`);
    }

    function render(results, q = "") {
      list.innerHTML = "";
      if (!results || results.length === 0) {
        empty.classList.remove("hidden");
        return;
      }
      empty.classList.add("hidden");

      // 只展示前 8 条
      results.slice(0, 8).forEach((r) => {
        const item = r.item || r;
        const title = highlight(item.title, q);
        const summaryRaw = (item.summary || item.content || "").slice(0, 90);
        const summary = highlight(summaryRaw, q);

        const tags = (item.tags || []).slice(0, 5).map(t =>
          `<span class="text-xs bg-slate-700/60 px-2 py-0.5 rounded">${t}</span>`
        ).join("");

        const li = document.createElement("li");
        li.innerHTML = `
          <a class="block p-3 rounded-lg hover:bg-slate-700/50 transition-colors" href="${item.relpermalink}">
            <div class="text-sm font-semibold text-white">${title}</div>
            <div class="text-xs text-slate-300 mt-1 line-clamp-2">${summary}</div>
            <div class="mt-2 flex gap-2 flex-wrap">${tags}</div>
          </a>
        `;
        list.appendChild(li);
      });
    }

    input.addEventListener("input", () => {
      if (!fuse) return;

      const q = input.value.trim();
      openBox();

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (q.length < 2) {
          render([]);
          return;
        }
        const results = fuse.search(q);
        render(results, q);
      }, 120);
    });

    // 初始空态
    render([]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
