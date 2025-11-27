# Firefox Add-ons Submission Guide

This document provides instructions for submitting the Twitter Account Location Flag extension to Firefox Add-ons (AMO).

## Package Information

- **Extension Name**: Twitter Account Location Flag
- **Version**: 1.2.0
- **Extension ID**: twitter-location-flag@example.com
- **Minimum Firefox Version**: 109.0
- **Manifest Version**: 3

## Building the Distribution Package

1. Run the build script:
   ```powershell
   .\build-firefox.ps1
   ```

2. The package will be created at:
   ```
   dist/twitter-location-flag-firefox-1.2.0.zip
   ```

3. Package contents:
   - manifest.json
   - content.js
   - pageScript.js
   - countryFlags.js
   - popup.html
   - popup.js
   - README.md

## Testing Before Submission

### Automated Testing

Run the test script to validate the package:
```powershell
.\test-firefox-package.ps1
```

This will verify:
- All required files are included
- No development files are included
- Manifest.json is valid
- Firefox-specific settings are present
- Browser API compatibility layer is present

### Manual Testing in Firefox

1. Open Firefox
2. Navigate to: `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Navigate to `dist/test-extraction/` (created by test script)
5. Select `manifest.json`

Test the following functionality:
- [ ] Extension loads without errors
- [ ] Navigate to Twitter/X (https://x.com or https://twitter.com)
- [ ] Flags appear next to usernames automatically
- [ ] Click extension icon to open popup
- [ ] Toggle extension on/off works
- [ ] Switch between auto and manual modes
- [ ] Cache persists across page reloads
- [ ] No console errors

## Submission Process

### 1. Create AMO Account

1. Go to https://addons.mozilla.org/developers/
2. Sign in or create a Firefox Account
3. Accept the Developer Agreement

### 2. Submit Extension

1. Click "Submit a New Add-on"
2. Choose "On this site" (for AMO distribution)
3. Upload `dist/twitter-location-flag-firefox-1.2.0.zip`
4. Fill in the submission form:

#### Basic Information
- **Name**: Twitter Account Location Flag
- **Summary**: Shows country flag emoji next to Twitter usernames based on account location. Choose between automatic display or manual on-demand mode.
- **Description**: 
  ```
  This extension displays country flag indicators next to Twitter/X usernames, showing account location information in a bracketed format.

  Features:
  - Automatically detects usernames on Twitter/X pages
  - Queries Twitter's GraphQL API to get account location information
  - Displays country flags and status indicators
  - Works with dynamically loaded content (infinite scroll)
  - Caches location data for 30 days to minimize API calls
  - Toggle on/off via popup interface
  - Choose between automatic or manual display modes

  The extension uses Twitter's public API and requires you to be logged into Twitter/X.
  ```

#### Categories
- Social & Communication
- Privacy & Security (optional)

#### Tags
- twitter
- x
- location
- flags
- privacy

#### Support Information
- **Support Email**: [Your email]
- **Support Website**: [GitHub repository URL]

#### Privacy Policy
```
This extension does not collect, store, or transmit any personal data to third-party servers.

Data Handling:
- Location data is queried directly from Twitter's public API
- All API requests are made directly to Twitter/X servers using your existing authentication
- Location data is cached locally in your browser storage only
- No data is sent to the extension developer or any third parties
- The extension only accesses Twitter/X pages (https://x.com/*, https://twitter.com/*)

Permissions:
- activeTab: Required to access the current Twitter/X tab
- storage: Required to cache location data locally
- tabs: Required for communication between extension components
- Host permissions (x.com, twitter.com): Required to run on Twitter/X pages
```

#### License
- MIT License (or your preferred license)

### 3. Technical Details

#### Why does this extension need the requested permissions?

```
- activeTab: Required to access and modify the current Twitter/X tab to display flag indicators
- storage: Required to cache location data locally for 30 days to improve performance and reduce API calls
- tabs: Required for message passing between the popup and content scripts
- Host permissions (https://x.com/*, https://twitter.com/*): Required to run the content script on Twitter/X pages and make authenticated API requests
```

#### Does this extension use remote code?

No. All code is included in the extension package.

#### Does this extension collect user data?

No. The extension does not collect, store, or transmit any user data to third-party servers. All data is processed locally and API requests are made directly to Twitter/X.

### 4. Source Code (if required)

If Mozilla requests source code review:

1. The extension does not use any build process
2. All source files are included in the distribution package
3. No minification or obfuscation is used
4. The code is identical to what's in the package

You can provide the GitHub repository URL as the source code location.

### 5. Review Process

- **Automated Review**: Usually completes within minutes
- **Manual Review**: May take 1-7 days for first submission
- **Updates**: Faster review for subsequent versions

Mozilla will check:
- Code quality and security
- Privacy compliance
- Manifest validity
- Functionality testing

## Post-Submission

### If Approved
1. Extension will be published on AMO
2. Users can install from: https://addons.mozilla.org/firefox/addon/[your-addon-slug]/
3. Updates can be submitted through the developer dashboard

### If Rejected
1. Review the rejection reason carefully
2. Make necessary changes
3. Resubmit with explanation of changes

## Updating the Extension

For future updates:

1. Update version in `manifest.json`
2. Run `.\build-firefox.ps1` to create new package
3. Test with `.\test-firefox-package.ps1`
4. Submit update through AMO developer dashboard
5. Provide changelog describing changes

## Important Notes

### Extension ID

The extension ID in manifest.json is currently:
```json
"id": "twitter-location-flag@example.com"
```

**Before submitting to AMO**, you should:
1. Change this to a unique ID (use your domain or a UUID)
2. Format: `{extension-name}@{your-domain}.com` or `{uuid}`
3. This ID is permanent and cannot be changed after first submission

### API Endpoint

The extension uses Twitter's GraphQL API endpoint:
```
https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery
```

Note: This endpoint may change if Twitter updates their API. Monitor for any API changes that might affect functionality.

### Rate Limiting

The extension implements rate limiting:
- Minimum 2 seconds between requests
- Maximum 2 concurrent requests
- Automatic pause when rate limited
- Respects Twitter's rate limit headers

This should prevent most rate limiting issues, but users with very active browsing may occasionally hit limits.

## Support and Maintenance

After publication:
1. Monitor user reviews and feedback
2. Respond to support requests
3. Fix bugs promptly
4. Submit updates as needed
5. Keep extension compatible with Twitter/X changes

## Resources

- **AMO Developer Hub**: https://addons.mozilla.org/developers/
- **Extension Workshop**: https://extensionworkshop.com/
- **Manifest V3 Guide**: https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
- **Review Policies**: https://extensionworkshop.com/documentation/publish/add-on-policies/
- **WebExtensions API**: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions

## Contact

For questions about this extension:
- GitHub Issues: [Your repository URL]
- Email: [Your email]
