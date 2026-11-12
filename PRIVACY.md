# OldGitHub Privacy Policy

Last updated: 2026-11-13

OldGitHub re-renders `github.com` and the header on `gist.github.com` in GitHub's 2013-era visual style. It has no developer-operated server, analytics, advertising, or telemetry.

## Data the extension handles

OldGitHub processes the following data inside the browser:

- GitHub page content and the current GitHub URL, used to rebuild the page and route navigation.
- The current GitHub username and signed-in state, used to show the correct account interface. The extension reads GitHub's non-sensitive `dotcom_user` and `logged_in` indicators and the `user-login` meta tag on GitHub pages. It cannot read the protected session cookie.
- A theme preference (`light`, `dark`, or `auto`), stored with `chrome.storage.sync`. The resolved light or dark value is also cached in GitHub's local storage to prevent a color flash before Chrome loads the preference.
- The extension's on/off switch, stored with `chrome.storage.local`. A copy of it, and a yes/no flag recording that the last GitHub page was signed out, are cached in GitHub's local storage so the first paint matches. Tabs switched to GitHub's native page are remembered in session storage until the tab closes.

Fetched page content may remain in memory for the life of the GitHub tab to avoid duplicate requests. It is discarded when the tab closes or reloads and is never written to disk by OldGitHub.

## Where data goes

Page and API requests go only to GitHub-owned HTTPS services, including `github.com`, `gist.github.com`, `api.github.com`, and `githubusercontent.com` subdomains. The manifest grants host access to:

- `https://github.com/*`
- `https://gist.github.com/*`
- `https://*.githubusercontent.com/*`

The browser attaches the existing GitHub session cookie to requests made to GitHub when needed. OldGitHub never receives or stores the cookie value.

If Chrome Sync is enabled, Chrome may sync the theme preference to the user's other signed-in Chrome browsers. The on/off switch and the page-load flags above never leave this browser. No GitHub page content, URLs, or usernames are placed in Chrome storage or local storage.

OldGitHub does not send data to the developer, advertisers, data brokers, or any other third party. It does not sell data, use it for advertising or credit decisions, or allow humans to read it.

## Limited use

OldGitHub uses data only to provide its single purpose: displaying GitHub in the 2013-era interface. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

Questions can be filed at https://github.com/zeo/OldGitHub/issues.
