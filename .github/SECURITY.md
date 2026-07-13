# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported |
| ------- | --------- |
| 1.12.x  | Yes       |
| < 1.12  | No        |

## Reporting a Vulnerability

We take the security of Virtual Weather Sensors seriously. If you discover a
security vulnerability, please follow these guidelines.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/NearlCrews/signalk-virtual-weather-sensors/security/advisories/new) feature (preferred).
2. **GitHub Issues**: For non-sensitive security concerns, open an [issue](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues).

### What to Include

Please include the following information in your report:

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### Response Timeline

- **Initial Response**: within 48 hours of report
- **Status Update**: within 7 days with a preliminary assessment
- **Fix Timeline**: depends on severity, typically within 30 days

## Security Best Practices

When using this plugin:

1. **Keep Updated**: always use the latest version.
2. **Protect the API key**: the AccuWeather key is stored in the Signal K
   plugin configuration. Never commit it to version control, redact it from
   logs and bug reports, and rotate it if exposed. The plugin masks the key
   in its own log output.
3. **Network Security**: ensure your Signal K server is properly secured and
   limit access to trusted networks. The plugin's panel endpoints inherit
   Signal K's admin protection for the `/plugins` route tree. If server
   security is disabled, any client that can reach the server can also reach
   these endpoints.
4. **Access Control**: limit access to your Signal K admin interface.
5. **Monitor Logs**: watch for unusual activity in the Signal K logs.

## Dependency Security

This project uses:

- `npm audit` for vulnerability scanning (`npm run security-audit`)
- Automated dependency updates via Dependabot for security patches
- CodeQL static analysis on every push to `main`

Run a security audit:

```bash
npm audit
```

## Data Handling

This plugin talks to a small set of external weather services over HTTPS, and
the only personal data any of them receives is the vessel's GPS coordinates:

- **Open-Meteo** (default, keyless): receives only the vessel's coordinates to
  fetch current conditions; no API key is sent.
- **Open-Meteo Marine** (optional, keyless): when the marine layer is enabled,
  receives only the vessel's coordinates for sea-state data; no API key is sent.
- **Met.no Locationforecast** (optional, keyless): receives only the vessel's
  coordinates for current conditions and forecasts; no API key is sent.
- **NWS CAP warnings** (keyless): for US waters, receives only the vessel's
  coordinates to look up active alerts; no API key is sent.
- **Met.no MetAlerts** (keyless): for Norwegian waters, receives only the
  vessel's coordinates to look up active alerts; no API key is sent.
- **AccuWeather** (optional, key-gated): when AccuWeather is the selected
  source, requests carry the configured API key and the vessel's GPS
  coordinates (to resolve the AccuWeather location for the current position).

The plugin sends no other personal data and no account credentials. It does not
store historical weather data, and all external responses are validated and
bounded before use.

## Signal K Security

This plugin operates within the Signal K server environment. Please also
refer to the [Signal K documentation](https://signalk.org/documentation/) and
[Signal K server security best practices](https://github.com/SignalK/signalk-server/blob/master/SECURITY.md).

## Marine Safety Notice

This plugin feeds weather data into marine systems. While we strive for
security and reliability:

- **Not for Safety-Critical Use**: this software should not be relied upon
  as the sole means of weather assessment or navigation.
- **Professional Equipment**: always maintain certified instruments and
  official forecast sources.
- **Regular Verification**: the data is a regional API observation, not an
  onboard sensor reading; verify severe-weather notifications against
  official warnings.
- **Test Thoroughly**: test in non-critical conditions before relying on
  this plugin.

## Disclosure Policy

- We will coordinate disclosure timing with the reporter.
- Public disclosure will occur after a fix is available.
- Credit will be given to reporters (if desired).
- A security advisory will be published on GitHub.
