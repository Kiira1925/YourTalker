import type { YourTalkerApi } from '../../shared/types'

declare global {
  interface Window {
    yourTalker: YourTalkerApi
  }
}

export {}
