# Portrait control rows

Stacked pill/button groups must share the same left and right edges. Do not let content-sized wrapping produce a short, ragged last row.

- Use `.balanced-actions` for compact action groups: two equal columns, 8 px gaps, 44 px minimum tap height. An odd group starts with a full-width action.
- Use `.balanced-actions--primary` when the leading action needs its own full-width row. Secondary actions fill the row underneath; a remaining single action fills the row.
- Keep labels compact and centered. Allow wrapping instead of clipping, squeezing text, or reducing touch targets. Buttons in a row stretch to equal height.
- Keep contextual links such as Skip separate from the action grid, with deliberate alignment and spacing.
- For filter pills, use a shared row grid or growing cells so every wrapped row fills the same available width. Preserve label/count legibility; choose fewer columns at narrower widths.
- Do not apply this to inline text links, swipe docks, navigation tabs or horizontal carousels.

Applied to walkthrough actions, bottle-label review actions, expanded Winebrary-row actions and Wine catalog style-filter rows. Filter rows use growing cells (three across on phones, two on narrower phones) so partial last rows still fill the available width. Existing country/region paired controls already use equal columns.
