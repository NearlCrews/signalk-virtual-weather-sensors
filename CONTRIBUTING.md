# Contributing to Signal K Virtual Weather Sensors

Thank you for your interest in contributing to Signal K Virtual Weather Sensors! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/signalk-virtual-weather-sensors.git
   cd signalk-virtual-weather-sensors
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
   ```

## Development Setup

### Prerequisites

- Node.js 20.0.0 or higher
- npm (comes with Node.js)
- Git

### Installation

```bash
# Install dependencies (automatically sets up husky pre-commit hooks)
npm install

# Run tests to verify setup
npm run test:run

# Build the project
npm run build
```

### Available Scripts

```bash
npm run dev              # Development mode with hot reload
npm run build            # Production build
npm run test             # Run tests in watch mode
npm run test:run         # Run all tests once
npm run test:coverage    # Generate coverage report
npm run lint             # Check code quality
npm run lint:fix         # Fix auto-fixable issues
npm run format           # Format code
npm run type-check       # Verify TypeScript types
npm run validate         # Run all quality checks
```

## How to Contribute

### Reporting Bugs

1. **Check existing issues** to avoid duplicates
2. **Use the bug report template** when creating a new issue
3. **Include detailed information**:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Environment details (Node.js version, OS, Signal K version)
   - Relevant logs or error messages

### Suggesting Features

1. **Check existing feature requests** to avoid duplicates
2. **Use the feature request template** when creating a new issue
3. **Provide context**:
   - Use case and problem you're trying to solve
   - Proposed solution or approach
   - Alternative solutions considered
   - Impact on existing functionality

### Making Code Changes

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the coding standards

3. **Write or update tests** for your changes

4. **Run validation** before committing:
   ```bash
   npm run validate
   ```

5. **Commit your changes** with meaningful commit messages

6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Create a Pull Request** on GitHub

## Coding Standards

### TypeScript

- Use **TypeScript 5.9+** with strict mode
- Use **@signalk/server-api** types (`Plugin`, `ServerAPI`) for Signal K integration
- Provide explicit type annotations for function parameters and return types
- Use interfaces for object shapes
- Avoid `any` type unless absolutely necessary
- Use type guards for runtime type checking

### Code Style

- Follow the **Biome** configuration in [`biome.json`](biome.json)
- Use **ES2023** features appropriately
- Prefer `const` over `let`, avoid `var`
- Use arrow functions for anonymous functions
- Use template literals for string interpolation

### Naming Conventions

- **Variables/Functions**: `camelCase`
- **Classes/Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Private class members**: prefix with `_` (e.g., `_privateMethod`)
- **Files**: `camelCase.ts` or `PascalCase.ts` for classes

### Documentation

- Add **JSDoc comments** for all public APIs
- Include `@param`, `@returns`, and `@throws` tags
- Document complex algorithms or business logic
- Keep comments up to date with code changes

### File Organization

```
src/
├── calculators/     # Mathematical and meteorological calculations
├── constants/       # Constant values and configuration defaults
├── mappers/         # Data transformation and path mapping
├── services/        # Core services (Weather, AccuWeather, Signal K)
├── types/           # TypeScript type definitions
├── utils/           # Utility functions (validation, conversion)
└── __tests__/       # Test files mirroring source structure
```

## Testing Guidelines

### Test Coverage

- Aim for **80%+ code coverage**
- Write tests for all new features
- Update tests when modifying existing code
- Test edge cases and error conditions

### Test Structure

```typescript
describe('Component/Feature', () => {
  describe('method or functionality', () => {
    it('should do expected behavior', () => {
      // Arrange
      const input = setupTestData();
      
      // Act
      const result = methodUnderTest(input);
      
      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

### Test Types

- **Unit tests**: Test individual functions and classes in isolation
- **Integration tests**: Test service interactions
- **Validation tests**: Verify data validation logic
- **Calculation tests**: Ensure mathematical accuracy

### Running Tests

```bash
npm run test           # Watch mode for development
npm run test:run       # Run once (used in CI)
npm run test:coverage  # Generate coverage report
npm run test:ui        # Interactive test UI
```

## Commit Message Guidelines

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build config)
- `ci`: CI/CD configuration changes

### Examples

```
feat(calculator): add Magnus formula for dew point calculation

Implement the Magnus formula for more accurate dew point calculations
in marine environments with temperature range -40°C to +50°C.

Closes #123
```

```
fix(mapper): correct humidity format for NMEA2000 compatibility

Changed humidity output from ratio (0-1) to percentage (0-100) to
ensure proper display on Garmin marine devices.

Fixes #456
```

## Pull Request Process

### Before Submitting

1. ✅ **All tests pass**: `npm run test:run`
2. ✅ **No linting errors**: `npm run lint`
3. ✅ **Type checking passes**: `npm run type-check`
4. ✅ **Code is formatted**: `npm run format`
5. ✅ **Branch is up to date** with `main`

### PR Requirements

1. **Clear title** following commit message guidelines
2. **Detailed description** explaining what and why
3. **Link related issues** using keywords (Fixes #123, Closes #456)
4. **Update documentation** if needed
5. **Add tests** for new functionality
6. **Update CHANGELOG.md** if user-facing changes

### Review Process

1. Automated checks must pass (CI/CD pipeline)
2. At least one maintainer approval required
3. All review comments must be addressed
4. Branch must be up to date with `main`

### After Merge

1. Delete your feature branch
2. Update your local repository:
   ```bash
   git checkout main
   git pull upstream main
   ```

## Development Tips

### Working with Signal K

- Test with a local Signal K server instance
- Use the Signal K server debug mode for detailed logs
- Verify NMEA2000 data using Signal K instruments

### Weather API Testing

- Use AccuWeather's free trial API key for development
- Mock API responses in tests to avoid rate limits
- Test error handling for API failures

### Debugging

```bash
# Run with debugging enabled
NODE_ENV=development npm run dev

# Run specific test file
npm run test WindCalculator.test.ts

# Check bundle size
npm run build
ls -lh dist/signalk-virtual-weather-sensors/
```

## Questions or Need Help?

- 📖 Check [DEVELOPMENT.md](DEVELOPMENT.md) for detailed technical documentation
- 🐛 Search [existing issues](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues)
- 💬 Open a [discussion](https://github.com/NearlCrews/signalk-virtual-weather-sensors/discussions)
- 📧 Contact maintainers via GitHub

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License. See [LICENSE](LICENSE) for details.

---

**Thank you for contributing to Signal K Virtual Weather Sensors!** 🚢⛵