/** @type {import('tailwindcss').Config} */
module.exports = {
  //mode: 'jit',
  content: [
    "./src/views/pages/**/*.{html,js,ejs}",
    "./src/views/components/**/*.{html,js,ejs}",
    "./src/views/index.{html,js,ejs}",
    "./node_modules/flowbite/**/*.js"
  ],
  theme: {
    extend: {},
  },
  plugins: [
        require('flowbite/plugin')
  ]
}