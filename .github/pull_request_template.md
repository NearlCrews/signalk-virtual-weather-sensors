# Pull Request

## Description

<!-- Provide a clear and concise description of what this PR does -->

## Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🎨 Code style update (formatting, renaming)
- [ ] ♻️ Refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] ✅ Test update
- [ ] 🔧 Build configuration change
- [ ] 🔒 Security fix

## Related Issues

<!-- Link any related issues using keywords: Fixes #123, Closes #456, Relates to #789 -->

Fixes #

## Changes Made

<!-- List the specific changes made in this PR -->

- 
- 
- 

## Testing

<!-- Describe the testing you've done -->

### Test Environment
- Node.js version:
- Signal K version:
- Operating system:

### Test Cases
<!-- Describe what you tested and the results -->

- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Manual testing completed
- [ ] Tested with Signal K server
- [ ] Tested NMEA2000 data emission
- [ ] Tested AccuWeather API integration

### Test Results
<!-- Paste test output or describe results -->

```
npm run test:run output here
```

## Code Quality Checklist

<!-- Verify all items before submitting -->

- [ ] Code follows the project's coding standards
- [ ] `npm run validate` passes locally (canonical pre-commit gate: type-check + lint + tests)
- [ ] All pre-commit hooks pass
- [ ] No new warnings or errors introduced

## Documentation

<!-- Mark what documentation has been updated -->

- [ ] Code comments added/updated
- [ ] JSDoc comments added for public APIs
- [ ] README.md updated (if needed)
- [ ] CHANGELOG.md updated
- [ ] DEVELOPMENT.md updated (if needed)
- [ ] Migration guide provided (for breaking changes)

## NMEA2000 Compatibility

<!-- If this PR affects NMEA2000 integration -->

<!-- Note: PGN instance numbers and bus priority are owned by the companion
     `signalk-nmea2000-emitter-cannon` plugin, not by this plugin. Wire-format
     concerns belong to that PR, not this one. -->

- [ ] Source paths consumed by cannon are still emitted (`environment.outside.{pressure,temperature,dewPointTemperature,apparentWindChillTemperature,heatIndexTemperature,relativeHumidity}`, `environment.wind.{speedOverGround,directionTrue,speedApparent,angleApparent}`)
- [ ] Data validation within NMEA2000 ranges (per `NMEA2000_LIMITS` in `src/constants/index.ts`)
- [ ] Tested with marine electronics (if applicable)
- [ ] N/A: does not affect NMEA2000 bridging

## Signal K Integration

<!-- If this PR affects Signal K paths or deltas -->

- [ ] Canonical leaves stay under canonical containers (`environment.outside.*`, `environment.wind.*`); non-1.8.2 paths live under `environment.weather.*`
- [ ] Delta messages properly formatted (`Update` is XOR `values | meta`; meta in its own update entry)
- [ ] `$source: 'accuweather'` set on every emitted update
- [ ] Tested with Signal K instruments
- [ ] N/A: does not affect Signal K paths

## Breaking Changes

<!-- If this PR includes breaking changes, describe them and the migration path -->

### Description of Breaking Changes


### Migration Guide


### Deprecation Warnings
<!-- Are there any deprecation warnings users should know about? -->


## Performance Impact

<!-- Describe any performance implications -->

- [ ] No performance impact
- [ ] Performance improvement (describe below)
- [ ] Potential performance impact (describe below)

**Details:**


## Security Considerations

<!-- Any security implications of this change? -->

- [ ] No security implications
- [ ] Security improvement (describe below)
- [ ] Requires security review

**Details:**


## Dependencies

<!-- List any new dependencies or dependency updates -->

- [ ] No new dependencies
- [ ] Dependencies added (list below)
- [ ] Dependencies updated (list below)

**Changes:**


## Screenshots/Logs

<!-- If applicable, add screenshots or log output to help explain the changes -->


## Reviewer Notes

<!-- Any specific areas you'd like reviewers to focus on? -->


## Additional Context

<!-- Add any other context about the PR here -->


## Pre-submission Checklist

<!-- Final checks before submitting -->

- [ ] I have read the [CONTRIBUTING.md](../../CONTRIBUTING.md) guidelines
- [ ] My code follows the project's code style
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Post-merge Tasks

<!-- Tasks to complete after merging (if any) -->

- [ ] Update documentation website
- [ ] Announce changes to users
- [ ] Update related issues
- [ ] Create follow-up issues
- [ ] N/A

---

**Thank you for contributing to Signal K Virtual Weather Sensors!** 🚢⛵