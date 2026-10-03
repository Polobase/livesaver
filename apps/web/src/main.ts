// First of all: a pairing in the address is taken before the router reads the address.
import './engine/take-pairing'
import '@fontsource-variable/inter'
import './assets/css/main.css'

import ui from '@nuxt/ui/vue-plugin'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).use(ui).mount('#app')
