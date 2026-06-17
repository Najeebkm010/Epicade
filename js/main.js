document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const header = document.querySelector(".site-header");
  const menuToggle = document.querySelector(".menu-toggle");
  const mobileMenu = document.querySelector(".mobile-menu");
  const mobileMenuLinks = document.querySelectorAll(".mobile-menu a");

  const setHeaderState = () => {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 80);
  };

  setHeaderState();
  window.addEventListener("scroll", setHeaderState, { passive: true });

  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const isOpen = body.classList.toggle("menu-open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      if (mobileMenu) mobileMenu.setAttribute("aria-hidden", String(!isOpen));
    });
  }

  mobileMenuLinks.forEach((link) => {
    link.addEventListener("click", () => {
      body.classList.remove("menu-open");
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
      if (mobileMenu) mobileMenu.setAttribute("aria-hidden", "true");
    });
  });

  const cursorAllowed = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (cursorAllowed) {
    const cursor = document.createElement("div");
    cursor.id = "cursor";
    body.appendChild(cursor);

    let cursorX = 0;
    let cursorY = 0;
    let cursorTicking = false;

    window.addEventListener("mousemove", (event) => {
      cursorX = event.clientX;
      cursorY = event.clientY;
      if (!cursorTicking) {
        window.requestAnimationFrame(() => {
          cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
          cursorTicking = false;
        });
        cursorTicking = true;
      }
    }, { passive: true });
  }

  document.querySelectorAll(".stagger").forEach((group) => {
    Array.from(group.children).forEach((child, index) => {
      child.style.transitionDelay = `${Math.min(index * 0.08, 0.48)}s`;
    });
  });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

  const iframeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const iframe = entry.target;
      const src = iframe.dataset.src;
      if (src && !iframe.src) {
        iframe.src = src;
      }
      iframeObserver.unobserve(iframe);
    });
  }, { rootMargin: "200px" });

  document.querySelectorAll("iframe[data-src]").forEach((iframe) => iframeObserver.observe(iframe));

  const counters = document.querySelectorAll(".stat-number[data-target]");
  if (counters.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.target.dataset.counted === "true") return;
        entry.target.dataset.counted = "true";
        const number = entry.target;
        const target = Number(number.dataset.target);
        const suffix = number.dataset.suffix || "";
        const duration = 2000;
        const start = performance.now();

        const tick = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          number.textContent = `${Math.round(target * eased)}${suffix}`;
          if (progress < 1) requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
        counterObserver.unobserve(number);
      });
    }, { threshold: 0.45 });

    counters.forEach((counter) => counterObserver.observe(counter));
  }

  document.querySelectorAll(".parallax-card").forEach((card) => {
    const image = card.querySelector("img");
    if (!image) return;

    let parallaxTicking = false;

    card.addEventListener("mousemove", (event) => {
      if (!parallaxTicking) {
        window.requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 16;
          const y = ((event.clientY - rect.top) / rect.height - 0.5) * 16;
          image.style.transform = `scale(1.04) translate(${x}px, ${y}px)`;
          parallaxTicking = false;
        });
        parallaxTicking = true;
      }
    });

    card.addEventListener("mouseleave", () => {
      image.style.transform = "";
    });
  });

  const tabs = document.querySelectorAll(".filter-tab");
  const filterItems = document.querySelectorAll("[data-category]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const filter = tab.dataset.filter;
      tabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      filterItems.forEach((item) => {
        const categories = (item.dataset.category || "").split(" ");
        const isVisible = filter === "all" || categories.includes(filter);
        item.classList.toggle("is-hidden", !isVisible);
      });
    });
  });

  const lightbox = document.querySelector(".lightbox");
  const lightboxImage = document.querySelector(".lightbox-image");
  const lightboxCaption = document.querySelector(".lightbox-caption");
  const lightboxClose = document.querySelector(".lightbox-close");
  const lightboxPrev = document.querySelector(".lightbox-prev");
  const lightboxNext = document.querySelector(".lightbox-next");
  const lightboxTriggers = Array.from(document.querySelectorAll(".lightbox-trigger"));
  let currentLightboxIndex = 0;

  const visibleLightboxItems = () => lightboxTriggers.filter((item) => !item.closest(".portfolio-item")?.classList.contains("is-hidden"));

  const openLightbox = (trigger) => {
    if (!lightbox || !lightboxImage) return;
    const visibleItems = visibleLightboxItems();
    currentLightboxIndex = Math.max(0, visibleItems.indexOf(trigger));
    renderLightbox(visibleItems[currentLightboxIndex]);
    lightbox.classList.add("open");
    body.style.overflow = "hidden";
  };

  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove("open");
    body.style.overflow = "";
  };

  const renderLightbox = (trigger) => {
    if (!trigger || !lightboxImage) return;
    const image = trigger.querySelector("img");
    if (!image) return;
    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    if (lightboxCaption) {
      lightboxCaption.textContent = trigger.dataset.title || image.alt;
    }
  };

  const moveLightbox = (direction) => {
    const visibleItems = visibleLightboxItems();
    if (!visibleItems.length) return;
    currentLightboxIndex = (currentLightboxIndex + direction + visibleItems.length) % visibleItems.length;
    renderLightbox(visibleItems[currentLightboxIndex]);
  };

  lightboxTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openLightbox(trigger));
  });

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener("click", () => moveLightbox(-1));
  if (lightboxNext) lightboxNext.addEventListener("click", () => moveLightbox(1));
  if (lightbox) {
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (!lightbox?.classList.contains("open")) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") moveLightbox(-1);
    if (event.key === "ArrowRight") moveLightbox(1);
  });

  document.querySelectorAll('a[href$=".html"]').forEach((link) => {
    const target = link.getAttribute("target");
    if (target === "_blank") return;
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href === window.location.pathname.split("/").pop()) return;
      event.preventDefault();
      body.classList.add("page-out");
      window.setTimeout(() => {
        window.location.href = href;
      }, 260);
    });
  });
});
