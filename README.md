# MyPass

Private passwords, your way.

This package is powered by the GoblinPass Engine. Review the GoblinPass license before using, modifying, redistributing, or publishing it.

## Use in a browser

Open `index.html` directly in a browser. No server, database, account, or install step is required.

## Publish on GitHub Pages

1. Create a new GitHub repository.
2. Upload all files from this package into the repository.
3. Open the repository settings.
4. Go to Pages.
5. Choose the main branch and root folder.
6. Save and wait for GitHub Pages to publish the site.

Your app will usually be available at:

`https://your-username.github.io/your-repository-name/`

## Install on mobile

1. Open the published GitHub Pages URL on your phone.
2. Use your browser menu.
3. Choose Add to Home Screen or Install App.

Install support depends on the mobile browser. The app includes a web manifest and icons for PWA-style installation.

## Security notes

- The master password is not saved.
- Full generated passwords are not saved.
- If you use the vault, saved ID/site/login metadata is stored locally in the browser.
- Optional full login storage may expose the email or username you used for an entry.
- The optional Additional Secret setting is saved locally, but the Additional Secret itself is never saved, exported, or transmitted.
- The Additional Secret input method preference is saved locally. The actual Additional Secret is cleared on refresh, app close, or Clear.
- The full Additional Secret is required every time. This fork does not use partial or random character prompts for the Additional Secret.
- Maximum Security is the default password style and keeps existing complex generation unchanged.
- Memorable Password mode is optional and creates deterministic word-based passwords with Easy, Standard, and Strong choices.
- The vault can optionally avoid saving Website IDs. If Website ID saving is off, users must remember or enter the ID themselves when regenerating a password.
- Trusted Device Protection is optional. Save the Recovery Key offline before relying on it on another device.
- If the Trusted Device Key is lost and no Recovery Key was saved, passwords generated with Trusted Device Protection cannot be recovered.
- Optional Google Sign-In uses a hardcoded frontend Client ID only. It does not request Gmail, Drive, Calendar, or other sensitive scopes. Do not add a client secret to this static site.
- Google Sign-In can be used for future sync/import/export convenience without changing passwords.
- Google Security Factor is separate and optional. When enabled, it requires Google Sign-In and adds the stable Google account subject ID, not the email address, to password generation.
- The Google Subject ID is kept in memory for generation and is not saved in plain text.
- If you lose access to the chosen Google account, passwords made with Google Security Factor may not be recoverable.
- If Additional Secret is disabled, password generation remains compatible with standard mode.
- The password engine lives in `/core`; branding files should not need to modify it.

## Files

- `index.html`
- `about.html`
- `readme.html`
- `README.md`
- `app.js`
- `style.css`
- `manifest.webmanifest`
- `config.json`
- `themes/config.json`
- `core/password-generator.js`
- `core/security.js`
- logo and icon files

Powered by the GoblinPass Engine. Review the GoblinPass license before publishing or redistributing.
