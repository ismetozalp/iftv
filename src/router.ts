import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/home/HomeView.vue') },
  { path: '/accounts', name: 'accounts', component: () => import('./views/accounts/AccountsView.vue') },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
