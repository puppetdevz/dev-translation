import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/translate',
    name: 'translate',
    component: () => import('./Translate/index.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./Settings/index.vue'),
  },
  {
    path: '/',
    redirect: '/translate',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
