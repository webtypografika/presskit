# Palette 4: Pure Teal — Light

**Status**: Staging test on `pro.presscal.com` first. Apply to PressKit only after PressCal review passes.

**Visual reference**: `palette-preview.html` (card #4)

## Tokens

```
--bg-primary:      #f5f9f9    /* paper-white με teal tint */
--bg-secondary:    #ffffff    /* cards, surfaces, main panels */
--bg-tertiary:     #ebf3f3    /* sidebar, headers, hover backgrounds */
--border:          #d8e6e6    /* subtle teal-grey */
--border-strong:   #b8d4d4    /* emphasized borders */

--text-primary:    #0e1518    /* near-black, slight cool */
--text-secondary:  #3f5856
--text-muted:      #6b817f

--accent-primary:  #00707c    /* CTAs, primary buttons, active nav */
--accent-hover:    #008892
--accent-text:     #ffffff    /* text on teal buttons */

--selected-bg:     #d8eded    /* selected rows, active nav backgrounds */
--selected-text:   #00707c
--highlight:       #6ec8c8    /* hover states, links, info accents */

--success:         #2d8659
--danger:          #dc2626
--warning:         #d97706

/* File type colors (kept for variety in lists) */
--file-pdf:        #e07a3c
--file-psd:        #00707c
--file-jpg:        #6ec8c8
--file-other:      #6b817f
```

## Removed

- **Brand orange `#f58220`** → no longer used in this palette
- **Deep blue `#1d2f6e`** → fully replaced by teal

If a warning/destructive accent is needed, use `--danger: #dc2626` (red), not orange.

## Component-level rules

| Component | Background | Text | Accent |
|-----------|-----------|------|--------|
| Primary button | `#00707c` | `#ffffff` | hover → `#008892` |
| Secondary button | `#ffffff` | `#00707c` | border `#b8d4d4` |
| Selected row | `#d8eded` | `#00707c` | — |
| Active nav item | `#d8eded` | `#00707c` | dot `#00707c` |
| Trial banner | `#d8eded` | `#00707c` | — (was orange) |
| Card / panel | `#ffffff` | `#0e1518` | border `#d8e6e6` |
| Sidebar | `#ebf3f3` | `#1f3331` | — |

## Rollout plan

1. **`pro.presscal.com`** (staging) → branch `palette-teal-light-test`
2. Visual review in real product context
3. If approved → merge to `main` → apply to `demo.gr.presscal.com`
4. Then apply same tokens to **PressKit** (`globals.css`, theme tokens) → bump v1.2.0 → new release

## Source

Generated from `presscal-filehelper/resources/icon-drafts/palette-preview.html` (palette #4).
Inspired by the rhino logo variant (gray on teal).
