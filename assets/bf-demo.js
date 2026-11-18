import { CartAddEvent } from '@theme/events';

/** Shared: add one or more variants via the native Ajax Cart API in a single request,
 *  then let the existing cart drawer re-render through the theme's CartAddEvent. */
async function addToCart(items, sourceId) {
  const sectionIds = [
    ...new Set([...document.querySelectorAll('cart-items-component')].map((c) => c.dataset.sectionId).filter(Boolean)),
  ];
  const res = await fetch(window.Theme?.routes?.cart_add_url || '/cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items, sections: sectionIds.join(',') }),
  });
  const json = await res.json();
  if (!res.ok || json.status) throw new Error(json.description || json.message || 'Could not add to cart');
  const cart = await (await fetch('/cart.js')).json();
  document.dispatchEvent(
    new CartAddEvent(cart, sourceId, {
      source: 'bf-demo',
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      sections: json.sections,
    })
  );
  return cart;
}

function say(el, text, state) {
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state || '';
}

/** Sync price / compare-at / % off display from the selected <option> data attributes. */
function syncPrice(root, option) {
  if (!option) return;
  const cur = root.querySelector('[data-bf-current]');
  const cmp = root.querySelector('[data-bf-compare]');
  const badge = root.querySelector('[data-bf-badge]');
  if (cur && option.dataset.price) cur.textContent = option.dataset.price;
  if (cmp) {
    cmp.textContent = option.dataset.compare || '';
    cmp.hidden = !option.dataset.compare;
  }
  if (badge) {
    const pct = Number(option.dataset.pct || 0);
    badge.textContent = `${pct}% off`;
    badge.hidden = !pct;
  }
}

class BfCard extends HTMLElement {
  connectedCallback() {
    this.select = this.querySelector('[data-bf-variant]');
    if (this.select?.tagName === 'SELECT') {
      this.select.addEventListener('change', () => syncPrice(this, this.select.selectedOptions[0]));
    }
    this.querySelector('[data-bf-add]')?.addEventListener('click', (e) => this.#add(e.currentTarget));
  }
  async #add(btn) {
    const msg = this.querySelector('[data-bf-msg]');
    btn.disabled = true;
    try {
      await addToCart([{ id: Number(this.select.value), quantity: 1 }], this.id || 'bf-card');
      say(msg, 'Added to cart', 'ok');
    } catch (err) {
      say(msg, err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
}

class BfBogo extends HTMLElement {
  connectedCallback() {
    this.querySelectorAll('[data-bf-variant]').forEach((s) =>
      s.addEventListener('change', () => syncPrice(s.closest('.bf-bogo__item'), s.selectedOptions[0]))
    );
    this.querySelector('[data-bf-add-both]')?.addEventListener('click', (e) => this.#addBoth(e.currentTarget));
  }
  async #addBoth(btn) {
    const msg = this.querySelector('[data-bf-msg]');
    const q = this.querySelector('[data-role="qualifying"]');
    const rewards = [...this.querySelectorAll('[data-role="reward"]')];
    const r = rewards.find((el) => el.querySelector('input[type="radio"]')?.checked) || rewards[0];
    btn.disabled = true;
    try {
      // One request, both variants, quantities from the offer. Shopify validates and applies the BOGO discount.
      await addToCart(
        [
          { id: Number(q.querySelector('[data-bf-variant]').value), quantity: Number(q.dataset.qty) || 1 },
          { id: Number(r.querySelector('[data-bf-variant]').value), quantity: Number(r.dataset.qty) || 1 },
        ],
        this.dataset.offer
      );
      say(msg, 'Both products added', 'ok');
    } catch (err) {
      say(msg, err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
}

class BfCountdown extends HTMLElement {
  connectedCallback() {
    const end = new Date((this.dataset.end || '').replace(' ', 'T')).getTime();
    if (Number.isNaN(end)) return;
    const set = (k, v) => (this.querySelector(`[data-${k}]`).textContent = String(v));
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      this.hidden = left === 0;
      set('d', Math.floor(left / 864e5));
      set('h', Math.floor((left % 864e5) / 36e5));
      set('m', Math.floor((left % 36e5) / 6e4));
      set('s', Math.floor((left % 6e4) / 1e3));
      if (left === 0) clearInterval(this.timer);
    };
    tick();
    this.timer = setInterval(tick, 1000);
  }
  disconnectedCallback() {
    clearInterval(this.timer);
  }
}
if (!customElements.get('bf-countdown')) customElements.define('bf-countdown', BfCountdown);

/** Email signup via Klaviyo's public client Subscriptions API (no custom backend/storage).
 *  Requires a public company ID + list ID configured in the section settings. */
class BfSignup extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    this.msg = this.querySelector('[data-bf-signup-msg]');
    this.form.addEventListener('submit', (e) => this.#submit(e));
  }
  async #submit(e) {
    e.preventDefault();
    const input = this.form.elements.email;
    const email = input.value.trim();
    if (!email) return say(this.msg, 'Please enter your email address.', 'error');
    if (!input.checkValidity()) return say(this.msg, 'Please enter a valid email address.', 'error');
    const { companyId, listId } = this.dataset;
    if (!companyId || !listId) return say(this.msg, 'Signup is not configured yet (Klaviyo company ID / list ID missing).', 'error');
    try {
      const res = await fetch(`https://a.klaviyo.com/client/subscriptions/?company_id=${encodeURIComponent(companyId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', revision: '2024-10-15' },
        body: JSON.stringify({
          data: {
            type: 'subscription',
            attributes: {
              profile: { data: { type: 'profile', attributes: { email } } },
              custom_source: 'Black Friday Demo',
            },
            relationships: { list: { data: { type: 'list', id: listId } } },
          },
        }),
      });
      if (res.status !== 202) throw new Error();
      this.form.reset();
      say(this.msg, 'Thanks! Check your inbox to confirm.', 'ok');
    } catch {
      say(this.msg, 'Something went wrong. Please try again.', 'error');
    }
  }
}

if (!customElements.get('bf-card')) customElements.define('bf-card', BfCard);
if (!customElements.get('bf-bogo')) customElements.define('bf-bogo', BfBogo);
if (!customElements.get('bf-signup')) customElements.define('bf-signup', BfSignup);

class BfCarousel extends HTMLElement {
  connectedCallback() {
    const track = this.querySelector('[data-bf-track]');
    const step = () => (track.firstElementChild?.getBoundingClientRect().width || 300) + 24;
    this.querySelector('[data-bf-prev]')?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    this.querySelector('[data-bf-next]')?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
  }
}
if (!customElements.get('bf-carousel')) customElements.define('bf-carousel', BfCarousel);
