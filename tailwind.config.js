/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Near-black surfaces; elevation comes from lightness, not shadows. */
        bg: {
          DEFAULT: '#08090a',
          soft: '#0c0d0f',
          panel: '#131416',
          hover: '#1a1b1e',
          active: '#202124'
        },
        /* Hairlines. `line` is the default divider; `strong` for real edges. */
        line: {
          DEFAULT: '#1f2023',
          strong: '#2a2c30'
        },
        /* Four steps of text hierarchy — anything more reads as noise. */
        fg: {
          DEFAULT: '#f7f8f8',
          muted: '#8a8f98',
          subtle: '#62666d',
          faint: '#4a4e55'
        },
        accent: {
          DEFAULT: '#5e6ad2',
          hover: '#6e79db',
          soft: '#2a2f5c',
          fg: '#ffffff'
        },
        ok: '#68cc58',
        warn: '#f2c94c',
        danger: '#f2555a',
        info: '#4ea7fc',
        unity: '#4b9fe1',
        unreal: '#f28c28',
        custom: '#9b7bff'
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      /* Denser than Tailwind's default scale: 13px is the UI base. */
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs: ['11px', { lineHeight: '15px' }],
        sm: ['12px', { lineHeight: '16px' }],
        base: ['13px', { lineHeight: '18px' }],
        md: ['14px', { lineHeight: '20px' }],
        lg: ['15px', { lineHeight: '22px' }],
        xl: ['17px', { lineHeight: '24px' }],
        '2xl': ['21px', { lineHeight: '28px' }]
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px'
      },
      letterSpacing: {
        tight: '-0.011em',
        wider: '0.06em'
      },
      boxShadow: {
        panel: '0 10px 32px rgba(0,0,0,.5)',
        popover: '0 16px 64px rgba(0,0,0,.65)'
      }
    }
  },
  plugins: []
}
