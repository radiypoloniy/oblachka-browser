import type { OblakoApi } from '../shared/ipc';

declare global {
  interface Window {
    oblako: OblakoApi;
  }
}

export {};
