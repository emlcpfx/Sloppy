import { defineConfig } from 'wxt';

/**
 * One config, every target. WXT owns the browser axis; the SiteAdapter owns the
 * site axis. Neither knows about the other.
 *
 * NOTE the absence of `declarativeNetRequest`. Firefox lands on MV2 and DNR
 * support diverges across targets, so all filtering happens in the content
 * script - one code path everywhere, at the cost of nothing that matters here.
 */
export default defineConfig({
  manifest: {
    name: 'Sloppy',
    short_name: 'Sloppy',
    description: 'Community-tagged feed filtering. Collapse the slop, keep the feed.',
    // Only what is actually used. Every extra permission is a review question
    // and a scarier install prompt.
    permissions: ['storage', 'alarms'],
    host_permissions: ['*://*.linkedin.com/*', '*://*.reddit.com/*'],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
    action: {
      default_title: 'Sloppy',
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
      },
    },
    browser_specific_settings: {
      gecko: {
        // AMO requires a stable id, and storage.sync needs one on some versions.
        id: 'sloppy@cleanplatefx.com',
        strict_min_version: '115.0',
        // Required for new AMO listings since Nov 2025. Sharing is off by
        // default and nothing leaves the device until the user opts in via
        // Settings, which is our own toggle, not Firefox's consent sheet.
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  // The splat is inlined into the content script, so nothing needs to be web
  // accessible - which also means no page on the internet can probe for us by
  // requesting a known resource URL.
  webExt: {
    startUrls: ['https://www.linkedin.com/feed/'],
  },
});
