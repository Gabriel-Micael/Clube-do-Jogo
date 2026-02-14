(function initDemoPage() {
  const video = document.getElementById("demoVideo");
  if (video) {
    const tryPlay = () => {
      const promise = video.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          // Autoplay can be blocked by some browsers even when muted.
        });
      }
    };

    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    tryPlay();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        tryPlay();
      }
    });
  }

  const carousel = document.getElementById("shotsCarousel");
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll(".carousel-slide"));
  const dotsWrap = document.getElementById("carouselDots");
  const prevButton = document.getElementById("carouselPrev");
  const nextButton = document.getElementById("carouselNext");
  if (!slides.length || !dotsWrap) return;

  const intervalMs = Math.max(2000, Number(carousel.dataset.interval || 5000));
  let currentIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
  if (currentIndex < 0) currentIndex = 0;

  const dots = slides.map((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("aria-label", `Ir para screenshot ${index + 1}`);
    dot.addEventListener("click", () => {
      goTo(index);
      restartTimer();
    });
    dotsWrap.appendChild(dot);
    return dot;
  });

  function syncUi() {
    slides.forEach((slide, index) => {
      slide.classList.toggle("is-active", index === currentIndex);
    });
    dots.forEach((dot, index) => {
      dot.classList.toggle("is-active", index === currentIndex);
    });
  }

  function goTo(index) {
    currentIndex = (index + slides.length) % slides.length;
    syncUi();
  }

  function next() {
    goTo(currentIndex + 1);
  }

  function prev() {
    goTo(currentIndex - 1);
  }

  let timerId = null;
  function restartTimer() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(next, intervalMs);
  }

  syncUi();
  restartTimer();

  if (prevButton) {
    prevButton.addEventListener("click", () => {
      prev();
      restartTimer();
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      next();
      restartTimer();
    });
  }

  carousel.addEventListener("mouseenter", () => {
    if (timerId) clearInterval(timerId);
  });

  carousel.addEventListener("mouseleave", () => {
    restartTimer();
  });
})();
