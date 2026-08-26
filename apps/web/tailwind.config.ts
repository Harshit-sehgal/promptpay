import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Warm editorial ramp ported from the Steep style reference: an
        // achromatic ink/paper canvas punctuated by one chromatic pair,
        // Blush Peach (#fbe1d1) and Sienna Brown (#5d2a1a). The ramp stays one
        // hue and monotonically darker as the number rises, replacing the old
        // green ramp value-for-value so every `brand-*` class keeps its role:
        // 500 remains the primary accent (text, fills, rings, logo bar),
        // 50-200 remain tints, 600+ remain hover/pressed steps.
        brand: {
          50: '#fdf8f3',
          100: '#faeee2',
          200: '#fbe1d1', // Blush Peach - tint surfaces, sienna text on it is 9.2:1
          300: '#f2cba9',
          400: '#c07d4e', // decorative borders/rings only - 3.34:1 on white, not for text
          500: '#5d2a1a', // Sienna Brown - 11.58:1 on white; white text on it passes AA
          600: '#4a2113', // 13.83:1
          700: '#3b1a0f',
          800: '#2b1208',
          900: '#1d0c05',
        },
        surface: {
          0: '#ffffff',
          50: '#fafafb',
          100: '#f2f2f3',
          200: '#e6e6e8',
          300: '#d5d6d9',
          400: '#6b6b6b',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
        // Dashboard dark surfaces, realigned from a blue-cast ramp to Steep's
        // single warm-neutral near-black so panels read as ink on paper.
        ink: {
          900: '#0d0e10',
          800: '#17191c',
          700: '#202226',
          600: '#2d3036',
          400: '#585c63',
          300: '#80848c',
          200: '#a4a8af',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        // Without this key `font-serif` fell through to Tailwind's default
        // (Georgia), so the Instrument Serif face imported in globals.css only
        // ever rendered where a page hardcoded it in an inline style.
        serif: ['var(--font-serif)', 'Instrument Serif', 'Georgia', 'Cambria', 'serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
        'slide-in': 'slideIn 0.3s ease-out forwards',
        float: 'float 6s ease-in-out infinite',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
