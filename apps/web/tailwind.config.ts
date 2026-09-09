import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Ateva's public and application surfaces share a neutral ramp. Brand
        // utilities remain available for existing markup, but resolve to ink
        // and tonal gray rather than introducing a second chromatic identity.
        brand: {
          50: '#fafafb',
          100: '#f2f2f3',
          200: '#e6e6e8',
          300: '#d5d6d9',
          400: '#979799',
          500: '#17191c',
          600: '#111315',
          700: '#0d0e10',
          800: '#080909',
          900: '#050506',
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
        // Application dark surfaces use charcoal and white hierarchy. The
        // older `ink-*` names stay stable so operational pages do not need a
        // risky markup rewrite during the visual pass.
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
