/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primair: {
          DEFAULT: "#0F3D5C",
          licht: "#1B6E9B",
          diep: "#0A2C43",
        },
        accent: {
          DEFAULT: "#0E8F7E",
          licht: "#2FB3A0",
          zacht: "#E3F2EF",
        },
        zacht: "#F4F7F9",
        tekst: "#132029",
        gedempt: "#556270",
        rand: {
          DEFAULT: "#DCE4EA",
          sterk: "#C2CED8",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "Noto Sans",
          "sans-serif",
        ],
      },
      maxWidth: {
        tekst: "68ch",
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};
