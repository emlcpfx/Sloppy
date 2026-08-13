<p align="center">
  <img src="packages/brand/assets/splat.svg" width="96" alt="Sloppy">
</p>

<h1 align="center">Sloppy</h1>

<p align="center">Hide AI slop and engagement bait on LinkedIn and Reddit.</p>

<p align="center">
  <a href="https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-chrome.zip"><strong>Chrome / Edge / Brave / Arc</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-firefox.zip"><strong>Firefox</strong></a>
</p>

<p align="center">Not in the stores yet. Unzip, load unpacked, done.</p>

Hover a post → green splat → pick a tag (`AI text`, `broetry`, `engagement bait`, …) → the post collapses to a one-line stub with **[show]**. Nothing is deleted.

Tags are local immediately. Sharing is on by default so other people can hide the same posts. Turn it off in Settings and nothing leaves your machine. What sharing sends: post id, author id, tag, a fingerprint of the text. Not the text. Details: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Install

Unzip the download. You need the folder (the one with `manifest.json`), not the `.zip`.

**Chrome, Edge, Brave, Arc, Opera**

1. `chrome://extensions` (Edge: `edge://extensions`)
2. Developer mode on
3. **Load unpacked** → that folder
4. Pin it from the puzzle-piece menu
5. Open LinkedIn or Reddit and hover a post

**Firefox**

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → `manifest.json` in the unzipped folder

Firefox drops unsigned add-ons on restart. Reload from the same screen, or wait until this is on [AMO](https://addons.mozilla.org/).

If a zip 404s, grab it from [Releases](https://github.com/emlcpfx/Sloppy/releases/latest).

## Build from source

Node 22.6+ and [pnpm](https://pnpm.io/installation) 10 (`corepack enable`).

```bash
git clone https://github.com/emlcpfx/Sloppy.git
cd Sloppy
pnpm install
pnpm build        # Chrome → apps/extension/.output/chrome-mv3
```

Load unpacked on `chrome-mv3`.

| | |
|---|---|
| `pnpm build:all` | Chrome, Firefox, Edge |
| `pnpm --filter @sloppy/extension zip` | Release zips |
| `pnpm dev` | Live-reload Chrome |
| `pnpm check` | Tests |

## Licence

MIT.
