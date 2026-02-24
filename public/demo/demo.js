(function initDemoPage() {
  const video = document.getElementById("demoVideo");
  if (video) {
    const tryPlay = () => {
      const promise = video.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          // Alguns navegadores ainda podem bloquear autoplay.
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

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const carousels = Array.from(document.querySelectorAll(".carousel"));
  carousels.forEach((carousel, index) => initCarousel(carousel, index, prefersReducedMotion));

  function initCarousel(carousel, carouselIndex, disableAutoRotate) {
    const slides = Array.from(carousel.querySelectorAll(".carousel-slide"));
    if (!slides.length) return;

    const shell = carousel.closest(".carousel-shell");
    const dotsWrap = shell ? shell.querySelector(".carousel-dots") : null;
    const prevButton = carousel.querySelector(".carousel-nav.prev");
    const nextButton = carousel.querySelector(".carousel-nav.next");
    const label = carousel.dataset.label || `carrossel ${carouselIndex + 1}`;
    const intervalMs = Math.max(2000, Number(carousel.dataset.interval || 5000));

    let currentIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));
    if (currentIndex < 0) currentIndex = 0;

    if (dotsWrap) {
      dotsWrap.innerHTML = "";
    }

    let timerId = null;
    let dots = [];

    function syncUi() {
      slides.forEach((slide, index) => {
        slide.classList.toggle("is-active", index === currentIndex);
      });

      dots.forEach((dot, index) => {
        const active = index === currentIndex;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-current", active ? "true" : "false");
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

    function stopTimer() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function restartTimer() {
      stopTimer();
      if (disableAutoRotate || slides.length <= 1 || document.visibilityState !== "visible") {
        return;
      }
      timerId = setInterval(next, intervalMs);
    }

    if (slides.length <= 1) {
      carousel.classList.add("is-single");
      if (shell) shell.classList.add("is-single");
      slides[0].classList.add("is-active");
      syncUi();
      return;
    }

    if (dotsWrap) {
      dots = slides.map((_, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", `Ir para imagem ${index + 1} do ${label}`);
        dot.addEventListener("click", () => {
          goTo(index);
          restartTimer();
        });
        dotsWrap.appendChild(dot);
        return dot;
      });
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

    carousel.addEventListener("mouseenter", stopTimer);
    carousel.addEventListener("mouseleave", restartTimer);
    carousel.addEventListener("focusin", stopTimer);
    carousel.addEventListener("focusout", restartTimer);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        restartTimer();
      } else {
        stopTimer();
      }
    });
  }
})();
