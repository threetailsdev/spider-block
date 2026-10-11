# Store listing kit

Text and answers to paste into the Chrome Web Store, Firefox Add-ons (AMO), Edge Add-ons and App Store Connect. Images are in [screenshots/](screenshots/). They are spider-free: plain colour blocks stand in for photos.

## Name

Spider Block

## Short description (≤ 132 characters)

Hides pictures of spiders as you browse, for people with arachnophobia. Works privately on your device.

## Category

- Chrome: Accessibility (under "Make Chrome Yours"). Alternative: Well-being (under "Lifestyle").
- Edge: Accessibility (alternative: Productivity)
- Firefox: Privacy & Security, or Appearance

## Language

English. The listing is English only; the extension itself also recognises spider words in more than 40 languages.

## Links

- Homepage URL: <https://github.com/threetailsdev/spider-block>
- Support URL: <https://github.com/threetailsdev/spider-block/issues>
- Privacy policy URL: <https://github.com/threetailsdev/spider-block/blob/main/PRIVACY.md>

## Full description

Spider Block hides pictures of spiders while you browse, so you can use the web without the scare. It's made for people with arachnophobia.

**How it finds spiders**
• Reads the words around each picture (captions, alt text, file names, titles and links) in more than 40 languages, and knows that Spider-Man and spider plants aren't spiders.
• Looks at the picture itself with an image-recognition model built into the extension. Nothing is uploaded: images are checked on your device.
• Hides every image on pages that are about spiders, such as a search for spiders.

**Gentle by design**
• Images are held back until they've been checked, so you don't catch a glimpse first.
• Choose how hidden images look: a soft cover, a calming picture, blank space or a heavy blur.
• Clicking a hidden image asks before showing it. You can require a press-and-hold, or switch showing off completely.
• Press Alt+Shift+H to hide every image on a page instantly, and again to bring them back.
• Right-click to hide an image that slipped through, or to show one that isn't a spider. Spider Block remembers.
• Pause it, or turn it off for one site, from the toolbar.

**Private**
No accounts, no tracking, no data collection. Everything happens in your browser.

No filter is perfect. If a spider slips through, right-click it and choose "Hide this image".

## Screenshots

Chrome needs 1280×800 or 640×400. Firefox accepts any size. All five below are 1280×800, in upload order:

1. `page-cover.png`: a page with two spider photos hidden
2. `reveal-panel.png`: what happens when you click a hidden image
3. `store-popup.png`: the toolbar popup
4. `page-scene.png`: the "calming picture" style
5. `store-settings.png` (or `store-settings-dark.png`): settings

`popup.png`, `settings.png` and `settings-dark.png` are other sizes, for the README and Firefox.

Chrome small promo tile (440×280): `promo-440x280.png`. Store icon: `src/images/icon-128.png`.

## Permission justifications (Chrome Web Store "Privacy practices" tab)

**Single purpose**: Hide images of spiders on web pages for people with arachnophobia.

| Permission | Justification |
| --- | --- |
| Host permission `<all_urls>` | Spider pictures can appear on any website. The content script must run on every page to find and hide them before they are seen, and the background script must be able to download images from any site to check them with the on-device image-recognition model. |
| `storage` | Saves the user's settings (appearance, sensitivity, sites where it is off) and their corrections ("hide this image", "this isn't a spider"). |
| `contextMenus` | Adds right-click items to hide an image that was missed, mark an image as not a spider, or hide all images on the page. |
| `scripting` | Starts protection in tabs that were already open when the extension was installed or updated, without the user having to reload them. |
| Remote code | No. All code, including the WebAssembly runtime and the image-recognition model, is included in the package. `wasm-unsafe-eval` is only used to run the bundled WebAssembly. |

**Data usage**: the extension does not collect or transmit any user data. Tick none of the data types, and certify the three statements (no selling, no unrelated use, no creditworthiness use). "Website content" stays unticked too: the extension reads page text and images only to decide what to hide, on the device, and never sends them anywhere.

**Privacy policy URL**: <https://github.com/threetailsdev/spider-block/blob/main/PRIVACY.md>

## Test instructions (Chrome Web Store "Test instructions" tab)

No account or login is needed. Paste this:

```
No sign-in is required. After installing, open https://www.google.com/search?q=spider&udm=2 (Google Images search for "spider"). Every image on the page is hidden behind a soft cover, because the page is about spiders. Click a hidden image to see the "show this image?" prompt. The toolbar popup can pause Spider Block or turn it off for one site. Press Alt+Shift+H on any page to hide all images, and again to show them. The extension makes no network requests other than re-downloading images from the sites that show them, to check them with the bundled on-device model.
```

## Firefox (AMO) notes

- **Contributions URL**: in the listing's *Additional details*, set it to `https://ko-fi.com/threetailsdev`. AMO shows it as a "Support this developer" button.
- The manifest declares `data_collection_permissions: { required: ["none"] }`.
- **Source code**: the package contains unmodified, minified TensorFlow.js files from npm (`vendor/`), and two files generated by the build (`content/assets.js`, `content/content.css`). If the reviewer asks for source code, upload a zip of this repository and give these build instructions:

  ```
  Node.js 20+ and npm.
  npm ci
  npm run build:firefox
  Output: dist/firefox/ (identical to the submitted package)
  ```

  Third-party library sources: `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter`, `@tensorflow/tfjs-backend-wasm` and `@tensorflow/tfjs-backend-cpu`, all version 4.22.0 on npm.
- The model file (`model/`) can be reproduced with `node scripts/fetch-model.mjs`.

## Safari / App Store notes (future)

Safari is not supported yet. These notes are for if it is added later.

- Build and packaging steps are in [safari.md](safari.md). Bundle ID: `io.github.threetailsdev.spiderblock`.
- App icon: `docs/safari/app-icon-1024.png`.
- App Store review asks for an app description and screenshots of the containing app. The generated app only explains how to enable the extension, which is acceptable.
- Privacy "nutrition label": Data Not Collected.
