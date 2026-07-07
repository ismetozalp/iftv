// `__IFTV_VERSION__` is replaced at build time by Vite (from the repo-root VERSION file).
// Falls back to '' where it isn't defined (e.g. bare unit tests without the stub).
export const APP_VERSION: string = typeof __IFTV_VERSION__ === 'string' ? __IFTV_VERSION__ : ''
