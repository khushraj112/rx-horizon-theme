# Rx License Verification — Session Handoff (current state)

Store: `test-khushraj-hydrogen` (Shopify Plus dev store). Theme: **Horizon**, Liquid, GitHub-connected (`khushraj112/rx-horizon-theme`). Live theme = branch **`main`**; local working branch = `product-page`.

Goal: only `rx-verified` customers can buy products tagged `requires-rx`. Everything inside Shopify (Shopify Forms + Flow + Veriflow API). No external server.

> NOTE: This supersedes the older "Talon + Locksmith" summary. **Locksmith has been removed** and the gate is now theme code. **Talon is no longer used** for the form (Shopify Forms is). See "Changed since old summary" at the bottom.

---

## Architecture (current, live)

**1. Apply form (Shopify Forms)**
- `Rx License Verification` — Form ID **1031424** (inline). Fields: email, license_number, state, NPI, name. On submit: creates/updates a customer, writes metafields, creates a form-submission metaobject.
- `Rx Manual Review` — Form ID **1031795** (inline). Fields: email, license/credential document upload, notes.

**2. Pages + templates (live on `main`)**
- `/pages/rx-apply` → template `page.rx-apply` → renders Form 1.
- `/pages/rx-manual-review` → template `page.rx-manual-review` → renders Form 2.
- Each form is on its **own dedicated template** so they can't collide.

**3. Form-page gate — `snippets/rx-form-gate.liquid` (live on `main`)**
- Rendered from `sections/main-page.liquid` (one `{% render 'rx-form-gate' %}` line), guarded to only run on the two Rx pages.
- Reads the logged-in customer's tag and **hides the form** (CSS on `[id$='__forms_inline_WBPENk']`) + shows a status message, EXCEPT in the one state where the form should show:
  - rx-apply shows Form 1 only when customer has **no** rx tag.
  - rx-manual-review shows Form 2 only when `rx-rejected`.
  - Other states (guest / pending / review / verified) → message, form hidden.
- This fixed the "form reappears on refresh mid-flow" bug. Verified live.

**4. Product gate — `blocks/buy-buttons.liquid` + `snippets/rx-gate.liquid` (live)**
- For products tagged `requires-rx`, buy buttons are server-side replaced with a tag-based gate message/CTA unless customer is `rx-verified`. Cannot be bypassed via CSS.
- `rx-gate.liquid` now also has an **optimistic localStorage bridge** (briefly shows next status after submit while Flow catches up, then auto-refreshes) and `return_url` params on the CTAs.
- Gated product: "Prescription Item (Rx Test)" (tagged `requires-rx`).

**5. Shopify Flow (all Active)**
- `Rx Bridge — Form to Pending`: trigger = Metaobject entry created (filtered to **Rx License Verification**) → add tag `rx-pending`.
- `New Workflow` (Veriflow auto-verify): trigger = Customer tags added (`rx-pending`) → HTTP to Veriflow with NPI/state metafields → parse → if active & not OIG-banned: add `rx-verified`, remove `rx-pending`; else add `rx-rejected`, remove `rx-pending`.
- `Rx Flow 2 - Manual Review`: trigger = Metaobject entry created (filtered to **Rx Manual Review**) → send internal email to khushraj@webrexstudio.com + add `rx-review`, remove `rx-rejected`.
- Two empty `New Workflow` flows exist (Inactive, "Trigger not defined" / "Customer created") — safe to delete.

**Tag state machine:** `(none)` → submit Form 1 → `rx-pending` → Veriflow → `rx-verified` (can buy) OR `rx-rejected` → submit Form 2 → `rx-review` → manual `rx-verified`.

---

## Verified working this session
- Both form pages hide the form + show the right status message once the customer has a tag (tested with an `rx-review` customer on both pages).
- Normal (non-Rx) pages render untouched.
- Flows fire correctly: a live test submission (email khushrajisngh13s@gmail.com, State MI) → Rx Bridge added `rx-pending` → Veriflow saw MI unsupported → flipped to `rx-rejected`. Full chain completed automatically.
- Both form-triggered flows are bound to their form by name, so they don't cross-fire.


---

## KEY OPEN ISSUE — email vs login mismatch
The Shopify Form tags the customer that matches the **email typed in the form**, NOT the logged-in browser session. In the test, the form **created a new customer** ("Forms created this customer") for khushrajisngh13s@gmail.com and tagged that one — while the browsing account stayed untagged, so its form kept showing. The gate is correct; the records were different.

**Fix for production:** pre-fill and lock the form's email field to `{{ customer.email }}` so a logged-in customer can only apply as themselves and the tag always lands on the right account. (Not yet built.)

---

## Remaining tasks
1. **Lock form email to logged-in customer** (resolves the mismatch above).
2. Confirm the enhanced `rx-gate.liquid` (optimistic bridge + return_url) is pushed/merged to `main` and live.
3. Veriflow: swap `vf_test_` → `vf_live_` key in the Flow HTTP header for go-live.
4. Confirm Veriflow's supported-state list for routing (MI currently rejects).
5. (Optional) Veriflow loop guard for cost.
6. (Optional, hardening) Shopify Function for un-bypassable cart/checkout enforcement — current gate is server-rendered UX, but a determined user could POST to `/cart/add`.
7. Remove the **Talon Account Approval** app once confirmed fully unused.
8. Clean up: delete the 2 empty Inactive flows; multiple duplicate "Kevin Foley" test customers exist from testing.

## Open question
Production store: **Liquid or Hydrogen?** This dev store is Liquid (Horizon). The earlier plan referenced headless/Hydrogen. Confirm the real production target — it decides whether the frontend gate is theme code (done here) or React storefront code.

## Apps currently installed
Forms, Flow, Talon Account Approval, Collective. (Locksmith uninstalled.)

---

## Changed since the old "Talon + Locksmith" summary
- **Locksmith removed** (app uninstalled, lock #827283 gone, snippets/wiring stripped). The "Locksmith paste blocker" is moot.
- Gate is now **theme code** (`buy-buttons.liquid` + `rx-gate.liquid`), not a Locksmith lock.
- Apply/manual-review use **Shopify Forms** on dedicated page templates, not Talon. Talon app still installed but pending removal.
- Form pages are now **tag-aware** (`rx-form-gate.liquid`) so forms don't reappear mid-flow.
