<p align="center">
  <img src="packages/brand/assets/splat.svg" width="120" alt="Sloppy">
</p>

<h1 align="center">Sloppy</h1>

<p align="center">
  Hide the generated sludge in your LinkedIn and Reddit feeds.<br>
  You click the splat. The post collapses. Nothing is deleted.
</p>

<p align="center">
  <a href="https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-chrome.zip"><strong>Chrome · Edge · Brave · Arc</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-firefox.zip"><strong>Firefox</strong></a>
</p>

<p align="center">
  <sub>Not in the stores yet — two minutes, one unzip, done. Safari later.</sub>
</p>

## Why

Feeds used to be people. A lot of them are now a language model doing LinkedIn voice, or the same three images with a different prompt. You can scroll past that, or you can mark it once and stop seeing it.

Sloppy is that mark. It is a filter you operate, not a model that guesses what you should like. Tags describe **form** — AI text, broetry, engagement bait — never whether you agree with the post. Agreement is a weapon; style is a fingerprint.

Your own tags hide the post **for you**, immediately. Sharing is on by default so other people can collapse the same posts. Turn it off in Settings and nothing leaves the machine.

## How it works

1. Open LinkedIn or Reddit.
2. Hover a post. A green splat appears on the corner.
3. Click it. Pick a reason (`AI text`, `broetry`, `engagement bait`, …).
4. The post collapses to a one-line stub with **[show]**. The post is still there. Undo is one click.
5. That tag is stored locally. The next time the same post shows up, it is already gone.

That is the whole loop. Sharing uploads the tag (post id, author id, a fingerprint of the text — not the text) so other people can benefit. Consensus is per-site on purpose: LinkedIn feeds barely overlap, so one tag is enough to propagate; Reddit waits for three, because one person should not own a thread.

You can always see what was hidden. You can always put it back.

Privacy, in full: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Install

Pick your browser. You need the unzipped folder, not the zip itself — Chrome and friends will not load a `.zip`.

### Chrome, Edge, Brave, Arc, Opera

1. Download **[sloppy-chrome.zip](https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-chrome.zip)** and unzip it. You should see a `manifest.json` inside.
2. Open the extensions page:
   - Chrome / Brave / Arc / Opera → `chrome://extensions`
   - Edge → `edge://extensions`
3. Turn **Developer mode** on (toggle at the top).
4. Click **Load unpacked** and select the unzipped folder.
5. Pin Sloppy from the puzzle-piece menu so the popup is one click away.
6. Open [linkedin.com/feed](https://www.linkedin.com/feed/) or [reddit.com](https://www.reddit.com/). Hover a post.

### Firefox

1. Download **[sloppy-firefox.zip](https://github.com/emlcpfx/Sloppy/releases/latest/download/sloppy-firefox.zip)** and unzip it.
2. Paste `about:debugging#/runtime/this-firefox` into the address bar.
3. **This Firefox** → **Load Temporary Add-on…** → pick `manifest.json` in the unzipped folder.
4. Open LinkedIn or Reddit and hover a post.

Firefox will drop a temporary add-on when the browser restarts. That is Firefox, not Sloppy — unsigned extensions cannot stay installed until this is on [AMO](https://addons.mozilla.org/). Reload it from the same screen after a restart, or build from source below and keep using `about:debugging`.

### If a download 404s

Grab `sloppy-chrome.zip` or `sloppy-firefox.zip` from [Releases](https://github.com/emlcpfx/Sloppy/releases/latest), or [build from source](#build-from-source).

## Build from source

Needs Node 22.6+ and [pnpm](https://pnpm.io/installation) 10 (`corepack enable` is enough).

```bash
git clone https://github.com/emlcpfx/Sloppy.git
cd Sloppy
pnpm install
pnpm build        # Chrome → apps/extension/.output/chrome-mv3
```

Then Load unpacked on that `chrome-mv3` folder, same as above.

| | |
|---|---|
| `pnpm build:all` | Chrome, Firefox, and Edge |
| `pnpm --filter @sloppy/extension zip` | Store-shaped zips, plus the AMO sources bundle |
| `pnpm dev` | Live-reloading Chrome |
| `pnpm dev:firefox` | Same, Firefox |
| `pnpm check` | Typecheck, unit tests, ruleset gate |

The Worker in `apps/api` is the shared list. Sharing is on by default; turn it
off in Settings and nothing leaves the machine.

## Licence

MIT.
