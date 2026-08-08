import { defineContentScript } from 'wxt/utils/define-content-script';
import { linkedinAdapter } from '@sloppy/adapters';
import { runAdapter } from '../src/injector.ts';

export default defineContentScript({
  matches: ['*://*.linkedin.com/*'],
  // The feed is client-rendered, so there is nothing to observe at
  // document_start. The injector retries until the container exists anyway.
  runAt: 'document_idle',
  main() {
    runAdapter(linkedinAdapter);
  },
});
