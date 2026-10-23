# Self-hosted fonts

Variable TrueType fonts (weight axis 100-900), licensed under the SIL Open Font
License 1.1. Each licence text sits next to its font as `OFL-<family>.txt`.
Loaded through `next/font/local` in `src/app/layout.tsx`.

All files come from https://github.com/google/fonts at commit
`e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`.

| File                  | CSS variable     | Source                                |
| --------------------- | ---------------- | ------------------------------------- |
| `inter-tight-var.ttf` | `--font-display` | `ofl/intertight/InterTight[wght].ttf` |
| `geist-var.ttf`       | `--font-ui`      | `ofl/geist/Geist[wght].ttf`           |
| `geist-mono-var.ttf`  | `--font-utility` | `ofl/geistmono/GeistMono[wght].ttf`   |

Example URL (pinned):
`https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/geist/Geist%5Bwght%5D.ttf`

`inter-tight-800.ttf` is a static ExtraBold instance of `inter-tight-var.ttf`,
used only by `src/app/opengraph-image.tsx` because Satori cannot parse variable
fonts. Regenerate with:

    uv run --no-project --with fonttools python -I -m fontTools.varLib.instancer \
      public/fonts/inter-tight-var.ttf wght=800 -o public/fonts/inter-tight-800.ttf
