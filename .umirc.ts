import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  // layout: {
  //   title: '一席',
  // },
  routes: [
    {
      path: '/',
      redirect: '/whiteboard/home',
    },
    {
      name: '首页',
      path: '/whiteboard/home',
      component: './Home',
    },
    {
      name: '首页',
      path: '/whiteboard/detail',
      component: './Detail',
    },
  ],
  npmClient: 'pnpm',
});
