/** @type {import('tailwindcss').Config} */

// Catppuccin Mocha — https://catppuccin.com/palette
const mocha = {
  rosewater: '#f5e0dc',
  flamingo:  '#f2cdcd',
  pink:      '#f5c2e7',
  mauve:     '#cba6f7',
  red:       '#f38ba8',
  maroon:    '#eba0ac',
  peach:     '#fab387',
  yellow:    '#f9e2af',
  green:     '#a6e3a1',
  teal:      '#94e2d5',
  sky:       '#89dceb',
  sapphire:  '#74c7ec',
  blue:      '#89b4fa',
  lavender:  '#b4befe',
  text:      '#cdd6f4',
  subtext1:  '#bac2de',
  subtext0:  '#a6adc8',
  overlay2:  '#9399b2',
  overlay1:  '#7f849c',
  overlay0:  '#6c7086',
  surface2:  '#585b70',
  surface1:  '#45475a',
  surface0:  '#313244',
  base:      '#1e1e2e',
  mantle:    '#181825',
  crust:     '#11111b',
};

/**
 * Map Tailwind's standard color scales onto Catppuccin Mocha tones so the
 * existing class names (bg-gray-900, text-blue-400, …) automatically render
 * with the new palette. Hover pairs (e.g. bg-blue-600 → hover:bg-blue-500)
 * still produce a visible lightness shift.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      colors: {
        // Named Catppuccin tones, available directly as e.g. `bg-mauve`,
        // `text-subtext1`, `border-surface2`, etc.
        rosewater: mocha.rosewater,
        flamingo:  mocha.flamingo,
        mauve:     mocha.mauve,
        maroon:    mocha.maroon,
        peach:     mocha.peach,
        teal:      mocha.teal,
        sky:       mocha.sky,
        sapphire:  mocha.sapphire,
        lavender:  mocha.lavender,
        text:      mocha.text,
        subtext0:  mocha.subtext0,
        subtext1:  mocha.subtext1,
        overlay0:  mocha.overlay0,
        overlay1:  mocha.overlay1,
        overlay2:  mocha.overlay2,
        surface0:  mocha.surface0,
        surface1:  mocha.surface1,
        surface2:  mocha.surface2,
        base:      mocha.base,
        mantle:    mocha.mantle,
        crust:     mocha.crust,

        // ── Overrides for the standard Tailwind palette ──────────────────
        // Map gray scale onto Catppuccin's mantle → text spectrum.
        white: mocha.text,
        black: mocha.crust,
        gray: {
          50:  mocha.text,
          100: mocha.text,
          200: mocha.subtext1,
          300: mocha.subtext0,
          400: mocha.overlay2,
          500: mocha.overlay1,
          600: mocha.overlay0,
          700: mocha.surface2,
          800: mocha.surface1,
          900: mocha.surface0,
          950: mocha.mantle,
        },

        // Accent shades: lighter sibling for 100–500 (used as hover/focus
        // targets), main accent for 600+ (used as primary fills).
        blue: {
          50:  mocha.lavender, 100: mocha.lavender, 200: mocha.lavender,
          300: mocha.lavender, 400: mocha.lavender, 500: mocha.lavender,
          600: mocha.blue,     700: mocha.blue,     800: mocha.blue,
          900: mocha.blue,     950: mocha.blue,
        },
        red: {
          50:  mocha.maroon, 100: mocha.maroon, 200: mocha.maroon,
          300: mocha.maroon, 400: mocha.red,    500: mocha.red,
          600: mocha.red,    700: mocha.red,    800: mocha.red,
          900: mocha.red,    950: mocha.red,
        },
        green: {
          50:  mocha.teal,  100: mocha.teal,  200: mocha.teal,
          300: mocha.teal,  400: mocha.green, 500: mocha.green,
          600: mocha.green, 700: mocha.green, 800: mocha.green,
          900: mocha.green, 950: mocha.green,
        },
        yellow: {
          50:  mocha.yellow, 100: mocha.yellow, 200: mocha.yellow,
          300: mocha.yellow, 400: mocha.yellow, 500: mocha.yellow,
          600: mocha.peach,  700: mocha.peach,  800: mocha.peach,
          900: mocha.peach,  950: mocha.peach,
        },
        purple: {
          50:  mocha.mauve, 100: mocha.mauve, 200: mocha.mauve,
          300: mocha.mauve, 400: mocha.mauve, 500: mocha.mauve,
          600: mocha.mauve, 700: mocha.mauve, 800: mocha.mauve,
          900: mocha.mauve, 950: mocha.mauve,
        },
        cyan: {
          50:  mocha.sky, 100: mocha.sky, 200: mocha.sky,
          300: mocha.sky, 400: mocha.sky, 500: mocha.sky,
          600: mocha.sky, 700: mocha.sapphire, 800: mocha.sapphire,
          900: mocha.sapphire, 950: mocha.sapphire,
        },
        pink: {
          50:  mocha.pink, 100: mocha.pink, 200: mocha.pink,
          300: mocha.pink, 400: mocha.pink, 500: mocha.pink,
          600: mocha.pink, 700: mocha.pink, 800: mocha.pink,
          900: mocha.pink, 950: mocha.pink,
        },
      },
    },
  },
  plugins: [],
};
