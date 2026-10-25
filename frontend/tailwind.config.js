/** @type {import('tailwindcss').Config} */

// Eine Farbskala, deren 11 Stufen aus CSS-Variablen kommen (siehe index.css).
// Jede Variable hält RGB-Kanäle („29 33 37"), damit /alpha-Modifier weiter gehen.
const ramp = (name) => Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
    .map(step => [step, `rgb(var(--${name}-${step}) / <alpha-value>)`])
)

// Design wie die Prüfplanung: ruhige graue Fläche, weiße Blöcke mit 1-px-Linie,
// EIN Akzent (Petrol-/Marineblau) und gedeckte Statusfarben. Statt jede Seite
// anzufassen, werden die Paletten, die die Seiten benutzen, auf diese Skalen
// umgelenkt — Hell und Dunkel tauschen nur die Variablen.
const accent = ramp('akzent')
const red    = ramp('rot')
const green  = ramp('gruen')
const yellow = ramp('gelb')
const violet = ramp('lila')

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: ramp('s'),
        blue: accent, sky: accent, cyan: accent, indigo: accent,
        red, rose: red,
        emerald: green, green, teal: green,
        amber: yellow, yellow, orange: yellow,
        violet, purple: violet, fuchsia: violet, pink: violet,
        gray: ramp('s'),
      },
      // Schrift in surface bekommt eine eigene Skala: Die Seiten nutzen
      // text-surface-600/700 als „gedämpft" — im alten Dunkel-Design noch lesbar,
      // auf heller Fläche wären es Linienfarben. Die t-Skala hebt genau diese
      // Stufen auf lesbares Grau; Flächen und Linien bleiben bei --s-*.
      textColor: { surface: ramp('t'), gray: ramp('t') },
      placeholderColor: { surface: ramp('t') },
      // Flach statt verspielt: kleine Radien wie in der Prüfplanung.
      borderRadius: {
        sm: '2px', DEFAULT: '3px', md: '3px', lg: '4px', xl: '4px', '2xl': '6px', '3xl': '8px',
      },
      // Schatten nur noch für schwebende Dinge (Menüs, Dialoge, Toasts).
      boxShadow: {
        sm: 'none', DEFAULT: 'none', md: 'none',
        lg: '0 4px 14px rgb(29 33 37 / 0.16)',
        xl: '0 4px 14px rgb(29 33 37 / 0.16)',
        '2xl': '0 8px 28px rgb(29 33 37 / 0.22)',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
