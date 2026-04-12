/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0D0D0D',
          800: '#141414',
          700: '#1C1C1C',
          600: '#262626',
          500: '#3A3A3A',
          300: '#8B8B8B',
          100: '#E8E8E8'
        },
        pos: {
          qb: '#3B82F6',
          rb: '#10B981',
          wr: '#F59E0B',
          te: '#EF4444',
          pick: '#8B5CF6'
        }
      },
      fontFamily: {
        display: ['"Clash Display"', '"Cabinet Grotesk"', 'Satoshi', 'ui-sans-serif', 'system-ui'],
        body: ['"Inter"', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        'inner-hair': 'inset 0 0 0 1px rgba(255,255,255,0.05)'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' }
        },
        fadeup: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        fadeup: 'fadeup 400ms ease-out both'
      }
    }
  },
  plugins: []
};
