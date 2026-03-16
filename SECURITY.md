# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the severity of the vulnerability.

| Version | Supported          |
| ------- | ------------------ |
| 1.2.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Signal K Virtual Weather Sensors team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisory** (Preferred)
   - Go to the [Security tab](https://github.com/NearlCrews/signalk-virtual-weather-sensors/security)
   - Click "Report a vulnerability"
   - Fill out the security advisory form

2. **Email**
   - Send an email to the repository maintainers via GitHub
   - Include "SECURITY" in the subject line
   - Provide detailed information about the vulnerability

### What to Include in Your Report

Please include the following information in your security report:

- **Type of vulnerability** (e.g., authentication bypass, injection, denial of service)
- **Full paths of affected source files**
- **Location of the vulnerable code** (tag/branch/commit or direct URL)
- **Step-by-step instructions to reproduce the issue**
- **Proof-of-concept or exploit code** (if possible)
- **Impact assessment** (what an attacker could accomplish)
- **Suggested fixes or mitigation strategies** (if you have them)

### Response Timeline

- **Initial Response**: Within 48 hours of receiving your report
- **Investigation**: We will investigate and determine the severity within 5 business days
- **Fix Development**: Timeline depends on severity:
  - Critical: 1-7 days
  - High: 7-14 days
  - Medium: 14-30 days
  - Low: 30-90 days
- **Public Disclosure**: After patch is released and users have had time to update (typically 7-14 days)

## Security Update Process

1. **Vulnerability Confirmed**: We confirm the vulnerability and assess its severity
2. **Patch Development**: We develop and test a fix
3. **Security Advisory**: We create a GitHub Security Advisory (private initially)
4. **Release**: We release a patched version
5. **Notification**: We notify users via GitHub releases and npm
6. **Public Disclosure**: After sufficient time for users to update, we make the advisory public

## Security Best Practices for Users

### API Key Security

- **Never commit API keys** to version control
- **Use environment variables** for storing AccuWeather API keys
- **Rotate keys regularly** if exposed
- **Use read-only keys** when available

### Plugin Configuration

- **Limit Signal K server access** to trusted networks
- **Use HTTPS** for Signal K server connections when possible
- **Keep plugin updated** to latest version
- **Monitor logs** for suspicious activity

### Network Security

- **Firewall protection**: Ensure your Signal K server is behind a firewall
- **VPN access**: Use VPN for remote access to marine systems
- **Segment networks**: Keep marine electronics on separate network segments
- **Update regularly**: Keep Node.js and dependencies up to date

## Known Security Considerations

### Third-Party API Dependencies

This plugin relies on the AccuWeather API for weather data:

- **API Authentication**: Requires valid API key
- **Data Privacy**: Weather data requests include location information
- **Rate Limiting**: API rate limits help prevent abuse
- **Network Exposure**: Plugin makes external HTTPS requests

### Data Handling

- **No persistent storage**: Plugin does not store historical weather data
- **No sensitive data collection**: Only collects publicly available weather information
- **Validation**: All external data is validated before use

### NMEA2000 Network Integration

- **Network isolation recommended**: Keep NMEA2000 network isolated from internet
- **Signal K security**: Follow Signal K server security best practices
- **Data integrity**: All sensor data is validated before emission

## Scope

### In Scope

- Vulnerabilities in plugin code
- Dependency vulnerabilities with direct impact
- Authentication and authorization issues
- Data validation and sanitization problems
- Injection vulnerabilities (command, code, etc.)
- Denial of service vulnerabilities
- Information disclosure issues

### Out of Scope

- Social engineering attacks
- Physical attacks on marine systems
- Third-party service vulnerabilities (AccuWeather API)
- Signal K server core vulnerabilities (report to Signal K project)
- Issues in marine display hardware
- Theoretical vulnerabilities without practical exploit

## Security Maintenance

### Dependency Updates

- **Automated scanning**: GitHub Dependabot monitors dependencies
- **Regular updates**: Dependencies reviewed and updated monthly
- **Security patches**: Critical security updates applied immediately

### Code Quality

- **Static analysis**: Biome linter checks for code quality issues
- **Type safety**: TypeScript strict mode prevents common vulnerabilities
- **Testing**: Comprehensive test suite validates functionality
- **Pre-commit hooks**: Automated validation before code is committed

## Responsible Disclosure

We follow responsible disclosure practices:

- We will acknowledge receipt of your vulnerability report
- We will work with you to understand and validate the issue
- We will keep you informed of our progress
- We will credit you in the security advisory (unless you prefer anonymity)
- We request that you do not publicly disclose until we have released a fix

## Security Hall of Fame

We recognize and thank security researchers who help keep this project secure:

<!-- Security researchers who report vulnerabilities will be listed here -->

*No vulnerabilities reported yet.*

## Questions?

If you have questions about this security policy or need clarification, please:

- Open a [GitHub Discussion](https://github.com/NearlCrews/signalk-virtual-weather-sensors/discussions)
- Contact the maintainers via GitHub

## Additional Resources

- [Signal K Security Best Practices](https://github.com/SignalK/signalk-server/blob/master/SECURITY.md)
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Best Practices](https://docs.npmjs.com/packages-and-modules/securing-your-code)

---

**Last Updated**: 2026-03-16

Thank you for helping keep Signal K Virtual Weather Sensors and its users safe!