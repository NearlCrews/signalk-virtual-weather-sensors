# Development Documentation

This document provides comprehensive information about the tools, technologies, AI-assisted development process, and workflows used to create the signalk-virtual-weather-sensors Signal K plugin.

## 🤖 AI-Assisted Development

### Roo Code with Claude Sonnet 4.5

This project was developed using **Roo Code**, an AI-powered coding assistant built on **Anthropic's Claude Sonnet 4.5** language model. Roo Code provides intelligent code generation, refactoring, and architectural guidance while maintaining human oversight and decision-making.

#### Development Approach

The project was built through an iterative, AI-assisted workflow:

1. **Architecture Planning**: Initial project structure and technology stack decisions
2. **Incremental Development**: Feature-by-feature implementation with continuous validation
3. **Test-Driven Refinement**: Comprehensive test coverage developed alongside implementation
4. **Code Quality Enforcement**: Automated tooling for consistency and best practices
5. **Documentation Generation**: Inline and external documentation maintained throughout

#### Key Prompts and Interactions

The development process involved several key prompt categories:

**Initial Setup Prompts:**
- "Create a modern TypeScript Signal K plugin for weather data with NMEA2000 compatibility"
- "Set up comprehensive build tooling with esbuild, TypeScript 5.9+, and modern testing"
- "Configure Biome for linting/formatting to replace ESLint + Prettier"

**Architecture Prompts:**
- "Design service-oriented architecture with dependency injection for testability"
- "Implement NMEA2000 path mapping aligned with emitter-cannon conventions"
- "Create comprehensive validation framework for marine data integrity"

**Feature Development Prompts:**
- "Add support for 24+ AccuWeather data points including advanced temperature readings"
- "Implement vector-based wind calculations for apparent wind from vessel motion"
- "Create marine-specific indices: Beaufort scale, heat stress, air density calculations"

**Testing and Quality Prompts:**
- "Generate comprehensive test suite covering all services and calculations"
- "Add performance testing for real-time marine applications"
- "Implement pre-commit hooks with validation pipeline"

**Documentation Prompts:**
- "Create detailed README with installation, configuration, and usage examples"
- "Generate CHANGELOG following Keep a Changelog format"
- "Document all Signal K paths and NMEA2000 PGN mappings"

### Benefits of AI-Assisted Development

- **Rapid Prototyping**: Quick iteration on architectural patterns and implementations
- **Best Practices**: Automatic application of TypeScript and Node.js best practices
- **Comprehensive Testing**: AI-generated test cases covering edge cases and error conditions
- **Documentation Quality**: Consistent, detailed documentation maintained throughout development
- **Code Consistency**: Uniform coding style and patterns across the entire codebase

### Human Oversight

While AI-assisted, this project maintains human oversight for:
- Architectural decisions and technology choices
- Marine domain expertise and accuracy validation
- API integration requirements and AccuWeather field mappings
- NMEA2000 standard compliance verification
- Performance requirements and optimization strategies

## 🛠 Development Stack

### Core Technologies

#### TypeScript 5.9+
- **Purpose**: Primary development language with strict type safety
- **Configuration**: [`tsconfig.json`](tsconfig.json)
- **Features Used**:
  - Strict mode with comprehensive type checking
  - ES2023 target for modern JavaScript features
  - NodeNext module resolution for ESM compatibility
  - Declaration maps for enhanced IDE support
  - Verbatim module syntax for explicit imports/exports

**Key Configuration Highlights:**
```json
{
  "target": "ES2023",
  "module": "NodeNext",
  "strict": true,
  "noImplicitAny": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true
}
```

#### Node.js 20+
- **Purpose**: Runtime environment for Signal K server plugin
- **Version**: 20.0.0+ (specified in [`.node-version`](.node-version))
- **Module System**: Pure ESM (no CommonJS)
- **Features Used**:
  - Native ESM support with `import`/`export`
  - Node.js 20+ performance improvements
  - Built-in fetch API support

#### @signalk/server-api 2.10+
- **Purpose**: Official Signal K type definitions for plugins
- **Features Used**:
  - `Plugin` interface for plugin structure compliance
  - `ServerAPI` interface for type-safe server interaction
  - Proper typing for `handleMessage()`, `getSelfPath()`, etc.

**Plugin Implementation Pattern:**
```typescript
import type { Plugin, ServerAPI } from '@signalk/server-api';

export default function createPlugin(app: ServerAPI): Plugin {
  const plugin: Plugin = {
    id: 'my-plugin',
    name: 'My Plugin',
    start: (config, restart) => { /* ... */ },
    stop: () => { /* ... */ },
    schema: () => ({ /* ... */ }),
  };
  return plugin;
}
```

### Build and Bundling

#### esbuild
- **Purpose**: Fast, modern JavaScript bundler
- **Configuration**: [`esbuild.config.js`](esbuild.config.js)
- **Performance**: ~109KB bundle in ~16ms build time
- **Features**:
  - ES2023 target compilation
  - Source map generation
  - Tree shaking for optimal bundle size
  - External dependency handling
  - Banner injection for plugin metadata

**Build Outputs:**
- `dist/signalk-virtual-weather-sensors/index.js` - Main bundle
- `dist/signalk-virtual-weather-sensors/index.js.map` - Source maps
- `dist/signalk-virtual-weather-sensors/*.d.ts` - TypeScript declarations

### Code Quality

#### Biome 2.3+
- **Purpose**: Modern, fast linting and formatting (replaces ESLint + Prettier)
- **Configuration**: [`biome.json`](biome.json)
- **Features**:
  - TypeScript-native linting
  - Automatic code formatting
  - Performance-optimized (Rust-based)
  - Git integration for changed files

**Key Rules Enforced:**
- No non-null assertions
- Const over let when possible
- No unused variables/imports
- Exhaustive switch cases
- No double equals (===)
- Performance optimizations

**Formatting Standards:**
- 2-space indentation
- 100 character line width
- Single quotes for strings
- Semicolons always
- Trailing commas (ES5)
- LF line endings

### Testing

#### Vitest 4.x
- **Purpose**: Modern, fast unit testing framework
- **Configuration**: [`vitest.config.ts`](vitest.config.ts)
- **Features**:
  - TypeScript-first testing
  - Built-in coverage with v8
  - Watch mode for development
  - UI mode for interactive testing
  - Parallel test execution

**Test Coverage Requirements:**
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

**Test Structure:**
```
src/__tests__/
├── setup.ts                          # Global test configuration
├── calculators/
│   └── WindCalculator.test.ts       # Wind calculation tests
├── mappers/
│   └── NMEA2000PathMapper.test.ts   # Path mapping tests
└── services/
    └── AccuWeatherService.test.ts   # API integration tests
```

### Version Control

#### Husky 9.x
- **Purpose**: Git hooks for code quality enforcement
- **Configuration**: [`.husky/pre-commit`](.husky/pre-commit)
- **Pre-commit Hook**: Runs `npm run validate`

**Validation Pipeline:**
1. TypeScript type checking
2. Biome linting
3. Biome formatting check
4. Test suite execution

#### Lint-staged
- **Purpose**: Run linters only on staged files
- **Configuration**: [`package.json`](package.json:76-84)
- **Actions**:
  - TypeScript files: Biome check and format
  - JSON/Markdown: Biome format

### CI/CD

#### GitHub Actions
- **Purpose**: Automated testing and building
- **Configuration**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- **Workflows**:

**Test Job:**
- Matrix testing on Node.js 20.x and 22.x
- Lint, type check, and test coverage
- Codecov integration for coverage reports
- Security audit with npm audit

**Build Job:**
- Production build verification
- Bundle size analysis
- Output validation

## 📁 Project Structure

```
signalk-virtual-weather-sensors/
├── src/
│   ├── index.ts                  # Main plugin entry point
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── services/
│   │   ├── WeatherService.ts    # Main orchestration service
│   │   ├── AccuWeatherService.ts # API integration
│   │   └── SignalKService.ts    # Vessel data access
│   ├── calculators/
│   │   └── WindCalculator.ts    # Vector wind calculations
│   ├── mappers/
│   │   └── NMEA2000PathMapper.ts # Path mapping logic
│   ├── utils/
│   │   ├── conversions.ts       # Unit conversions
│   │   └── validation.ts        # Data validation
│   ├── constants/
│   │   └── index.ts             # Constants and defaults
│   └── __tests__/               # Test suite
├── dist/                         # Build output
├── coverage/                     # Test coverage reports
├── .github/
│   └── workflows/
│       └── ci.yml               # CI/CD pipeline
├── .husky/
│   └── pre-commit               # Git pre-commit hook
├── biome.json                   # Biome configuration
├── tsconfig.json                # TypeScript configuration
├── vitest.config.ts             # Vitest configuration
├── esbuild.config.js            # esbuild configuration
├── package.json                 # Dependencies and scripts
├── README.md                    # User documentation
├── CHANGELOG.md                 # Version history
├── DEVELOPMENT.md               # This file
└── LICENSE                      # Apache 2.0 license
```

## 🔧 Development Workflow

### Initial Setup

```bash
# Clone repository
git clone https://github.com/signalk/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors

# Install dependencies (automatically sets up husky hooks)
npm install

# Verify Node.js version (20.0.0+)
node --version
```

### Development Commands

#### Building
```bash
npm run build              # Full production build
npm run build:types        # Generate TypeScript declarations
npm run build:bundle       # Bundle with esbuild
npm run dev               # Development mode with hot reload
npm run clean             # Remove build artifacts
```

#### Testing
```bash
npm run test              # Run tests in watch mode
npm run test:run          # Run all tests once
npm run test:coverage     # Generate coverage report
npm run test:ui           # Interactive test UI
```

#### Code Quality
```bash
npm run lint              # Check code quality
npm run lint:fix          # Fix auto-fixable issues
npm run format            # Format all code
npm run type-check        # Verify TypeScript types
npm run validate          # Run all quality checks
npm run security-audit    # Check for vulnerabilities
```

#### Deployment
```bash
npm run build:deploy      # Build for deployment
npm run prepublishOnly    # Pre-publish validation
```

### Development Cycle

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Develop with Hot Reload**
   ```bash
   npm run dev
   ```

3. **Write Tests**
   ```bash
   npm run test
   ```

4. **Verify Code Quality**
   ```bash
   npm run validate
   ```

5. **Commit Changes** (pre-commit hooks run automatically)
   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

6. **Push and Create PR**
   ```bash
   git push origin feature/my-feature
   ```

### Pre-commit Validation

Husky automatically runs on every commit:
- TypeScript type checking
- Biome linting
- Test suite execution
- Code formatting verification

To manually run validation:
```bash
npm run validate
```

## 🧪 Testing Strategy

### Test Coverage

- **Unit Tests**: Individual functions and utilities
- **Integration Tests**: Service interactions and API calls
- **Calculation Tests**: Mathematical accuracy verification
- **Edge Case Tests**: Boundary conditions and error handling
- **Performance Tests**: Real-time calculation efficiency

**Total: 150 tests** across 5 test files

### Test Files

- [`WeatherService.test.ts`](src/__tests__/services/WeatherService.test.ts) - Core orchestration (25 tests)
- [`SignalKService.test.ts`](src/__tests__/services/SignalKService.test.ts) - Navigation data (40 tests)
- [`AccuWeatherService.test.ts`](src/__tests__/services/AccuWeatherService.test.ts) - API integration (17 tests)
- [`WindCalculator.test.ts`](src/__tests__/calculators/WindCalculator.test.ts) - Vector mathematics (43 tests)
- [`NMEA2000PathMapper.test.ts`](src/__tests__/mappers/NMEA2000PathMapper.test.ts) - Path mapping (25 tests)

### Running Specific Tests

```bash
# Run specific test file
npx vitest run src/__tests__/calculators/WindCalculator.test.ts

# Run tests matching pattern
npx vitest run -t "wind calculations"

# Run in UI mode
npm run test:ui
```

## 📊 Performance Considerations

### Bundle Optimization

- **Tree Shaking**: Removes unused code
- **External Dependencies**: Node modules not bundled
- **Minification**: Production builds minified
- **Source Maps**: Available for debugging

### Runtime Performance

- **Efficient Calculations**: Optimized mathematical operations
- **Minimal Memory**: Proper resource cleanup
- **Fast Validation**: NMEA2000 range validation with centralized limits
- **Smart Caching**: Vessel data caching with staleness checks

## 🔐 Security

### Dependency Management

```bash
# Regular security audits
npm run security-audit

# Update dependencies
npm update

# Check for outdated packages
npm outdated
```

### API Key Handling

- Environment-based configuration
- No hardcoded credentials
- Secure configuration storage in Signal K

## 📋 Signal K Standards Compliance

### Compliance Status: 95% ✅

This plugin adheres to official Signal K development standards with one intentional deviation for hardware compatibility.

### Standards References

- **Plugin Development**: [Signal K Plugin Guidelines](https://demo.signalk.org/documentation/Developing/Plugins.html)
- **Configuration**: [Configuration Schema Standards](https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html)
- **Weather Providers**: [Weather Provider Patterns](https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html)

### Compliance Checklist

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Plugin Structure | ✅ | Default export, start/stop methods |
| Configuration Schema | ✅ | JSON Schema with validation |
| Delta Message Format | ✅ | Proper context and updates array |
| Signal K Paths | ✅ | Standard environment.* conventions |
| Source Metadata | ✅ | Proper label and type fields |
| Status Reporting | ✅ | setPluginStatus/Error implemented |

### Known Deviation: Humidity Format

**Location**: [`src/mappers/NMEA2000PathMapper.ts:165`](src/mappers/NMEA2000PathMapper.ts:165)

**Signal K Standard**: Humidity as ratio (0-1)
**Our Implementation**: Humidity as percentage (0-100)

**Rationale**: Garmin marine displays and most NMEA2000 devices expect percentage format. This trade-off prioritizes real-world hardware compatibility over strict specification compliance.

**Impact**: Minor display issues possible in some Signal K clients, but correct display on physical marine electronics.

**Future Consideration**: Could add configuration option to choose format based on client requirements.

For complete compliance documentation and TODO items, see [`TODO.md`](TODO.md).

## 📚 Additional Resources

### Documentation

- [README.md](README.md) - User documentation and installation
- [CHANGELOG.md](CHANGELOG.md) - Version history and migration guides
- [TODO.md](TODO.md) - Remaining tasks and compliance notes
- [LICENSE](LICENSE) - Apache 2.0 license

### External Links

- [Signal K Documentation](https://signalk.org/)
- [Signal K Plugin Development](https://demo.signalk.org/documentation/Developing/Plugins.html)
- [NMEA2000 Standards](https://www.nmea.org/)
- [AccuWeather API](https://developer.accuweather.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Biome Documentation](https://biomejs.dev/)
- [Vitest Documentation](https://vitest.dev/)
- [Roo Code](https://roocode.com/)
- [Claude AI](https://www.anthropic.com/claude)

## 🤝 Contributing

### Code Style

- Follow TypeScript strict mode guidelines
- Use Biome for formatting (automatic on commit)
- Write comprehensive tests for new features
- Document public APIs with JSDoc comments
- Follow semantic versioning for changes

### Pull Request Process

1. Create feature branch from `develop`
2. Write code following project conventions
3. Add/update tests for changes
4. Update documentation as needed
5. Ensure all checks pass (`npm run validate`)
6. Submit PR with clear description
7. Address review feedback
8. Merge after approval

### Commit Convention

Follow conventional commits format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test additions/changes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Maintenance tasks

## 🎯 Future Enhancements

### Planned Features

- Additional weather data sources (OpenWeather, NOAA)
- Historical weather data storage
- Weather alerting system
- Enhanced marine-specific indices
- Web UI for configuration and monitoring

### Technical Improvements

- GraphQL API support
- WebSocket streaming for real-time updates
- Plugin marketplace integration
- Enhanced error recovery
- Performance monitoring dashboard

---

**Built with ❤️ using Roo Code and Claude Sonnet 4.5**

*For questions about the development process or AI-assisted development approach, please open an issue on GitHub.*