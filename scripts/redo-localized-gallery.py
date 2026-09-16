#!/usr/bin/env python3
"""Re-enable the localized product gallery (custom.localized_gallery).

Undoes the "LOCALIZED GALLERY SLOTS - DISABLED, REDO LATER" state by putting
the plan builder, the four gallery_plan loops, the six pagination counts and
the product-media.liquid fallbacks back into the theme.

Run from the theme root:   python3 scripts/redo-localized-gallery.py
Nothing is written unless every anchor below is found exactly once.
"""

import os
import subprocess
import sys

GALLERY = "snippets/product-media-gallery-content.liquid"
MEDIA = "snippets/product-media.liquid"

# The commit this script reproduces, used only for the optional final check.
FEATURE_COMMIT = "1c65b2d"

PLAN_BUILDER = """  # --- Localized gallery slots -------------------------------------------
  # Applies the selected variant's custom.localized_gallery slots to the media
  # list. Positions resolve against the ORIGINAL list, so the result does not
  # depend on processing order. Slot values are already locale-resolved by
  # Shopify, so there is deliberately no locale logic here.
  assign loc_slots = selected_product.selected_or_first_available_variant.metafields.custom.localized_gallery.value
  assign gallery_plan = ''
  for m in sorted_media
    assign pos = forloop.index
    assign i0 = forloop.index0
    assign replaced = false
    assign si = 0
    for s in loc_slots
      assign act = s.action.value | downcase | strip
      if s.image.value and s.position.value == pos
        if act == 'insert'
          assign gallery_plan = gallery_plan | append: 's' | append: si | append: ','
        elsif act == 'replace'
          assign gallery_plan = gallery_plan | append: 's' | append: si | append: ','
          assign replaced = true
        endif
      endif
      assign si = si | plus: 1
    endfor
    unless replaced
      assign gallery_plan = gallery_plan | append: 'o' | append: i0 | append: ','
    endunless
  endfor
  # Overflow: a slot beyond the end of the gallery is appended, never dropped.
  assign si = 0
  for s in loc_slots
    assign act = s.action.value | downcase | strip
    if s.image.value and s.position.value > sorted_media.size
      if act == 'replace' or act == 'insert'
        assign gallery_plan = gallery_plan | append: 's' | append: si | append: ','
      endif
    endif
    assign si = si | plus: 1
  endfor
  assign gallery_plan = gallery_plan | split: ','
"""

# Resolves one gallery_plan step to `media`: 'o<i>' = original media, 's<i>' = slot image.
STEP_RESOLVER = """{%- liquid
          assign kind = step | slice: 0
          assign idx = step | slice: 1, 10 | plus: 0
          if kind == 'o'
            assign media = sorted_media[idx]
          else
            assign media = nil
            assign lookup_i = 0
            for lookup_slot in loc_slots
              if lookup_i == idx
                assign media = lookup_slot.image.value
              endif
              assign lookup_i = lookup_i | plus: 1
            endfor
          endif
        -%}"""

DISABLED_START = (
    "\n\n  # ============================================================\n"
    "  # LOCALIZED GALLERY SLOTS - DISABLED, REDO LATER"
)
DISABLED_END = (
    "  # END LOCALIZED GALLERY SLOTS\n"
    "  # ============================================================\n"
)

MEDIA_DISABLED_START = (
    "\n  # ============================================================\n"
    "  # LOCALIZED GALLERY SUPPORT - DISABLED, REDO LATER"
)
MEDIA_DISABLED_END = (
    "  # assign media_preview = media.preview_image | default: media.image\n"
    "  # ============================================================\n"
)

MEDIA_FALLBACKS = """{%- liquid
  # media may be a product media object or a Files media_image coming from a
  # localized gallery slot; the latter exposes aspect_ratio on preview_image.
  assign media_ratio = media.aspect_ratio | default: media.preview_image.aspect_ratio | default: media.image.aspect_ratio | default: 1.0
  # A Files media_image (localized gallery slot) has no preview_image; use .image.
  assign media_preview = media.preview_image | default: media.image
-%}
"""

# (old, new) pairs applied to the gallery snippet. Each must match exactly once
# unless a count is given: the two slideshow-controls item_count lines are
# identical and both change.
GALLERY_EDITS = [
    # --- the four media loops -------------------------------------------
    # Each pattern is newline-anchored so the indentation is matched exactly;
    # without that the 6-space loop also matches inside the 8-space one.
    ("\n      {% for media in sorted_media %}\n",
     "\n      {% for step in gallery_plan %}" + STEP_RESOLVER + "\n", 1),
    ("\n        {% for media in sorted_media %}\n",
     "\n        {% for step in gallery_plan %}" + STEP_RESOLVER + "\n", 1),
    ("\n                {%- for media in sorted_media -%}\n",
     "\n                {%- for step in gallery_plan -%}" + STEP_RESOLVER + "\n", 1),
    ("\n            {%- for media in sorted_media -%}\n",
     "\n            {%- for step in gallery_plan -%}" + STEP_RESOLVER + "\n", 1),
    # --- the six pagination counts ---------------------------------------
    ("or sorted_media.size == 1 or", "or gallery_plan.size == 1 or", 1),
    ("\n    {% if sorted_media.size > 1 %}", "\n    {% if gallery_plan.size > 1 %}", 1),
    ("\n              {% if sorted_media.size > 1 %}",
     "\n              {% if gallery_plan.size > 1 %}", 1),
    ("\n            item_count: sorted_media.size,",
     "\n            item_count: gallery_plan.size,", 2),
    ("\n      slide_count: sorted_media.size,",
     "\n      slide_count: gallery_plan.size,", 1),
]

MEDIA_EDITS = [
    ('\n  style="--ratio: {{ media.aspect_ratio }}"',
     '\n  style="--ratio: {{ media_ratio }}"', 1),
    ("\n    assign high_res_url = media.preview_image | image_url: width: 3840",
     "\n    assign high_res_url = media_preview | image_url: width: 3840", 1),
    ("\n    media.preview_image\n", "\n    media_preview\n", 1),
    ("\n              media.preview_image\n", "\n              media_preview\n", 1),
]


def fail(msg):
    print("ABORTED: " + msg, file=sys.stderr)
    print("Nothing was written.", file=sys.stderr)
    sys.exit(1)


def cut_block(text, path, start, end, replacement):
    i = text.find(start)
    if i == -1:
        fail("%s: could not find the disabled-block banner." % path)
    j = text.find(end, i)
    if j == -1:
        fail("%s: found the banner but not its end marker." % path)
    return text[:i] + replacement + text[j + len(end):]


def apply_edits(text, path, edits):
    for old, new, count in edits:
        found = text.count(old)
        if found != count:
            fail("%s: expected %d occurrence(s) of %r, found %d."
                 % (path, count, old.strip()[:60], found))
        text = text.replace(old, new)
    return text


def main():
    if not (os.path.isfile(GALLERY) and os.path.isfile(MEDIA)):
        fail("run this from the theme root (snippets/ not found).")

    gallery = open(GALLERY).read()
    media = open(MEDIA).read()

    if "gallery_plan" in gallery and "# assign gallery_plan" not in gallery:
        print("Already enabled - gallery_plan is live. Nothing to do.")
        return

    # 1. swap the commented-out banner for the real plan builder
    gallery = cut_block(gallery, GALLERY, DISABLED_START, DISABLED_END,
                        "\n" + PLAN_BUILDER + "\n")
    # 2. + 3. the four loops and six counts
    gallery = apply_edits(gallery, GALLERY, GALLERY_EDITS)

    # 4. product-media.liquid: drop the banner, add the real fallbacks
    media = cut_block(media, MEDIA, MEDIA_DISABLED_START, MEDIA_DISABLED_END, "")
    div_anchor = "\n%}\n\n<div\n  class=\"product-media\""
    if media.count(div_anchor) != 1:
        fail("%s: could not find the product-media div to anchor the fallbacks." % MEDIA)
    media = media.replace(div_anchor,
                          "\n%}\n\n" + MEDIA_FALLBACKS + "<div\n  class=\"product-media\"")
    media = apply_edits(media, MEDIA, MEDIA_EDITS)

    open(GALLERY, "w").write(gallery)
    open(MEDIA, "w").write(media)
    print("Re-enabled the localized gallery in:")
    print("  " + GALLERY)
    print("  " + MEDIA)

    # Optional: prove the result matches the commit the feature was built in.
    try:
        subprocess.check_output(["git", "rev-parse", "--verify",
                                 FEATURE_COMMIT + "^{commit}"],
                                stderr=subprocess.DEVNULL)
    except Exception:
        print("\n(git check skipped - commit %s not reachable here)" % FEATURE_COMMIT)
        return
    drift = subprocess.run(["git", "diff", "--quiet", FEATURE_COMMIT, "--",
                            GALLERY, MEDIA])
    if drift.returncode == 0:
        print("\nVerified: byte-identical to commit %s." % FEATURE_COMMIT)
    else:
        print("\nHeads up: the result differs from commit %s. Review with:" % FEATURE_COMMIT)
        print("  git diff %s -- %s %s" % (FEATURE_COMMIT, GALLERY, MEDIA))


if __name__ == "__main__":
    main()
