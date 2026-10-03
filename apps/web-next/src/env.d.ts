/// <reference types="vite/client" />

// For the plain TypeScript check; vue-tsc knows the real types of every component.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, unknown>
  export default component
}
