const yearNode = document.getElementById("year");
if (yearNode) yearNode.textContent = String(new Date().getFullYear());

const counterNodes = Array.from(document.querySelectorAll(".counter[data-target]"));

const animateCounter = (node) => {
  const target = Number(node.getAttribute("data-target") || "0");
  if (Number.isNaN(target) || target <= 0) return;

  const start = performance.now();
  const duration = 900;

  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    node.textContent = String(Math.floor(target * progress));
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    node.textContent = String(target);
  };

  requestAnimationFrame(tick);
};

if ("IntersectionObserver" in window) {
  const counterObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.6 }
  );

  for (const node of counterNodes) {
    counterObserver.observe(node);
  }
}

const videos = Array.from(document.querySelectorAll("video"));
for (const video of videos) {
  video.addEventListener("play", () => {
    for (const other of videos) {
      if (other === video) continue;
      if (!other.paused) other.pause();
    }
  });
}

// Risk coverage: click Demo button → expand inline player from clicked pill position
const coveredPills = Array.from(document.querySelectorAll(".risk-pill.covered"));
const riskIndex = document.querySelector(".risk-index");
const demoStage = document.getElementById("demo-stage");
const demoStagePanel = document.getElementById("demo-stage-panel");
const demoStageVideo = document.getElementById("demo-stage-video");
const demoStageNum = document.getElementById("ds-num");
const demoStageTitle = document.getElementById("ds-title");
const demoStageDesc = document.getElementById("ds-desc");
const demoStageClose = document.getElementById("ds-close");

const closeDemoStage = () => {
  if (demoStageVideo && !demoStageVideo.paused) {
    demoStageVideo.pause();
  }
  if (demoStage) {
    demoStage.classList.remove("open");
    demoStage.setAttribute("aria-hidden", "true");
  }
};

const openDemoStage = (pill) => {
  const { src, num, title, desc } = pill.dataset;
  if (!src || !demoStage || !demoStageVideo || !demoStagePanel) return;

  for (const p of coveredPills) p.classList.remove("active");
  pill.classList.add("active");

  if (demoStageNum) demoStageNum.textContent = num || "";
  if (demoStageTitle) demoStageTitle.textContent = title || "";
  if (demoStageDesc) demoStageDesc.textContent = desc || "";

  demoStageVideo.pause();
  demoStageVideo.src = src;
  demoStageVideo.load();

  const wasOpen = demoStage.classList.contains("open");
  demoStage.classList.add("open");
  demoStage.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    const panelRect = demoStagePanel.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const pillCenterX = pillRect.left + pillRect.width / 2;
    const pillCenterY = pillRect.top + pillRect.height / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const panelAnchorY = panelRect.top + 42;
    const originPercentRaw = panelRect.width > 0 ? ((pillCenterX - panelRect.left) / panelRect.width) * 100 : 50;
    const originPercent = Math.min(92, Math.max(8, originPercentRaw));
    demoStagePanel.style.setProperty("--demo-origin-x", `${originPercent}%`);

    if (typeof demoStagePanel.animate === "function") {
      const fromX = pillCenterX - panelCenterX;
      const fromY = pillCenterY - panelAnchorY;
      const fromScaleX = panelRect.width > 0 ? Math.min(0.8, Math.max(0.28, pillRect.width / panelRect.width)) : 0.62;
      const fromScaleY = panelRect.height > 0 ? Math.min(0.72, Math.max(0.24, pillRect.height / panelRect.height)) : 0.52;

      demoStagePanel.animate(
        [
          { transform: `translate(${fromX}px, ${fromY}px) scale(${fromScaleX}, ${fromScaleY})`, opacity: 0.26 },
          { transform: "translate(0, 0) scale(1, 1)", opacity: 1 },
        ],
        {
          duration: wasOpen ? 320 : 440,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
        }
      );
    }
  });

  const playPromise = demoStageVideo.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
};

for (const pill of coveredPills) {
  pill.style.cursor = "pointer";
  pill.setAttribute("tabindex", "0");
}

if (riskIndex) {
  riskIndex.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const pill = target.closest(".risk-pill.covered");
    if (!pill || !riskIndex.contains(pill)) return;

    event.preventDefault();
    openDemoStage(pill);
  });

  riskIndex.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const pill = target.closest(".risk-pill.covered");
    if (!pill || !riskIndex.contains(pill)) return;

    event.preventDefault();
    openDemoStage(pill);
  });
}

if (demoStageClose) {
  demoStageClose.addEventListener("click", closeDemoStage);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDemoStage();
});
