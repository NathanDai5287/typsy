/** @type {import('tailwindcss').Config} */

/**
 * Gruvbox Material Dark Hard — https://github.com/sainnhe/gruvbox-material
 *
 * Warm low-contrast variant of classic Gruvbox. Picked for the Typsy UI
 * revamp: feels like a vim/tmux terminal session, sharp corners, monospace
 * everywhere, no gradients or fancy fills. Background pulled toward the
 * "hard" black so panels / chrome read as inset against the canvas.
 */
const gruv = {
  // Surfaces (darker → lighter)
  bg0_h:    '#0d0e0f', // canvas (slightly darker than upstream #1d2021 for higher contrast against panels)
  bg0:      '#161819', // base panel
  bg1:      '#1d2021', // inset panel / hover
  bg2:      '#282828', // raised panel
  bg3:      '#32302f', // hover / focus on raised
  bg4:      '#3c3836', // border-strong
  bg5:      '#504945', // disabled fill / border on raised

  // Text (dim → bright)
  fg4:      '#7c6f64', // muted / commentary
  fg3:      '#928374', // subtext
  fg2:      '#a89984', // body-2
  fg1:      '#bdae93', // body
  fg0:      '#d4be98', // emphatic body
  fg_h:     '#ddc7a1', // bright text

  // Accents (muted Gruvbox Material)
  red:      '#ea6962',
  orange:   '#e78a4e',
  yellow:   '#d8a657',
  green:    '#a9b665',
  aqua:     '#89b482',
  blue:     '#7daea3',
  purple:   '#d3869b',

  // Brighter accents for hover/active states
  red_h:    '#fb4934',
  orange_h: '#fe8019',
  yellow_h: '#fabd2f',
  green_h:  '#b8bb26',
  aqua_h:   '#8ec07c',
  blue_h:   '#83a598',
  purple_h: '#d3869b',
};

/**
 * Map Tailwind's standard color scales onto Gruvbox tones so the existing
 * class names (bg-gray-900, text-blue-400, …) automatically render with
 * the new palette. Lower numbers = lighter / accent, higher numbers =
 * darker / surface, mirroring Tailwind's gray semantics.
 *
 * The legacy `crust` / `mantle` / `surface*` / `text` etc. names from the
 * old Catppuccin theme are also kept as aliases to surfaces so any
 * remaining code that referenced them still resolves to a sensible tone
 * during the revamp.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // The whole UI is monospace now — terminal vibes.
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', 'monospace'],
        sans: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        // ── Named Gruvbox tones ──────────────────────────────────────
        bg_h:     gruv.bg0_h,
        bg0:      gruv.bg0,
        bg1:      gruv.bg1,
        bg2:      gruv.bg2,
        bg3:      gruv.bg3,
        bg4:      gruv.bg4,
        bg5:      gruv.bg5,
        fg0:      gruv.fg0,
        fg1:      gruv.fg1,
        fg2:      gruv.fg2,
        fg3:      gruv.fg3,
        fg4:      gruv.fg4,
        fg_h:     gruv.fg_h,
        accent:   gruv.yellow,

        // Aliases for compatibility with old Catppuccin names — kept so
        // the rare leftover className still resolves. New code should
        // prefer the explicit Gruvbox tokens above.
        crust:    gruv.bg0_h,
        mantle:   gruv.bg0,
        base:     gruv.bg1,
        surface0: gruv.bg2,
        surface1: gruv.bg3,
        surface2: gruv.bg4,
        overlay0: gruv.fg4,
        overlay1: gruv.fg3,
        overlay2: gruv.fg2,
        subtext0: gruv.fg2,
        subtext1: gruv.fg1,
        text:     gruv.fg0,
        rosewater: gruv.orange,
        flamingo:  gruv.orange,
        mauve:     gruv.purple,
        maroon:    gruv.red,
        peach:     gruv.orange,
        teal:      gruv.aqua,
        sky:       gruv.blue,
        sapphire:  gruv.blue,
        lavender:  gruv.blue,

        // ── Standard scales remapped to Gruvbox ──────────────────────
        white:    gruv.fg_h,
        black:    gruv.bg0_h,
        gray: {
          50:  gruv.fg_h,
          100: gruv.fg0,
          200: gruv.fg1,
          300: gruv.fg2,
          400: gruv.fg3,
          500: gruv.fg4,
          600: gruv.bg5,
          700: gruv.bg4,
          800: gruv.bg3,
          900: gruv.bg1,
          950: gruv.bg0,
        },
        blue: {
          50:  gruv.blue_h, 100: gruv.blue_h, 200: gruv.blue_h,
          300: gruv.blue_h, 400: gruv.blue_h, 500: gruv.blue,
          600: gruv.blue,   700: gruv.blue,   800: gruv.blue,
          900: gruv.blue,   950: gruv.blue,
        },
        red: {
          50:  gruv.red_h, 100: gruv.red_h, 200: gruv.red_h,
          300: gruv.red_h, 400: gruv.red_h, 500: gruv.red,
          600: gruv.red,   700: gruv.red,   800: gruv.red,
          900: gruv.red,   950: gruv.red,
        },
        green: {
          50:  gruv.green_h, 100: gruv.green_h, 200: gruv.green_h,
          300: gruv.green_h, 400: gruv.green_h, 500: gruv.green,
          600: gruv.green,   700: gruv.green,   800: gruv.green,
          900: gruv.green,   950: gruv.green,
        },
        yellow: {
          50:  gruv.yellow_h, 100: gruv.yellow_h, 200: gruv.yellow_h,
          300: gruv.yellow_h, 400: gruv.yellow_h, 500: gruv.yellow,
          600: gruv.yellow,   700: gruv.yellow,   800: gruv.yellow,
          900: gruv.yellow,   950: gruv.yellow,
        },
        orange: {
          50:  gruv.orange_h, 100: gruv.orange_h, 200: gruv.orange_h,
          300: gruv.orange_h, 400: gruv.orange_h, 500: gruv.orange,
          600: gruv.orange,   700: gruv.orange,   800: gruv.orange,
          900: gruv.orange,   950: gruv.orange,
        },
        purple: {
          50:  gruv.purple_h, 100: gruv.purple_h, 200: gruv.purple_h,
          300: gruv.purple_h, 400: gruv.purple_h, 500: gruv.purple,
          600: gruv.purple,   700: gruv.purple,   800: gruv.purple,
          900: gruv.purple,   950: gruv.purple,
        },
        cyan: {
          50:  gruv.aqua_h, 100: gruv.aqua_h, 200: gruv.aqua_h,
          300: gruv.aqua_h, 400: gruv.aqua_h, 500: gruv.aqua,
          600: gruv.aqua,   700: gruv.aqua,   800: gruv.aqua,
          900: gruv.aqua,   950: gruv.aqua,
        },
        pink: {
          50:  gruv.purple_h, 100: gruv.purple_h, 200: gruv.purple_h,
          300: gruv.purple_h, 400: gruv.purple_h, 500: gruv.purple,
          600: gruv.purple,   700: gruv.purple,   800: gruv.purple,
          900: gruv.purple,   950: gruv.purple,
        },
      },
    },
  },
  plugins: [],
};
