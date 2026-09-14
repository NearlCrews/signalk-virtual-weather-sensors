# Troubleshooting

The plugin surfaces every fault as a status banner in the Signal K Admin UI
(Server -> Plugin Config) and in the server log. This guide maps each banner
string to a cause and a fix.

The API-key, rate-limit, and quota banners below apply whenever AccuWeather is
the selected single source or participates in a merged source. The keyless
sources (the default Open-Meteo and Met.no) have no per-key quota.

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
`updateFrequency` tick costs 1 current-conditions call. The location key is
cached for 24 hours per 1 km cell, so a stationary vessel adds 1 location
lookup per day and a vessel underway adds 1 lookup for each fetch that lands
in a new cell (up to 2 calls per fetch). The fetch timer's jitter only
lengthens the interval, so the counts below are upper bounds. A restart, a
panel key test, and on-demand v2 Weather API calls spend from the same budget.

Fix: the default `updateFrequency` of 30 minutes costs at most 48 conditions
calls plus 1 lookup per day at a fixed position (49 of the default 50), and up
to 96 per day underway. If you have lowered `updateFrequency` below 30, raise
it back: at 5 minutes the plugin would burn 288 conditions calls per day
before lookups. Underway on the default quota, use 60 minutes (at most 48 calls
per day with a lookup on every fetch) or raise `dailyApiQuota` to your plan's
allowance. See `examples/slow-update.json` for that 60-minute profile, which
also suits a key shared with other AccuWeather consumers.

## `RESPONSE_TOO_LARGE: AccuWeather response is N bytes`

The plugin caps response bodies at 1 MiB to defend against runaway upstream
payloads. AccuWeather Current Conditions responses are normally a few
kilobytes, so this almost always indicates a misrouted response (proxy error
page, captive portal).

Fix: confirm the Signal K server can reach `dataservice.accuweather.com`
directly without an HTML interstitial.

## `Running [quota N% used]` (warning prefix in the status banner)

The rolling 24-hour API request count has crossed 90% of `dailyApiQuota`, and
`N` is the real figure, so the prefix keeps climbing past 90 as usage does. The
plugin still fetches normally; this is a soft warning so operators can raise
the quota or `updateFrequency` before fetches actually pause.

In merged mode the banner also names any provider that has stopped contributing
(`AccuWeather paused at quota`). The blend keeps producing values from its
remaining sources, so this is the only signal that it has quietly degraded.

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

## `Weather update failed: <error>`

The plugin emits this banner as soon as a fetch fails, so the underlying cause
is visible without waiting for the staleness watchdog below. The message carries
the error code from the list above, and a `(N consecutive)` suffix once more than
one attempt in a row has failed. The banner stays up until a fetch succeeds.

Fix: read the error code. It clears automatically on the next successful fetch.

## `Weather data stale: ...`

Two different conditions raise a stale banner, and the wording says which:

- `Weather data stale: last update N minutes ago` means the last SUCCESSFUL
  fetch is older than `2 x updateFrequency`. The usual causes are upstream API
  errors, network outages, and a missing GPS position.
- `Weather data stale: provider observation N minutes old, last update M minutes ago`
  means fetches are succeeding but the provider is serving an old observation.
  Each provider declares its own limit: 1 hour for Open-Meteo, 2 hours for
  AccuWeather, and 3 hours for Met.no (also the default for a provider that
  declares none). This is the case that network symptoms cannot explain: every
  HTTP call returns 200 while the model behind them has stopped updating.

Emission stops while data is stale, but an already-active notification is NOT
cleared: a provider outage must never look like a hazard clearing. Each active
band is re-emitted once with `(data N min old)` appended to its message so a
consumer subscribed to `notifications.environment.*` can see the caveat too.

Fix: for the first shape, the Signal K server logs will show the underlying
error code from the list above. For the second, wait for the provider's model to
refresh, or switch weather source. Both banners clear once a fresh observation
arrives.

## `Waiting for GPS position`

The plugin emits this banner when it cannot read a usable `navigation.position`
from the self vessel, so it has no point to fetch weather for. There is no
fixed-coordinates fallback. Three causes:

- The path is absent, null, or has no valid Signal K timestamp.
- It comes from an excluded source (currently any source label containing
  `node-red`).
- Its timestamp is more than 30 minutes old. Position gets a far looser age
  budget than the speed, course, and heading trio that feeds apparent wind,
  because it only selects a weather grid cell, but a source that publishes a
  position less often than every 30 minutes still fails the gate.

Fix: confirm a GPS source is publishing `navigation.position` in the Signal K
Data Browser, and check its timestamp is current. Any source whose label
contains `node-red` is deliberately ignored to avoid feedback loops, so a
Node-RED-published position will not be picked up; use a different source label
or a real GPS/AIS feed.

## The plugin reports every fetch as invalid right after boot

On a host with no real-time clock, the system time is wrong until NTP settles.
A provider observation more than an hour ahead of the local clock is rejected
with `INVALID_WEATHER_DATA: ... timestamp is far ahead of this host's clock`,
and a clock behind UTC by any amount also suppresses observation-age staleness
detection, because an age is never allowed to go negative. The plugin logs
`Provider observation is ahead of this host clock` with the measured skew.

Fix: none needed if it self-heals within a minute or two of boot; that is NTP
settling. If it persists, fix the host clock (`timedatectl status` on a systemd
host) and consider fitting an RTC module.

## Weather paths vanish from a downstream consumer after switching the weather source

This is not a fault banner. The plugin stamps every weather delta with a
`$source` that identifies the active provider: `open-meteo` by default,
`met-no` for Met.no, `accuweather` for AccuWeather, and `vws-merged` in merge
mode (the optional marine layer uses `open-meteo-marine`). Changing the
weather source therefore changes the `$source` on every path the plugin
emits. Any downstream consumer pinned to a specific
source keeps listening for the old one and silently receives nothing, even
though the Data Browser shows the new values arriving.

The most common case is the `signalk-nmea2000-emitter-cannon` companion, whose
per-path source locks, and the server's own source-priority rules, match on the
exact `$source` string. After a switch from AccuWeather to Open-Meteo, a lock
left on `accuweather` filters out every `open-meteo` delta, so the bridged
NMEA 2000 instrument shows no air temperature, pressure, humidity, or wind.

Fix: update every downstream source lock and source-priority rule that names the
old provider to the new `$source` (`open-meteo`), or clear the lock so it accepts
whichever source publishes the path, then restart the consuming plugin. Confirm
the new `$source` in the Signal K Data Browser under the affected `environment.*`
path.
