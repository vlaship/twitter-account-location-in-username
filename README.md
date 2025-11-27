# Twitter Account Location Flag Browser Extension

A cross-browser extension for Chrome and Firefox that displays country flag emojis next to Twitter/X usernames based on the account's location information.

## Features

- **Cross-browser support**: Works identically in Chrome and Firefox
- **Automatic detection**: Scans Twitter/X pages for usernames in tweets, profiles, and user cells
- **Location display**: Shows country flags and status indicators in a bracketed format
- **Two display modes**:
  - **Auto mode**: Automatically fetches and displays flags for all visible usernames
  - **Manual mode**: Shows a button next to usernames; click to reveal the flag
- **Smart caching**: Stores location data for 30 days to minimize API calls
- **Rate limiting**: Automatically handles Twitter's API rate limits
- **Dynamic content**: Works with infinite scroll and dynamically loaded content
- **Toggle control**: Enable/disable the extension via popup interface
- **Privacy-focused**: All data stored locally; no third-party servers

## Installation

### From Browser Stores (Recommended)

#### Chrome Web Store
*Coming soon - Extension pending review*

Once published, you can install directly from the [Chrome Web Store](https://chrome.google.com/webstore).

#### Firefox Add-ons (AMO)
*Coming soon - Extension pending review*

Once published, you can install directly from [Firefox Add-ons](https://addons.mozilla.org).

### Manual Installation (Development)

#### Chrome

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the directory containing this extension
6. The extension will now be active on Twitter/X pages

#### Firefox

**Option 1: Temporary Add-on (Quick Testing)**
1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Navigate to the extension directory and select `manifest.json`
5. The extension will now be active on Twitter/X pages

**Note:** Temporary add-ons are removed when Firefox restarts. This is intended for development and testing only.

**Option 2: Distribution Package (Persistent Installation)**
1. Run `.\build-firefox.ps1` to create the distribution package
2. The package will be created at `dist/twitter-location-flag-firefox-1.2.0.zip`
3. Open Firefox and navigate to `about:addons`
4. Click the gear icon (⚙️) and select "Install Add-on From File..."
5. Select the `.zip` file created in step 2
6. Confirm the installation when prompted

**Note:** Firefox may require the extension to be signed for permanent installation. For development, use `about:config` and set `xpinstall.signatures.required` to `false`, or use Firefox Developer Edition/Nightly.

#### For Developers: Publishing to Stores

**Chrome Web Store:**
1. Create a zip file of the extension
2. Visit [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Upload the zip file and submit for review

**Firefox Add-ons (AMO):**
1. Run `.\build-firefox.ps1` to create the distribution package
2. Visit [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/)
3. Upload the zip file and submit for review
4. Firefox performs additional security review before publication

## Browser Compatibility

This extension is fully compatible with both Chrome and Firefox using a single codebase:

- **Chrome**: Manifest V3 (Chrome 88+)
- **Firefox**: Manifest V3 (Firefox 109+)

### Cross-Browser Implementation

The extension uses the WebExtensions API standard with a compatibility layer that automatically detects and uses the appropriate browser namespace:
- Firefox: `browser.*` namespace (native promise-based APIs)
- Chrome: `chrome.*` namespace (Manifest V3 promise support)

All features work identically across both browsers with no functional differences.

### Browser-Specific Technical Details

**Firefox:**
- Uses native promise-based APIs (`browser.storage.local.get()` returns a Promise)
- Requires `browser_specific_settings.gecko` section in manifest.json for extension ID
- Temporary add-ons (loaded via `about:debugging`) are removed on browser restart
- No storage quota limit by default (Chrome has 10MB limit)
- May have slightly faster promise resolution for extension APIs

**Chrome:**
- Supports both callback and promise-based APIs in Manifest V3
- Uses `chrome.*` namespace with built-in promise support
- Storage API has 10MB quota for `local` storage
- Persistent installation from unpacked extensions in developer mode

### Verified Compatibility

The following features have been tested and verified to work identically in both browsers:
- ✅ Username detection and DOM manipulation
- ✅ Location data fetching via Twitter GraphQL API
- ✅ Country flag display and formatting
- ✅ Cache storage and retrieval (30-day expiry)
- ✅ Rate limiting and request queue management
- ✅ Extension toggle functionality
- ✅ Auto/Manual display modes
- ✅ Dynamic content detection (MutationObserver)
- ✅ Page script injection and communication
- ✅ Error handling and context validation

### Known Browser Differences

**None** - The extension behaves identically in both browsers. Any differences in behavior should be reported as bugs.

## Display Format

The extension shows location information in a bracketed format with three components:

```
[Account Flag | Status Icon | Source Flag]
```

### Components

1. **Account Flag** (left): Country where the account is registered
2. **Status Icon** (center): Indicates location accuracy or VPN detection
   - ✅ Accurate location
   - 🛡️ VPN/Proxy detected (account location differs from source)
   - ℹ️ Location marked as inaccurate
   - • Unknown/unavailable data
3. **Source Flag** (right): Country where account activity originates

### Examples

- `[🇺🇸 | ✅ | 🇺🇸]` - US account, accurate location, US source
- `[🇬🇧 | 🛡️ | 🇺🇸]` - UK account with VPN detected, US source
- `[🇨🇦 | ℹ️ | 🇨🇦]` - Canada account with accuracy disclaimer
- `[• | ℹ️ | 🇩🇪]` - Unknown account location, Germany source

## How It Works

1. **Content Script Injection**: The extension runs a content script on all Twitter/X pages
2. **Username Detection**: Identifies username elements in tweets, profiles, and user cells
3. **API Query**: For each username, queries Twitter's GraphQL API (`AboutAccountQuery`) to get location data
4. **Data Processing**: Extracts account location, source location, and accuracy information
5. **Flag Mapping**: Maps country names to flag emojis using the country flags database
6. **Display**: Shows the bracketed format next to the username
7. **Caching**: Stores results for 30 days to minimize future API calls

### Display Modes

**Auto Mode** (default):
- Automatically fetches and displays flags for all visible usernames
- Best for browsing and discovering account locations

**Manual Mode**:
- Shows a "🌍 Show Location" button next to each username
- Click the button to fetch and display the flag
- Useful for selective viewing and reducing API calls

## Files

- `manifest.json` - Chrome extension configuration
- `content.js` - Main content script that processes the page and injects page scripts for API calls
- `countryFlags.js` - Country name to flag emoji mapping
- `README.md` - This file

## Technical Details

The extension uses a page script injection approach to make API requests. This allows it to:
- Access the same cookies and authentication as the logged-in user
- Make same-origin requests to Twitter's API without CORS issues
- Work seamlessly with Twitter's authentication system

The content script injects a script into the page context that listens for location fetch requests. When a username is detected, the content script sends a custom event to the page script, which makes the API request and returns the location data.

## API Endpoint

The extension uses Twitter's GraphQL API endpoint:
```
https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery
```

With variables:
```json
{
  "screenName": "username"
}
```

The response contains `account_based_in` field in:
```
data.user_result_by_screen_name.result.about_profile.account_based_in
```

## Limitations

- Requires the user to be logged into Twitter/X
- Only works for accounts that have location information available
- Country names must match the mapping in `countryFlags.js` (case-insensitive)
- Rate limiting may apply if making too many requests

## Privacy

- The extension only queries public account information
- No data is stored or transmitted to third-party servers
- All API requests are made directly to Twitter/X servers
- Location data is cached locally in memory

## Troubleshooting

### Flags Not Appearing

If flags are not appearing:
1. Make sure you're logged into Twitter/X
2. Check the browser console for any error messages (F12 → Console tab)
3. Verify that the account has location information available
4. Try refreshing the page
5. Check if the extension is enabled (click the extension icon)
6. Verify the extension has permissions for the current site

### Firefox-Specific Issues

**Temporary Add-on Disappeared:**
- Temporary add-ons are removed when Firefox restarts
- Use the distribution package method for persistent installation
- Or use Firefox Developer Edition with signing disabled

**Extension Not Loading:**
- Ensure you're using Firefox 109 or later
- Check `about:debugging` for error messages
- Verify manifest.json is valid

**Signature Required Error:**
- Firefox requires signed extensions for permanent installation
- For development: Use Firefox Developer Edition or Nightly
- Or disable signature requirement: `about:config` → `xpinstall.signatures.required` → `false`

### Chrome-Specific Issues

**Storage Quota Exceeded:**
- Chrome has a 10MB limit for local storage
- Clear the cache by disabling and re-enabling the extension
- Or manually clear storage in DevTools

**Extension Context Invalidated:**
- This occurs when the extension is reloaded
- Simply refresh the Twitter/X page to reinitialize

### General Issues

**Rate Limiting:**
- Twitter may rate limit API requests
- The extension automatically handles this and will resume after the reset time
- Wait time is logged in the browser console

**Performance:**
- If the page feels slow, try disabling the extension temporarily
- Check if you have a large cache (visible in DevTools → Application → Storage)
- Consider clearing the cache periodically

## License

MIT

