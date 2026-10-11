# Spider Block privacy policy

_Last updated: October 2026_

Spider Block hides pictures of spiders in your web browser. It was built so that it never needs to know anything about you.

## What Spider Block collects

Nothing. Spider Block has no servers, no accounts, no analytics and no advertising. It does not collect, transmit, sell or share any personal data, browsing history or images.

## What stays on your device

- **Your settings** (for example how hidden images look, and sites where Spider Block is turned off). They are kept in your browser's extension storage. If your browser syncs extension settings between your devices (for example when you are signed in to Firefox or Chrome sync), your browser syncs them. Spider Block never sees that data leave your device.
- **Your corrections**: the addresses of images you chose to hide or to always show. They are kept in your browser's local extension storage on that device only, and you can erase them at any time in Spider Block's settings ("Forget my corrections").

## How images are checked

To decide whether an image shows a spider, Spider Block:

1. reads the text around the image on the page (alt text, captions, file name, titles), and
2. downloads the image again from the address the page uses, and analyses it with an image-recognition model that is built into the extension and runs on your device.

The second step is the same kind of request your browser already made to display the image. It goes directly to the website that hosts the image, and no other party is involved. The image and the result of the analysis are not sent anywhere.

## Permissions

- **Read and change data on all websites**: needed to find and hide spider images on the pages you visit, and to download images for the on-device check.
- **Storage**: to remember your settings and corrections.
- **Context menus**: for "Hide this image" and "This isn't a spider".
- **Scripting** (Chrome, Edge and Safari): to start protecting tabs that were already open when Spider Block was installed or updated.

## Contact

Questions or concerns: please open an issue at <https://github.com/threetailsdev/spider-block/issues>.
