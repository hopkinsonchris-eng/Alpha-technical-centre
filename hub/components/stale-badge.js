/* ============================================================
   <stale-badge> (M07). A plain custom element, no framework, light DOM so
   the shared language toggle (main.js, data-en / data-es) keeps working.

     <stale-badge reason="run on 2.0.0; 2.1.0 is breaking"></stale-badge>
     el.reasons = run.stale_reasons;      // [{rule, ref, detail}] -> first detail

   Hover shows the first stale reason; the reason is also always available
   inline next to the record (timeline-list) so it is not hover-only.
   ============================================================ */
import { mk, reasonText } from '../hub.js';

/** The first stale reason as text, or '' (accepts strings and {rule, ref, detail}). */
export function firstReason(reasons) {
  if (!Array.isArray(reasons) || !reasons.length) return '';
  return reasonText(reasons[0]);
}

export class StaleBadge extends HTMLElement {
  static get observedAttributes() { return ['reason']; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  /** Set from a stale_reasons array; the first detail becomes the tooltip. */
  set reasons(list) {
    const r = firstReason(list);
    if (r) this.setAttribute('reason', r); else this.removeAttribute('reason');
  }
  get reasons() { return this.getAttribute('reason') ? [this.getAttribute('reason')] : []; }
  render() {
    const reason = this.getAttribute('reason') || '';
    this.textContent = '';
    const b = mk('span', 'hub-stale', 'Stale', 'Obsoleta', reason ? { title: reason } : null);
    this.appendChild(b);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('stale-badge')) customElements.define('stale-badge', StaleBadge);
