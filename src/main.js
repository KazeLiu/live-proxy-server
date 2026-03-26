import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import './style.css'
import App from './App.vue'
import SettingsPage from './pages/SettingsPage.vue'
import M3uPage from './pages/M3uPage.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/m3u' },
    { path: '/settings', component: SettingsPage },
    { path: '/m3u', component: M3uPage }
  ]
});

createApp(App).use(router).mount('#app')
