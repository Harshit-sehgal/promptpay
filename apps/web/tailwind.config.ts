import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Single green brand ramp. Steps 50-400 were already green while 500-900
        // were teal, so `brand-500` and the `--accent` green in globals.css named
        // two different colours; the logo mark used one and every link the other.
        // The ramp is now one hue and monotonically darker as the number rises —
        // 500->600 previously got *lighter* (5.47 -> 3.74 against white), which
        // made `Button variant="brand"` drop below AA on hover.
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#0d7a3f', // 5.42:1 on white - white text passes AA
          600: '#0a6836', // 6.89:1
          700: '#0b5c3a', // 8.06:1
          800: '#08492e', // 10.49:1
          900: '#063a25', // 12.81:1
        },
        surface: {
          0: '#ffffff',
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#6b6b6b',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
        ink: {
          900: '#0a0e1a',
          800: '#131825',
          700: '#1c2235',
          600: '#2a3149',
          400: '#525a76',
          300: '#787f99',
          200: '#9ba1b6',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        // Without this key `font-serif` fell through to Tailwind's default
        // (Georgia), so the Instrument Serif face imported in globals.css only
        // ever rendered where a page hardcoded it in an inline style.
        serif: ['Instrument Serif', 'Georgia', 'Cambria', 'serif'],
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
