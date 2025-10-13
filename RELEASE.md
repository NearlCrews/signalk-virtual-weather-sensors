# Release Checklist

This document outlines the steps for creating a new release of Signal K Virtual Weather Sensors.

## Pre-Release Checklist

### Code Quality

- [ ] All tests pass (`npm run test:run`)
- [ ] Linting passes with no errors (`npm run lint`)
- [ ] Type checking passes (`npm run type-check`)
- [ ] Full validation passes (`npm run validate`)
- [ ] Test coverage is adequate (`npm run test:coverage`)
- [ ] No security vulnerabilities (`npm run security-audit`)

### Documentation

- [ ] `README.md` is up to date with new features
- [ ] `CHANGELOG.md` is updated with version and changes
- [ ] `DEVELOPMENT.md` reflects current development practices
- [ ] All code has JSDoc comments for public APIs
- [ ] Migration guide added (if breaking changes)

### Version Update

- [ ] Update version in `package.json`
- [ ] Update version references in documentation
- [ ] Ensure `CHANGELOG.md` has correct version and date

### Build Verification

- [ ] Clean build succeeds (`npm run build`)
- [ ] Built package contains expected files
- [ ] Test local installation of built package
- [ ] Verify package size is reasonable (`npm pack --dry-run`)

## Release Process

### 1. Prepare Release Branch

```bash
# Ensure main branch is up to date
git checkout main
git pull origin main

# Create release branch
git checkout -b release/vX.Y.Z
```

### 2. Update Version and Changelog

```bash
# Update package.json version
npm version [major|minor|patch] --no-git-tag-version

# Update CHANGELOG.md with version and date
# Add release notes and notable changes
```

### 3. Commit and Push

```bash
# Commit changes
git add package.json CHANGELOG.md
git commit -m "chore: prepare release vX.Y.Z"

# Push release branch
git push origin release/vX.Y.Z
```

### 4. Create Pull Request

- Create PR from `release/vX.Y.Z` to `main`
- Ensure all CI checks pass
- Get approval from maintainers
- Merge using "Squash and merge"

### 5. Create GitHub Release

```bash
# Pull latest main
git checkout main
git pull origin main

# Create and push tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

### 6. Publish GitHub Release

- Go to GitHub Releases: https://github.com/NearlCrews/signalk-virtual-weather-sensors/releases/new
- Select the tag `vX.Y.Z`
- Release title: `vX.Y.Z`
- Copy release notes from `CHANGELOG.md`
- Click "Publish release"

**Note:** Publishing the GitHub release will automatically trigger the npm publish workflow via the `publish.yml` GitHub Action.

### 7. Verify npm Publication

The GitHub Action will automatically:
- Run validation checks
- Build the package
- Publish to npm with provenance
- Verify the package is installable

Check the [Actions tab](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions) to monitor progress.

After the workflow completes:

```bash
# Verify package is available
npm view signalk-virtual-weather-sensors

# Test installation
mkdir test-install
cd test-install
npm init -y
npm install signalk-virtual-weather-sensors
```

## Post-Release Checklist

### Verification

- [ ] npm package is published and available
- [ ] Package version on npm matches release
- [ ] GitHub release is published
- [ ] CI/CD workflow completed successfully
- [ ] Package badges updated in README
- [ ] Test installation from npm works

### Communication

- [ ] Announce release on Signal K forums (if applicable)
- [ ] Update Signal K app store (if applicable)
- [ ] Close any resolved issues
- [ ] Update project boards

### Documentation

- [ ] Verify npm page displays correctly
- [ ] Check that README renders properly on npm
- [ ] Ensure documentation links work
- [ ] Update any external documentation

## Hotfix Release Process

For urgent bug fixes that need immediate release:

### 1. Create Hotfix Branch

```bash
# Branch from the tag that needs fixing
git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z

# Or branch from main if it's the latest
git checkout -b hotfix/vX.Y.Z+1 main
```

### 2. Apply Fix

```bash
# Make necessary changes
# Update version to patch increment
npm version patch --no-git-tag-version

# Update CHANGELOG.md with hotfix notes
```

### 3. Test and Verify

```bash
npm run validate
npm run build
npm run test:run
```

### 4. Release

```bash
# Commit changes
git commit -am "fix: [description of hotfix]"

# Merge to main
git checkout main
git merge --no-ff hotfix/vX.Y.Z+1

# Tag and push
git tag -a vX.Y.Z+1 -m "Hotfix vX.Y.Z+1"
git push origin main
git push origin vX.Y.Z+1
```

### 5. Create GitHub Release

Follow steps 6-7 from standard release process.

## Rollback Process

If a release needs to be rolled back:

### npm Deprecation

```bash
# Deprecate the problematic version
npm deprecate signalk-virtual-weather-sensors@X.Y.Z "This version has been deprecated due to [reason]. Please use version X.Y.Z-1 instead."
```

### GitHub Release

- Edit the GitHub release
- Mark as "pre-release" or delete if necessary
- Add deprecation notice to release notes

### Communication

- Notify users via GitHub issue
- Post on Signal K forums
- Update README with warning (if needed)

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

## Pre-Release Versions

For alpha/beta releases:

```bash
# Alpha release
npm version prerelease --preid=alpha
# Results in: X.Y.Z-alpha.0

# Beta release
npm version prerelease --preid=beta
# Results in: X.Y.Z-beta.0
```

Publish with tag:
```bash
npm publish --tag beta
```

## Useful Commands

```bash
# Check what will be included in package
npm pack --dry-run

# View current package info on npm
npm view signalk-virtual-weather-sensors

# Check for outdated dependencies
npm outdated

# Update dependencies (careful with breaking changes)
npm update

# Security audit
npm audit
```

## Troubleshooting

### Build Fails

1. Clean and rebuild: `npm run clean && npm run build`
2. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
3. Check Node.js version: `node --version` (should be 20+)

### Tests Fail

1. Run specific failing test: `npm run test -- [test-file]`
2. Check for environment issues
3. Verify all dependencies installed correctly

### npm Publish Fails

1. Ensure you're logged in: `npm whoami`
2. Check npm token is set in GitHub secrets
3. Verify package name is not taken
4. Check for 2FA requirements

### CI/CD Fails

1. Check GitHub Actions logs
2. Verify secrets are configured correctly
3. Check workflow file syntax
4. Ensure branch protections aren't blocking

## Notes

- Always create releases from `main` branch
- Never force push to `main`
- Keep the CHANGELOG.md up to date with every release
- Test installations on clean environments
- Monitor npm download statistics and GitHub issues after release
- Consider security implications of every release

---

**For questions about the release process, consult the [DEVELOPMENT.md](DEVELOPMENT.md) or open a discussion on GitHub.**