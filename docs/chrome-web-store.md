# Publishing to the Chrome Web Store

A step-by-step checklist for the first Chrome Web Store release. Everything to paste comes from [store-listing.md](store-listing.md) (the "listing kit"). The dashboard's wording changes from time to time, so follow the field names below loosely.

## 1. Developer account (one time)

1. **Pick the Google account that will own the listing.** Use a dedicated one (for example a new Gmail for threetailsdev) rather than your personal account: its address is what Google contacts about reviews and takedowns, and moving an item to a different account later is not straightforward. If more people will manage it one day, you can later link a Google Group as a "group publisher".
2. **Turn on 2-Step Verification** for that account. The dashboard requires it.
3. Go to <https://chrome.google.com/webstore/devconsole>, sign in, accept the developer agreement, and **pay the one-time $5 registration fee**.
4. In **Account**:
   - **Publisher name**: what users see as the author, for example `threetailsdev`.
   - **Contact email**: enter it and click the verification link Google emails you. You can't publish until it's verified. This is the address Google writes to; use one you'll actually read.
   - **Trader / non-trader declaration** (EU Digital Services Act): Spider Block is free, so "non-trader" fits if this is a personal project. If you declare yourself a trader, your address and phone number are shown publicly on the listing. A tip jar alone doesn't usually make you a trader, but it's your call.

## 2. Build the package

```
npm ci
npm run build:chrome
```

Upload `dist/spider-block-chrome-1.0.0.zip`. Before submitting, do your two remaining checks: `npm run test:ai`, and a fresh install of that zip's folder in Chrome (chrome://extensions → Developer mode → Load unpacked → `dist/chrome`).

## 3. Create the item

Dashboard → **Add new item** → upload the zip. Then fill in each tab on the left.

### Store listing tab

| Field | What to enter |
| --- | --- |
| Description | "Full description" from the kit. (The 132-character summary is taken from the manifest automatically.) |
| Category | Accessibility (alternative: Well-being) |
| Language | English |
| Store icon | `src/images/icon-128.png` |
| Screenshots | The five 1280×800 files from `docs/screenshots/`, in the kit's order |
| Small promo tile | `docs/screenshots/promo-440x280.png` |
| Marquee promo tile, promo video | Leave empty (optional) |
| Official URL | Leave empty (it needs a site verified in Search Console) |
| Homepage URL | <https://github.com/threetailsdev/spider-block> |
| Support URL | <https://github.com/threetailsdev/spider-block/issues> |
| Mature content | No |

### Privacy tab

| Field | What to enter |
| --- | --- |
| Single purpose | "Single purpose" from the kit |
| Justification for `storage`, `contextMenus`, `scripting` | The matching rows of the kit's permission table |
| Host permission justification | The `<all_urls>` row of the kit |
| Are you using remote code? | **No** (the kit's "Remote code" row explains why, if asked) |
| Data usage | Tick **none** of the data types, then tick all three certifications |
| Privacy policy URL | <https://github.com/threetailsdev/spider-block/blob/main/PRIVACY.md> |

### Distribution tab

- **Payments**: Free.
- **Visibility**: Public. (Choose Unlisted if you want a soft launch where only people with the link can install it.)
- **Regions**: All regions.

### Test instructions tab

Paste the block under "Test instructions" in the kit. No test account is needed.

## 4. Submit

Click **Submit for review**. In the dialog you can untick **"Publish automatically after review"** if you'd rather press Publish yourself once it's approved (you then have 30 days to do so).

Expect a longer review than usual. `<all_urls>` is a broad host permission, so the dashboard warns that the item needs an **in-depth review**. That's normal for this kind of extension and the justifications in the kit are written for it. Clear, specific justifications are what reviewers look for; if they reject something, the email names the policy, and you can fix and resubmit.

## 5. After approval

- The listing URL looks like `https://chromewebstore.google.com/detail/spider-block/<id>`. Add it to the README's install section.
- The same Chrome zip can go to the Edge Add-ons store (free) with the same texts.
- For updates: bump `version` in `package.json`, rebuild, and upload the new zip on the item's **Package** tab. Updates with no new permissions are usually reviewed faster.
