# External Data Sources Plugin for Millennium

A Millennium plugin that adds external data integration for non-Steam games.

Currently, the plugin can display an RSS or Atom feed as a news source on a non-Steam game's details page in the Steam client.

![External news for a non-Steam game in Steam](.github/assets/external_data_sources_01.png)


## How to Install

1. Go to the [Releases page](../../releases/latest) and download the latest `io.tsukasa.millennium.external-data-sources.star` file.
2. Place the `.star` file in your Millennium plugin folder.
3. Open your Millennium settings and confirm that **External Data Sources** is listed and enabled.


## How to Use

1. Right-click a non-Steam game and select **Properties** → **External Data Sources**.
2. Enter a fully qualified HTTP or HTTPS URL for an RSS 2.0 or Atom 1.0 feed.
3. Click **Save** to save the settings for the game and refresh the news view.
4. Click **Clear** to remove the source and restore Steam's default behavior.

Note: You can save exactly one feed per shortcut AppID.

When displaying feed items, the plugin automatically tries to select an image from the feed.
If an item has no image, it is displayed without one. Items without dates appear at the end
of the list.

Clicking an article opens it.

If a feed cannot be retrieved, the plugin displays a message with a **Retry** button.

Successfully retrieved feeds are cached for ten minutes. Changing a feed source invalidates its cache.

Removing a non-Steam shortcut from the Steam library also removes its configured feed.

Per-game feed settings are stored in Millennium's persistent plugin configuration
under `plugins["io.tsukasa.millennium.external-data-sources"].config["<appid>"].feed` in the Millennium `config.json`.


## How to Build

To build this plugin, you will require Bun and Node.js:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
```

Translations are maintained in `resources/locales/<steam-language>.json`.

The build, type-check, test, and development commands generate `resources/locales.json`
for the frontend. While `bun run dev` is running, run `bun run locales` after editing
a language file to refresh the bundle.

Building the plugin with `bun run build` produces
`dist/io.tsukasa.millennium.external-data-sources.star`.

To install the plugin, copy the `.star` file to your Millennium plugin folder and enable
**External Data Sources** in Millennium.


## Plugin Limitations

- No support for Big Picture mode.
- No integration with the main library page.
- No automatic feed discovery for a URL.


## Acknowledgements

- Uses parts of [retrotoolsdev-wq's Game Data Linker](https://github.com/retrotoolsdev-wq/game-data-linker/) code for resolving Steam CSS classes.
- Uses parts of [k0d13's Steam non-Steam Playtimes](https://github.com/k0d13/steam-non-steam-playtimes/) code for the Properties dialog.
- Uses [Millennium's PluginTemplate](https://github.com/SteamClientHomebrew/PluginTemplate) as a base for the plugin.
- This project is partially AI slop. Portions of the frontend code was generated using OpenAI Luna. Locales were generated using AI from the English base locale.

Detailed acknowledgements are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) within the `.star` file.


## FAQ

**Q: Will this plugin support Big Picture mode or the main Library view?**

Unlikely. I wanted a way to display a news feed for non-Steam games on their details pages.

**Q: Why is this plugin not available on Millennium's plugin page?**

I built this for my own use. Maintaining a plugin on an officially curated list would be
more commitment than I want to take on. Feel free to fork this code, improve it, and
submit it to Millennium. That's what open source is for.

**Q: Why did you use a clanker? The code sucks!**

As long as desktop applications continue to use web technologies, I have very little shame in generating parts I cannot be bothered to work out myself. It is already a shit stack anyway.
