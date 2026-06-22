# Troubleshooting

The plugin surfaces every fault as a status banner in the Signal K Admin UI
(Server -> Plugin Config) and in the server log. This guide maps each banner
string to a cause and a fix.

The API-key, rate-limit, and quota banners below apply only when AccuWeather is
the selected weather source. The default Open-Meteo source is keyless and has no
per-key quota, so those banners do not appear under it.

## `API_UNAUTHORIZED: Invalid API key` (HTTP 401)

The AccuWeather server rejected the key. No weather deltas are emitted while
this banner is showing.

Fix: log in to [developer.accuweather.com](https://developer.accuweather.com/),
open *My Apps*, confirm the key is active, and copy it again with no leading or
trailing whitespace. Keys are at least 20 characters.

## `API_FORBIDDEN: API access forbidden` (HTTP 403)

The key is valid but not authorized for the *Current Conditions* endpoint, or
the request came from a blocked IP.

Fix: confirm the key's plan includes *Current Conditions* in the AccuWeather
portal, or the trial key has expired. Trial keys expire 14 days after creation.
If you proxy outbound traffic, confirm the egress IP is not on AccuWeather's
block list.

## `API_RATE_LIMIT: Rate limit exceeded` (HTTP 429)

AccuWeather rate-limited the request, and AccuWeather enforces its own per-plan
daily limit. The plugin defaults to a 50 calls/day budget. Each
`updateFrequency` tick costs 1 call (location lookups are cached for 1 hour, so
they rarely cost extra).

Fix: the default `updateFrequency` of 30 minutes uses 48 calls/day, which sits
inside the default 50/day budget. If you have lowered `updateFrequency` below
30, raise it back: at 5 minutes the plugin would burn 288 calls/day. See
`examples/slow-update.json` for an ultra-conservative 60-minute profile (24
calls/day) suitable when the key is shared with other AccuWeather consumers.

## `RESPONSE_TOO_LARGE: AccuWeather response is N bytes`

The plugin caps response bodies at 1 MiB to defend against runaway upstream
payloads. AccuWeather Current Conditions responses are normally a few
kilobytes, so this almost always indicates a misrouted response (proxy error
page, captive portal).

Fix: confirm the Signal K server can reach `dataservice.accuweather.com`
directly without an HTML interstitial.

## `Running [quota 90% used]` (warning prefix in the status banner)

The rolling 24-hour API request count has crossed 90% of `dailyApiQuota`. The
plugin still fetches normally; this is a soft warning so operators can raise
the quota or `updateFrequency` before fetches actually pause.

Fix: the suffix `K/Q today` shows the live count. Either raise `dailyApiQuota`
(paid-tier keys typically allow 25k+/day) or increase `updateFrequency` to
spend the remaining headroom more slowly.

## `AccuWeather daily quota reached (K/Q in last 24h)`

The rolling 24-hour count has hit `dailyApiQuota`. The plugin emits a
`setPluginError`, skips new fetches, and serves the last good weather payload
until the rolling window drops below the cap. The full banner text is:

> AccuWeather daily quota reached (K/Q in last 24h). Fetches paused until the
> rolling window drops below the cap. To resume sooner, raise dailyApiQuota or
> increase updateFrequency.

Fix: the cap is per rolling 24h, not calendar day, so the plugin resumes
fetches gradually as the oldest hourly buckets age out. To resume immediately,
either raise `dailyApiQuota` and restart the plugin, or set `dailyApiQuota: 0`
to disable the cap entirely.

## `Weather data stale: last update N minutes ago`

The plugin emits this banner when the last successful fetch is older than
`2 x updateFrequency`. The most common causes are upstream API errors, network
outages, and missing GPS position.

Fix: the Signal K server logs will show the underlying error code from the
list above. The banner clears automatically once the next fetch succeeds.

## `No position available for weather data`

The plugin throws this when `navigation.position` on the self vessel is null,
undefined, or comes from an excluded source (currently any source label
containing `node-red`). There is no fixed-coordinates fallback.

Fix: confirm a GPS source is publishing `navigation.position` in the Signal K
Data Browser. Any source whose label contains `node-red` is deliberately
ignored to avoid feedback loops, so a Node-RED-published position will not be
picked up; use a different source label or a real GPS/AIS feed.
