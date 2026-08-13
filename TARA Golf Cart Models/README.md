# TARA Golf Cart Models — export package

One folder per model. Each model folder contains:

- `model.md` — human-readable overview: description, colors, full specifications, image list
- `specs.json` — all data machine-readable, including the schema.org Product markup (`schema_org`) ready to paste into a `<script type="application/ld+json">` tag
- `colors.css` — color-picker styles mapping each swatch thumbnail to its matching vehicle image
- `card.html` — ready-to-use model card snippet (image, name, category)
- `images/` — every image for the model: hero/card image, all color variation photos, swatch thumbnails, gallery photos, and detail/feature images

To rebuild model pages on another site: use `model.md`/`specs.json` for content and specs, `images/` for assets, `colors.css` + the `colors` array in `specs.json` for the color chooser, and `card.html` for listing pages.
