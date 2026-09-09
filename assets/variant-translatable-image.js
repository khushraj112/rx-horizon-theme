import { Component } from '@theme/component';
import { ThemeEvents } from '@theme/events';

/**
 * Renders the selected variant's translatable image.
 *
 * On a same-product variant change Horizon leaves `morphElementSelector` undefined
 * (see variant-picker.js), so only the variant picker is morphed and the rest of the
 * section keeps its server-rendered markup. This component therefore updates itself
 * from the section HTML carried on the variant:update event — the same approach
 * media-gallery.js uses.
 *
 * @extends Component
 */
export class VariantTranslatableImage extends Component {
  #controller = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
  }

  /**
   * Replaces this element with the freshly rendered one for the newly selected variant.
   *
   * @param {CustomEvent} event - The variant:update event.
   */
  #handleVariantUpdate = (event) => {
    const { data } = event.detail;
    if (!data) return;

    // Ignore updates fired by a different product (quick add dialogs, cards).
    if (data.productId && String(data.productId) !== String(this.dataset.productId)) return;

    const updated = data.html?.querySelector('variant-translatable-image');
    if (!updated) return;

    this.replaceWith(updated);
  };
}

if (!customElements.get('variant-translatable-image')) {
  customElements.define('variant-translatable-image', VariantTranslatableImage);
}
