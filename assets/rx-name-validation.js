/**
 * rx-name-validation.js
 * ===========================================================================
 * Production client-side validation for First Name / Last Name on the
 * RX Verification V2 Shopify Forms block (/pages/rx-apply).
 *
 * Theme-only — does NOT modify Shopify Forms, Shopify Flow, or the backend.
 * Vanilla JS, no libraries. Shopify Online Store 2.0 compatible.
 * Validates ONLY First Name + Last Name; every other field (License Number,
 * NPI, State, email, file upload, …) is left completely untouched.
 *
 * TWO things make this form special, both handled here:
 *   1. It is injected ASYNCHRONOUSLY and can re-render  -> MutationObserver.
 *   2. It renders inside an OPEN Shadow DOM
 *        <shopify-forms-embed>#shadow-root → <form> … </form>
 *      and is REACT-controlled, so we reach into the shadow root and use a
 *      React-safe value setter (plain `.value =` is ignored by React).
 *
 * Behaviour:
 *   • While typing / pasting -> NEVER blocked or silently altered. The customer can
 *     enter anything; keys always work (no "dead keyboard" feeling).
 *   • Invalid input -> surfaced as an inline error MESSAGE, not by swallowing keys.
 *   • On blur       -> validate and show / clear the inline error.
 *   • Before submit -> final validation; if invalid, block submit + inline error.
 * We validate-and-message rather than strip characters, so the field never appears
 * broken. Whitespace-only cleanup (collapse spaces / trim) still runs at submit;
 * characters are never removed for the customer.
 * ===========================================================================
 */
(function () {
  'use strict';

  if (location.pathname.indexOf('/pages/rx-apply') !== 0) return; // RX page only

  /* ------------------------------------------------------------------ *
   * 1. RULES
   * ------------------------------------------------------------------ */
  var MIN = 2, MAX = 50;

  // Allowed characters: ASCII letters + single space / hyphen / apostrophe.
  // (To allow accented letters, use \p{L} + the 'u' flag in the pattern below.)
  // Full-value shape: letters, then only SINGLE internal space/hyphen/apostrophe.
  // Rejects leading/trailing separators and doubled separators automatically.
  var NAME_SHAPE = /^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/;

  var TITLES = { dr: 1, doctor: 1, mr: 1, mrs: 1, ms: 1, miss: 1 };
  var CREDS  = { MD: 1, DO: 1, PHD: 1, DDS: 1, DMD: 1, PAC: 1, NP: 1, RN: 1 };
  // 2-letter credentials that can also be real surnames (Do, Md, Np, Rn):
  // only treat as a credential when typed ALL CAPS, so surnames like "Do" pass.
  var CRED_AMBIGUOUS = { MD: 1, DO: 1, NP: 1, RN: 1 };
  var LABEL = { first: 'first name', last: 'last name' };

  /* ------------------------------------------------------------------ *
   * 2. STRING HELPERS
   * ------------------------------------------------------------------ */
  // Normalise for validation WITHOUT hiding invalid content (so bad characters and
  // doubled/edge separators still fail the shape check).
  function normalize(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function wordsOf(v) { return v.split(/\s+/).filter(Boolean); }
  function lettersOnly(w) { return w.replace(/[^A-Za-z]/g, ''); }

  // React controls the inputs, so a plain assignment is ignored. Use the native
  // value setter and dispatch a real 'input' event so React updates its state.
  function reactSetValue(input, val) {
    try {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(input, val); else input.value = val;
    } catch (e) { input.value = val; }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ------------------------------------------------------------------ *
   * 3. VALIDATION  ->  { valid:true } | { valid:false, message }
   * Order chosen so the most specific message wins.
   * ------------------------------------------------------------------ */
  function validate(rawValue, kind) {
    var v = normalize(rawValue), nice = LABEL[kind] || 'name', i, w;

    // Length (2–50)
    if (v.length < MIN || v.length > MAX) return fail('Please enter a valid ' + nice + '.');

    var ws = wordsOf(v);
    // Titles: Dr, Dr., Doctor, Mr, Mrs, Ms, Miss (whole word, case/period-insensitive).
    for (i = 0; i < ws.length; i++) {
      if (TITLES[lettersOnly(ws[i]).toLowerCase()]) return fail("Titles such as 'Dr.' are not allowed.");
    }
    // Credentials: MD, M.D., DO, D.O., PhD, Ph.D., DDS, DMD, PA-C, NP, RN.
    for (i = 0; i < ws.length; i++) {
      w = ws[i]; var up = lettersOnly(w).toUpperCase();
      if (CREDS[up]) {
        if (CRED_AMBIGUOUS[up] && w !== w.toUpperCase()) continue; // protect surnames like "Do"
        return fail("Credentials such as 'MD' should not be entered.");
      }
    }
    // Character / shape: letters + single internal space/hyphen/apostrophe only.
    if (!NAME_SHAPE.test(v)) return fail('Please enter a valid ' + nice + '.');

    return { valid: true, value: v };
  }
  function fail(message) { return { valid: false, message: message }; }

  /* ------------------------------------------------------------------ *
   * 4. INLINE ERROR UI  (never alert())
   * ------------------------------------------------------------------ */
  function getError(input, create) {
    var el = input.__rxErr;
    if (!el && create) {
      el = document.createElement('div');
      el.className = 'rx-fv-error';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'color:#c0392b;font-size:12.5px;line-height:1.4;margin:6px 0 2px;';
      var anchor = input.closest('div') || input;   // sits below the whole field container
      anchor.insertAdjacentElement('afterend', el);
      input.__rxErr = el;
    }
    return el || null;
  }
  function showError(input, msg) {
    getError(input, true).textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.style.borderColor = '#c0392b';
  }
  function clearError(input) {
    var el = getError(input, false);
    if (el) el.textContent = '';
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '';
  }

  /* ------------------------------------------------------------------ *
   * 5. FIND FIELDS  (in a document OR a shadow root)
   * ------------------------------------------------------------------ */
  function findField(root, kind) {
    var id = kind === 'first' ? 'first_name' : 'last_name';
    return root.querySelector('#' + id + ', [data-testid="field-' + id + '"]') || null;
  }

  /* ------------------------------------------------------------------ *
   * 6. PER-FIELD INPUT BEHAVIOUR (attach once per input)
   * ------------------------------------------------------------------ */
  function attachField(input, kind) {
    if (input.__rxFV) return;
    input.__rxFV = true;
    input.setAttribute('maxlength', String(MAX));

    // WHILE TYPING / PASTING: intentionally NOT blocked or sanitised. The customer can
    // type or paste any character — the keyboard must never feel dead. Invalid content
    // is caught and MESSAGED on blur / submit below, not swallowed. (maxlength above is
    // the only cap, and the browser enforces it natively.)

    // ON BLUR: validate exactly what the customer typed (no rewrite, no character
    // stripping) and show / clear the inline error.
    input.addEventListener('blur', function () {
      var r = validate(input.value, kind);
      if (r.valid) clearError(input); else showError(input, r.message);
    });

    // Clear a shown error as soon as the user edits the field (fresh check on next blur).
    input.addEventListener('input', function () { clearError(input); });
  }

  /* ------------------------------------------------------------------ *
   * 7. SUBMIT GATE  (final validation; block on invalid)
   *    On a VALID submit the form is really being sent, so we show a
   *    "processing" overlay and then POLL THE SERVER IN PLACE — no page reload,
   *    so the overlay never flickers. Each poll is a silent background fetch to
   *    the rx-status endpoint, rendered fresh by the server against the
   *    customer's CURRENT tags. (The Liquid already on this page ran once at
   *    load and can't see a tag Shopify Flow adds afterwards; the fetch can.)
   *    The moment the tag lands we navigate ONCE, straight back to the product
   *    page — the only visible navigation in the whole flow.
   *
   *    Why A owns the poll (not rx-form-gate.liquid): the form lives inside
   *    <shopify-forms-embed>.shadowRoot, which only this script reaches into,
   *    so only this script fires reliably on submit. rx-form-gate's own submit
   *    binding queries the light DOM and never sees it. rx-form-gate still owns
   *    the REFRESH/RESUME case (its init() reads the sessionStorage flag we set
   *    here), which is why we still set that flag.
   * ------------------------------------------------------------------ */
  var POLL_MS = 3000;          // silent background check every 3s
  var TIMEOUT_MS = 60000;      // after 60s, hand off to rx-form-gate's timeout UI
  var STATUS_URL = '/pages/rx-apply?view=rx-status';
  var processingStarted = false;

  // Same-origin path guard (blocks open redirects); mirrors rx-form-gate.liquid.
  function rxSameOriginPath(raw) {
    if (!raw) return null;
    try {
      var d = decodeURIComponent(raw);
      if (d.charAt(0) === '/' && d.charAt(1) !== '/') return d;
    } catch (e) {}
    return null;
  }
  // Where to send the customer once the tag lands: this page's own return_url,
  // else the value rx-form-gate persisted in sessionStorage. The unique marker
  // makes it a URL the browser has never fetched, so the product page arrives
  // freshly rendered (never the copy cached before verification).
  function rxReturnUrl() {
    var path = rxSameOriginPath(new URLSearchParams(location.search).get('return_url'));
    if (!path) { try { path = rxSameOriginPath(sessionStorage.getItem('rxReturn')); } catch (e) {} }
    if (!path) return null;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'rx_refresh=' + Date.now();
  }

  function triggerProcessing() {
    if (processingStarted) return;   // once per submit
    processingStarted = true;
    try { sessionStorage.setItem('rx_verification_processing', 'true'); } catch (e) {}
    showProcessing();
    pollForTag(Date.now());
  }

  function pollForTag(startedAt) {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      // Flow is taking unusually long. Reload once so rx-form-gate.liquid picks up
      // the flag and shows its "still processing" message with a Refresh button.
      window.location.reload();
      return;
    }
    fetch(STATUS_URL + '&_=' + Date.now(),
      { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (txt) {
        var s = (JSON.parse(txt) || {}).state;
        // Leave the loading overlay ONLY when a RESULT tag lands. The transient 'pending'
        // (rx-pending = automation still running) is intentionally ignored — keep polling
        // until automation reports a real result:
        //   'verified' = 'doctor-only' or 'rx-review-approved-auto' (approved)
        //   'review'   = 'rx-review-pending' (manual review)
        if (s === 'verified' || s === 'review') {
          // Carry the freshly-confirmed state to the product page so it can render the
          // correct pill INSTANTLY on arrival — no re-fetch, no flash of a stale pill,
          // even if the product page itself comes back cached. snippets/rx-fresh-state.liquid
          // reads and clears this.
          try { sessionStorage.setItem('rxFreshState', s); } catch (e) {}
          var target = rxReturnUrl();
          window.location.href = target || window.location.href; // no return url known -> reload in place
          return;
        }
        // 'pending' (automation running), 'verify', 'guest' -> stay on the loading screen.
        setTimeout(function () { pollForTag(startedAt); }, POLL_MS);
      })
      .catch(function () {
        // Transient network / parse error — keep trying until the timeout.
        setTimeout(function () { pollForTag(startedAt); }, POLL_MS);
      });
  }

  function showProcessing() {
    // Reuse the theme's processing overlay if it's on the page; otherwise build one.
    var proc = document.querySelector('[data-rx-proc]');
    if (proc) { proc.hidden = false; document.body.style.overflow = 'hidden'; return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(20,40,28,.6);';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:28px 30px;max-width:360px;text-align:center;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.28);border-top:4px solid #2d5a3d;font-family:-apple-system,sans-serif;">' +
      '<div style="width:34px;height:34px;margin:0 auto 14px;border:3px solid #d7e6dc;border-top-color:#2d5a3d;' +
      'border-radius:50%;animation:rxfvspin .8s linear infinite;"></div>' +
      '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#1e3a28;">We’re processing your verification</h3>' +
      '<p style="margin:0;font-size:13.5px;line-height:1.5;color:#55635b;">Please keep this page open — this only takes a moment.</p>' +
      '</div>';
    var st = document.createElement('style');
    st.textContent = '@keyframes rxfvspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
  }

  function runGate(root, e) {
    var firstInvalid = null;
    [['first', findField(root, 'first')], ['last', findField(root, 'last')]].forEach(function (pair) {
      var kind = pair[0], el = pair[1];
      if (!el) return;
      // Whitespace-only cleanup (collapse/trim); characters are preserved so an invalid
      // one BLOCKS with a message here rather than being silently stripped and let through.
      var t = normalize(el.value);
      if (t !== el.value) reactSetValue(el, t);
      var r = validate(t, kind);
      if (r.valid) clearError(el);
      else { showError(el, r.message); if (!firstInvalid) firstInvalid = el; }
    });
    if (firstInvalid) {
      e.preventDefault();
      e.stopImmediatePropagation();   // run before + block Shopify Forms' React handler
      e.stopPropagation();
      firstInvalid.focus();
      return false;
    }
    // Valid → the form is submitting. Show processing, then poll in place until
    // the tag lands and navigate back to the product page.
    triggerProcessing();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 8. ATTACH TO A ROOT  (the form's shadow root, or the document)
   * Attaches the submit gate once and wires each field once.
   * ------------------------------------------------------------------ */
  function attachRoot(root) {
    if (!root.__rxGate) {
      root.__rxGate = true;
      // Capture phase so we run BEFORE the React form's own handlers.
      root.addEventListener('click', function (e) {
        var t = e.target;
        var btn = t && t.closest && t.closest('[data-testid="btn-form-submit"], button[type="submit"], input[type="submit"]');
        if (btn) runGate(root, e);
      }, true);
      root.addEventListener('submit', function (e) { runGate(root, e); }, true); // Enter key
    }
    wireFields(root);

    // Re-render support: watch this root for the form being re-injected and re-wire.
    if (!root.__rxObs) {
      root.__rxObs = true;
      try {
        new MutationObserver(function () { wireFields(root); })
          .observe(root, { childList: true, subtree: true });
      } catch (e) {}
    }
  }
  function wireFields(root) {
    ['first', 'last'].forEach(function (k) {
      var el = findField(root, k);
      if (el) attachField(el, k);
    });
  }

  /* ------------------------------------------------------------------ *
   * 9. MUTATION OBSERVER  (the form is injected asynchronously)
   * We watch the whole page for the form appearing. Because it lives in a
   * shadow root, scan() looks inside <shopify-forms-embed>.shadowRoot (and any
   * other open shadow root) as well as the light DOM. scan() is idempotent
   * (attach-once guards), so re-renders simply re-wire new field elements, and
   * a burst of mutations is debounced to one scan per animation frame.
   * ------------------------------------------------------------------ */
  function scan() {
    var found = false;
    document.querySelectorAll('shopify-forms-embed').forEach(function (host) {
      if (host.shadowRoot && findField(host.shadowRoot, 'first')) { attachRoot(host.shadowRoot); found = true; }
    });
    if (!found) {
      // Fallbacks: any other open shadow root, or the light DOM.
      document.querySelectorAll('*').forEach(function (host) {
        if (host.shadowRoot && findField(host.shadowRoot, 'first')) attachRoot(host.shadowRoot);
      });
      if (findField(document, 'first')) attachRoot(document);
    }
  }

  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan(); // in case the form is already present
})();
