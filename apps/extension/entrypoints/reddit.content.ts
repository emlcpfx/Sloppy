import { defineContentScript } from 'wxt/utils/define-content-script';
import { redditAdapter } from '@sloppy/adapters';
import { runAdapter } from '../src/injector.ts';

export default defineContentScript({
  // Covers new Reddit and old.reddit - one adapter, two branches.
  matches: ['*://*.reddit.com/*'],
  runAt: 'document_idle',
  main() {
    runAdapter(redditAdapter);
  },
});
