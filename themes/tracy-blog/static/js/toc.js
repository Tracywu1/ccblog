// themes/tracy-blog/static/js/toc.js
(function () {
  function build(node) {
    // node: UL -> 转成可折叠的 details/summary 结构
    const frag = document.createDocumentFragment();

    Array.from(node.children).forEach((li) => {
      const a = li.querySelector(":scope > a");
      const childUl = li.querySelector(":scope > ul");
      if (!a) return;

      // 有子级：用 details 折叠
      if (childUl) {
        const details = document.createElement("details");
        details.open = true; // 默认展开；想默认折叠改成 false

        const summary = document.createElement("summary");

        const arrow = document.createElement("span");
        arrow.className = "toc-arrow";
        arrow.textContent = "▸";

        const link = a.cloneNode(true);

        // 点击链接只跳转，不触发折叠（避免 summary 的 toggle）
        link.addEventListener("click", (e) => {
          e.stopPropagation();
        });

        summary.appendChild(arrow);
        summary.appendChild(link);

        const children = document.createElement("div");
        children.className = "toc-children";
        children.appendChild(build(childUl));

        details.appendChild(summary);
        details.appendChild(children);

        frag.appendChild(details);
      } else {
        // 无子级：叶子节点
        const item = document.createElement("div");
        item.className = "toc-leaf";
        item.appendChild(a.cloneNode(true));
        frag.appendChild(item);
      }
    });

    return frag;
  }

  function transformToc() {
    // 你的 single.html 中是：
    // <nav id="toc" ...>{{ .TableOfContents }}</nav>
    // Hugo 输出会包含：<nav id="TableOfContents">...</nav>
    const tocWrap = document.getElementById("toc");
    if (!tocWrap) return;

    const tocNav = tocWrap.querySelector("#TableOfContents");
    if (!tocNav) return;

    const rootUl = tocNav.querySelector(":scope > ul");
    if (!rootUl) return;

    // 用自定义结构替换 Hugo 默认 TOC
    tocNav.innerHTML = "";
    tocNav.appendChild(build(rootUl));
    // 隐藏/显示整个目录列表（只隐藏列表区，不隐藏标题栏）
    const toggleBtn = document.getElementById("toc-toggle");
    const scroll = document.getElementById("toc-scroll");
    const KEY = "toc_hidden";

    function applyHidden(hidden) {
      if (!scroll || !toggleBtn) return;
     
      const openIcon = document.getElementById('toc-eye-open');
      const closedIcon = document.getElementById('toc-eye-closed');

      if (hidden) {
        scroll.classList.add("hidden");
	openIcon && openIcon.classList.add('hidden');
        closedIcon && closedIcon.classList.remove('hidden');
      } else {
        scroll.classList.remove("hidden");
	openIcon && openIcon.classList.remove('hidden');
        closedIcon && closedIcon.classList.add('hidden');
      }
    }

    if (toggleBtn && scroll) {
      const saved = localStorage.getItem(KEY);
      applyHidden(saved === "1");

      toggleBtn.addEventListener("click", () => {
        const hidden = !scroll.classList.contains("hidden");
        localStorage.setItem(KEY, hidden ? "1" : "0");
        applyHidden(hidden);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", transformToc);
  } else {
    transformToc();
  }
})();
