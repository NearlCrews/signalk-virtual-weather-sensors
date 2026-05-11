# Signal K App Store Status

Verified live on 2026-05-10.

The package `signalk-virtual-weather-sensors` is auto-discovered by the Signal K
App Store and appears for any Signal K server that loads its plugin catalog.

## How discovery works

The Signal K server's App Store interface
(`signalk-server/src/interfaces/appstore.js`) calls
`findModulesWithKeyword('signalk-node-server-plugin')`, which hits the public
npm search endpoint:

```
https://registry.npmjs.org/-/v1/search?size=250&text=keywords:signalk-node-server-plugin
```

There is no separate "submission" step. Any package on npm that carries the
`signalk-node-server-plugin` keyword is listed automatically. Categorization is
controlled by `signalk-category-*` keywords, with the canonical category list
defined in `signalk-server/src/categories.ts`.

## Verification

Pulled from the live npm registry on 2026-05-10:

| Field                | Value                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Package              | `signalk-virtual-weather-sensors`                                                                                         |
| Latest version       | 1.3.2                                                                                                                     |
| Published            | 2026-05-09T04:51:16Z                                                                                                      |
| Description          | Signal K plugin that provides comprehensive weather data from AccuWeather API with calculated wind values and NMEA2000-compatible environmental measurements |
| Display name         | Signal K Virtual Weather Sensors                                                                                          |
| Categories           | Weather (`signalk-category-weather`)                                                                                      |
| Discoverable via API | Yes: returned by the same `keywords:signalk-node-server-plugin` search the server uses                                    |

The next published release (1.4.0, currently `[Unreleased]`) adds a second
category, `signalk-category-nmea-2000`, so the plugin will surface under both
"Weather" and "NMEA 2000" once that version ships.

## Reproducing the check

```bash
curl -s 'https://registry.npmjs.org/-/v1/search?size=250&text=keywords:signalk-node-server-plugin' \
  | jq '.objects[] | select(.package.name == "signalk-virtual-weather-sensors") | .package | {name, version, description, keywords, date}'
```

If the package is missing from the result set, check that the latest published
version on npm still carries the `signalk-node-server-plugin` keyword: the
server's discovery query is keyword-only.
