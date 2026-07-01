# Forge Steel

**FORGE STEEL** is a hero builder app for **DRAW STEEL**, designed by [Andy Aiken](mailto:andy.aiken@live.co.uk).

You can find it [here](https://forgesteel.net).

## Heroes

With this app you can create heroes using the **DRAW STEEL** core rules.

![Hero Sheet](./src/assets/screenshots/hero-sheet-interactive.png)

This shows a hero's character sheet.

![Hero Edit](./src/assets/screenshots/hero-edit.png)

Here is a hero being edited.

## Homebrew

You can also use this app to create homebrew hero-building elements - ancestries, classes, kits, and so on.

![Library](./src/assets/screenshots/library.png)

Here we can see the list of elements that can be homebrewed. To create a homebrew element you can create it from whole cloth, or copy an official element.

![Homebrew](./src/assets/screenshots/homebrew.png)

Here we can see a homebrew kit being created.

## Legal

**FORGE STEEL** is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC.

**DRAW STEEL** © 2024 MCDM Productions, LLC.

## Development

**FORGE STEEL** is written in Typescript, using React and Ant Design.

If you would like to contribute, you can:

* Add feature requests and raise bug reports [here](https://github.com/andyaiken/forgesteel/issues)
* Fork the repository, make your changes to the code, and raise a pull request

To run the app locally, run the following commands:

```
npm install
npm run start
```

Once built, the app should then be available at `http://localhost:5173/`.

When you've finished with your changes, make sure to appease the linter and run the unit tests:

```
npm run check
```

If all is well, you can then create your pull request.

## GitHub Pages

This fork deploys with GitHub Actions. In GitHub, open **Settings -> Pages** and set **Build and deployment / Source** to **GitHub Actions**. Then push to `main` or run the `Deploy GitHub Pages` workflow manually.

The static site files are generated in `dist` by:

```
npm run build
```

Do not publish the repository root as the Pages source. The root contains the React/Vite source files, not the built app. GitHub Pages should serve the generated `dist` artifact from the workflow.

The deployed app URL is:

```
https://sirqus.github.io/forgesteel-owlbear-bridge/
```

## Google Drive Hero Sync

Google Drive hero sync is optional. If `VITE_GOOGLE_CLIENT_ID` is not set, Forge Steel keeps using local browser storage and the Google Drive sync button shows as unconfigured.

To enable it on GitHub Pages:

1. Create a Google OAuth web client.
2. Add `https://sirqus.github.io` as an authorized JavaScript origin.
3. Add the client ID as a repository secret named `GOOGLE_CLIENT_ID`.
4. Redeploy the `Deploy GitHub Pages` workflow.

The sync stores hero data in the user's Google Drive `appDataFolder` using the `drive.appdata` scope. Local saves remain instant; Google Drive sync runs after sign-in, on hero changes, on focus, and on a short polling interval while the app is open.
