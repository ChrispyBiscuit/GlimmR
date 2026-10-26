import type { Api, Bridge } from '../../shared/api'

declare global {
  interface Window {
    glimmr: Bridge
  }
}

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

/** Typed client for the main-process API: `await api.search(...)`. */
export const api = new Proxy({} as Async<Api>, {
  get: (_t, method: string) => (...args: unknown[]) => (window.glimmr.call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args)
}) as Async<Api>

export const bridge = (): Bridge => window.glimmr

export const thumbUrl = (id: number, v = 0): string => `glimmr://thumb/${id}?v=${v}`
export const previewUrl = (id: number, v = 0): string => `glimmr://preview/${id}?v=${v}`
export const originalUrl = (id: number, v = 0): string => `glimmr://original/${id}?v=${v}`
