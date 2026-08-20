/* ------------------------------------------------------------------
   Expression of interest endpoint.

   Paste the /exec URL of the Google Apps Script web app here
   (see scripts/form-endpoint.gs and README.md for the two-minute setup).
   While this is empty the form is hidden and an email fallback is shown
   instead, so the page never collects submissions that go nowhere.
   ------------------------------------------------------------------ */
var FORM_ENDPOINT = "";

/* ------------------------------------------------------------------
   Google Form for expressions of interest.

   Paste the form's /viewform URL here. Both the "here" link under the
   heading and the button beneath it will point at it, and the button
   relabels itself. While this is empty they both fall back to email,
   so neither is ever a dead control.
   ------------------------------------------------------------------ */
var INTEREST_FORM_URL = "";

document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("siteNav");

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  var progress = document.getElementById("scrollProgress");
  function updateProgress() {
    var scrollTop = window.scrollY;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progress.style.width = pct + "%";
  }
  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- Expression of interest form ---------- */

  var form = document.getElementById("eoiForm");
  var fallback = document.getElementById("formFallback");
  var status = document.getElementById("formStatus");
  var submit = document.getElementById("eoiSubmit");
  if (!form) return;

  /* Point the inline link and the button at the Google Form when there is one. */
  var formLink = document.getElementById("interestFormLink");
  if (INTEREST_FORM_URL) {
    var cta = fallback.querySelector("a");
    [formLink, cta].forEach(function (el) {
      if (!el) return;
      el.href = INTEREST_FORM_URL;
      el.target = "_blank";
      el.rel = "noopener";
    });
    if (cta) cta.textContent = "Open the form";
  }

  if (!FORM_ENDPOINT) {
    form.hidden = true;
    fallback.hidden = false;
    return;
  }

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = "form-status is-visible is-" + kind;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (form.website.value) return; // honeypot: silently drop bots

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var data = new URLSearchParams();
    new FormData(form).forEach(function (value, key) {
      if (key !== "website") data.append(key, value);
    });
    data.append("submittedAt", new Date().toISOString());

    submit.disabled = true;
    submit.textContent = "Submitting…";

    /* Apps Script web apps do not send CORS headers, so this is a no-cors
       write: the POST lands, but the response cannot be read. Check the
       destination sheet if you need to confirm a submission arrived. */
    fetch(FORM_ENDPOINT, { method: "POST", mode: "no-cors", body: data })
      .then(function () {
        form.reset();
        setStatus(
          "Thanks. You are on the list. We will be in touch with registration details as they are confirmed.",
          "success"
        );
        submit.textContent = "Submitted";
      })
      .catch(function () {
        setStatus(
          "Something went wrong sending that. Please email jd@sportmontana.org and we will add you to the list.",
          "error"
        );
        submit.disabled = false;
        submit.textContent = "Submit expression of interest";
      });
  });
});
