Layout fix for sim02 freefall simulator (index.html): the page is too tall
and requires scrolling in a Canvas iframe (~700-950px viewport height).

Rearrange into a 2-column layout that fits ~1280x800 with no scrolling:
- Left column: canvas animation + controls (compact, no wasted padding)
- Right column: both graphs, stacked, sized to fit column height
- Reduce all font sizes/margins/padding as needed to hit this target
- Keep all existing functionality and physics logic unchanged

After: confirm total rendered height is under ~800px at 1280px width.
