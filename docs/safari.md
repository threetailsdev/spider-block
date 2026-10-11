# Safari (not supported yet)

**Spider Block does not support Safari at the moment.** It may be added in the future. This page keeps the notes for that: what is already in place, what to check the first time it runs, and how to get it onto the App Store. The Safari build has never been run in Safari.

Everything needs the [Apple Developer Program](https://developer.apple.com/programs/enroll/) ($99/year) except running it on your own Mac from Xcode.

## What the repo already does for Safari

- `npm run build:safari` (not part of the default `npm run build`) makes `dist/safari/` and `dist/spider-block-safari-<version>.zip`, with a Safari manifest: a non-persistent background page instead of a service worker (Safari on iPhone and iPad requires that), and Safari 16.4 as the minimum.
- The welcome page and toolbar popup recognise Safari and explain where to allow the extension on all websites, because Safari grants website access in its settings rather than through a prompt.
- APIs Safari lacks are optional in the code (badge text colour, keyboard shortcuts and the right-click menu on iPhone and iPad).
- `docs/safari/app-icon-1024.png` is the 1024x1024 app icon the App Store requires (opaque, as Apple wants). `npm run icons` regenerates it.

**Bundle ID:** use `io.github.threetailsdev.spiderblock` (the same domain as the Firefox ID). The extension inside the app gets `io.github.threetailsdev.spiderblock.Extension`. A bundle ID can't be changed once an app uses it in App Store Connect.

## Route A: no Mac needed (App Store Connect)

Apple can now package a web extension in the browser. See [Packaging and distributing Safari Web Extensions with App Store Connect](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect).

1. Join the Apple Developer Program.
2. Run `npm run build:safari`.
3. In [App Store Connect](https://appstoreconnect.apple.com/), go to **Apps → + → New App**. Choose macOS, iOS or both, name it "Spider Block", and use the bundle ID above.
4. Open the app's **Xcode Cloud** tab and, under **Safari Web Extension Packager**, upload `dist/spider-block-safari-<version>.zip`. Packaging time comes out of the 25 free Xcode Cloud hours a month. Some developers on Apple's forums report the upload option missing from their account; if that happens, Route B works instead.
5. Read any warnings it reports on the **Builds** page.
6. Install the build with **TestFlight** on an iPhone, iPad or Mac and work through the test list below.
7. Fill in the store listing and submit (see "Submitting" below).

## Route B: on a Mac with Xcode

Use this to test before paying, or to debug with Safari's Web Inspector.

```sh
npm install
npm run build:safari
xcrun safari-web-extension-packager dist/safari \
  --app-name "Spider Block" \
  --bundle-identifier io.github.threetailsdev.spiderblock \
  --swift --project-location ../spider-block-safari
```

(Older Xcode versions call the tool `safari-web-extension-converter`, with the same options.)

- It prints any manifest keys Safari doesn't support. `match_about_blank` and `commands` may appear; neither is essential.
- The Xcode project points at `dist/safari/` rather than copying it, so after a code change run `npm run build:safari` again and rebuild in Xcode.
- Keep the generated project out of this repo (the command above puts it next to it). It can be added later if it gets native changes.

To run it on your Mac:

1. In Xcode, choose the **Spider Block (macOS)** scheme and press Run. A small app opens.
2. In Safari, open **Settings → Advanced** and turn on **Show features for web developers**.
3. In **Settings → Developer**, turn on **Allow unsigned extensions**. Safari turns this off every time it quits.
4. In **Settings → Extensions**, enable Spider Block, click **Edit Websites** and set **Other Websites** to **Allow**.

For an iPhone or iPad, choose the iOS scheme with the device plugged in (needs a free or paid Apple account set as the Team under **Signing & Capabilities**), then enable it in the Settings app under **Apps → Safari → Extensions**.

To debug, Safari's **Develop** menu lists Spider Block's background page; opening it shows its console, where scanning errors appear.

## What to test first

These are the parts most likely to behave differently in Safari:

- [ ] **The image engine.** Open Spider Block's settings and look for the status line. "Status: ready." means the fast WebAssembly engine runs. "ready (slower mode…)" means Safari refused WebAssembly under the extension's security policy: it still works, just more slowly. "not available" is a real failure; note the error it shows.
- [ ] **Spider images get hidden** on a page with spider photos (`test/manual/safe-test.html` uses harmless stand-ins).
- [ ] **Images from other sites** are scanned. The background page downloads them, which needs the website access from step 4 above.
- [ ] **Already-open tabs** start being protected after install without a reload.
- [ ] **The badge count**, the grey icon while paused, and that it turns green again when the pause ends.
- [ ] **The right-click menu** (Mac) and the **Alt+Shift+H** shortcut, which is Option+Shift+H on a Mac.
- [ ] **Settings sync**: change a setting, quit Safari, reopen it.
- [ ] **iPhone and iPad**: the popup fits the screen, and scanning works after Safari has been in the background for a while. iOS limits how much memory an extension may use, and the model alone is about 7 MB before it is loaded.

Report what breaks and it can be fixed in the shared code.

## Submitting

App Store Connect asks for:

- **App icon**: `docs/safari/app-icon-1024.png` (Route B: drag it into the app target's `AppIcon` in `Assets.xcassets`).
- **Screenshots**: for a Mac app, 1280x800 works, so `docs/screenshots/store-*.png` can be reused. For iOS, iPhone screenshots (for example 1290x2796) and, if iPad is included, iPad ones (2064x2752) must be taken on a device or simulator.
- **Description and keywords**: reuse [store-listing.md](store-listing.md).
- **Privacy policy URL**: <https://github.com/threetailsdev/spider-block/blob/main/PRIVACY.md>.
- **Support URL**: <https://github.com/threetailsdev/spider-block/issues>.
- **App Privacy**: Data Not Collected.
- **Category**: Utilities. **Price**: Free. **Age rating**: no objectionable content (4+).
- **Review notes**: say it is a Safari extension, that the app only explains how to turn it on, and how to enable it.

Bump `version` in `package.json` before each upload. App Store Connect rejects a build whose version and build number were already used.
