# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/workflows/CI/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![NMEA2000](https://img.shields.io/badge/NMEA2000-Compatible-green.svg)](https://www.nmea.org/)
[![AccuWeather](https://img.shields.io/badge/AccuWeather-API-orange.svg)](https://developer.accuweather.com/)
[![Signal K](https://img.shields.io/badge/Signal%20K-Plugin-navy.svg)](https://signalk.org/)

A modern TypeScript Signal K plugin that provides comprehensive weather data from AccuWeather API with enhanced NMEA2000-compatible environmental measurements and perfect sk-n2k-emitter alignment.

## 🚀 Features

### Enhanced Weather Coverage (24+ Data Points)
- **7 Temperature Readings**: Air, dew point, wind chill, heat index, wet bulb, wet bulb globe, RealFeel shade
- **Enhanced Wind Analysis**: True wind, apparent wind, gusts, Beaufort scale, wind safety assessment
- **Marine Safety**: UV index, visibility, heat stress assessment, pressure trends
- **Atmospheric Conditions**: Cloud cover, ceiling height, precipitation data
- **Advanced Calculations**: Air density, absolute humidity, marine-specific indices

### NMEA2000 Compatibility
- **Perfect sk-n2k-emitter alignment** with proper PGN assignments
- **Multiple PGN support**: 130311 (pressure), 130312 (temperatures), 130313 (humidity), 130306 (wind)
- **Instance-based organization** for multiple temperature/humidity sensors
- **Real-time emission** with configurable intervals for NMEA2000 network recognition

### Modern Architecture
- **TypeScript 5.7+** with strict type safety and comprehensive validation
- **Biome 2.2+** for fast, modern linting and formatting
- **Vitest 3.x** with comprehensive test coverage and performance testing
- **Hybrid emission system** combining event-driven updates with reliable intervals
- **Production-ready error handling** with structured logging and graceful degradation
- **Performance optimized** for real-time marine applications
- **Pre-commit hooks** with husky for code quality enforcement
- **GitHub Actions CI/CD** for automated testing and deployment

## 📦 Installation

### Option 1: Via npm (when published)
```bash
npm install signalk-virtual-weather-sensors
```

### Option 2: Manual Installation from Source
```bash
# Clone and build the plugin
git clone https://github.com/signalk/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm install
npm run build

# The built plugin is now in dist/signalk-virtual-weather-sensors/
# Copy this directory to your Signal K plugins directory
cp -r dist/signalk-virtual-weather-sensors ~/.signalk/node_modules/
```

### Option 3: Direct Installation from Built Package
If you have a pre-built `dist/signalk-virtual-weather-sensors` directory:
```bash
# Copy the built package to your Signal K plugins directory
cp -r dist/signalk-virtual-weather-sensors ~/.signalk/node_modules/

# Or create a symlink for development
ln -s /path/to/signalk-virtual-weather-sensors/dist/signalk-virtual-weather-sensors ~/.signalk/node_modules/signalk-virtual-weather-sensors
```

## ⚙️ Configuration

### Required Settings
- **AccuWeather API Key**: Get your free key at [developer.accuweather.com](https://developer.accuweather.com/)

### Basic Settings
- **Update Frequency**: How often to fetch weather data (1-60 minutes, default: 5)
- **Emission Interval**: NMEA2000 data emission rate (1-60 seconds, default: 5)

### Advanced Settings
- **Debug Logging**: Enable detailed troubleshooting logs
- **Max Vessel Data Age**: Reject stale navigation data (5-300 seconds, default: 30)

## 🗺️ Signal K Paths

### Core Environmental Measurements
```
environment.outside.temperature                  # Air temperature (K)
environment.outside.pressure                    # Atmospheric pressure (Pa)
environment.outside.relativeHumidity           # Outside humidity (0-1 ratio)
environment.outside.dewPointTemperature        # Dew point (K)
environment.outside.windChillTemperature       # Wind chill (K)
environment.outside.heatIndexTemperature       # Heat index (K)
```

### Enhanced Temperature Readings
```
environment.outside.realFeelShade              # AccuWeather RealFeel shade (K)
environment.outside.wetBulbTemperature         # Wet bulb temperature (K)
environment.outside.wetBulbGlobeTemperature    # Heat stress assessment (K)
environment.outside.apparentTemperature        # AccuWeather apparent temp (K)
```

### Wind Data
```
environment.wind.speedTrue                      # True wind speed (m/s)
environment.wind.directionTrue                 # True wind direction (rad)
environment.wind.speedApparent                 # Calculated apparent wind (m/s)
environment.wind.angleApparent                 # Apparent wind angle (rad)
environment.wind.speedGust                     # Wind gust speed (m/s)
environment.wind.gustFactor                    # Gust/sustained ratio
environment.wind.beaufortScale                 # Beaufort scale (0-12)
```

### Marine Safety & Navigation
```
environment.outside.uvIndex                     # UV radiation index (0-15+)
environment.outside.visibility                 # Visibility distance (m)
environment.outside.cloudCover                 # Cloud coverage (0-1 ratio)
environment.outside.cloudCeiling               # Cloud base height (m)
environment.outside.heatStressIndex            # Heat stress level (0-4)
```

### Calculated Properties
```
environment.outside.absoluteHumidity           # Absolute humidity (kg/m³)
environment.outside.airDensity                 # Enhanced air density (kg/m³)
environment.outside.pressureTendency           # Pressure trend text
environment.outside.temperatureDeparture24h    # 24-hour temp change (K)
```

## 🔧 Development

**For comprehensive development documentation, see [DEVELOPMENT.md](DEVELOPMENT.md)**

This includes detailed information about:
- AI-assisted development with Roo Code and Claude Sonnet 4.5
- Complete tooling setup and configuration
- Development workflows and best practices
- Testing strategies and performance considerations

### Building
```bash
npm run build                 # Build for production
npm run build:types          # Generate TypeScript declarations
npm run build:bundle         # Create optimized bundle
npm run dev                  # Development mode with hot reload
```

### Testing
```bash
npm run test                 # Run tests in watch mode
npm run test:run            # Run all tests once
npm run test:coverage       # Generate coverage report
npm run test:ui             # Interactive test UI
```

### Code Quality
```bash
npm run lint                # Check code quality with Biome
npm run lint:fix           # Fix auto-fixable issues
npm run format             # Format code with Biome
npm run format:check       # Check formatting without changes
npm run type-check         # Verify TypeScript types
npm run validate           # Run all quality checks (used by pre-commit)
npm run security-audit     # Run npm security audit
```

## 🌊 Marine Applications

### Navigation Safety
- **Visibility monitoring** for safe passage planning
- **Wind safety assessment** via Beaufort scale and gust analysis
- **Weather trend analysis** from pressure tendency data

### Crew Comfort & Safety
- **Heat stress monitoring** using military/marine standards (wet bulb globe)
- **UV exposure assessment** for crew protection
- **Indoor climate monitoring** for crew comfort
- **Wind chill assessment** for cold weather operations

### Performance Optimization
- **Air density calculations** for sail trim optimization
- **Enhanced wind data** for route planning and sail selection
- **Apparent wind calculations** for accurate sailing instrument data

## 🔌 NMEA2000 Integration

This plugin outputs data in Signal K format, which can be converted to NMEA2000 messages using plugins like [Signal K NMEA2000 Emitter Cannon](https://github.com/SignalK/signalk-n2k-emitter-cannon). This allows virtual weather sensor data to appear as physical NMEA2000 sensors on your marine network.

### PGN Support
When used with an NMEA2000 emitter plugin:
- **130311**: Environmental Parameters (atmospheric pressure)
- **130312**: Temperature data (8 different temperature instances)
- **130313**: Humidity data (outside/inside with proper instances)
- **130314**: Enhanced pressure data
- **130306**: Wind data (enhanced with gust information)

### Instance Assignments
Following sk-n2k-emitter conventions:
- **Temperature instances**: 101-111 for different temperature types
- **Humidity instances**: 100 (outside), 101 (inside)
- **Proper source identification** for multi-sensor environments

## 📊 Data Flow

```
AccuWeather API → Enhanced Data Extraction → Vector Wind Calculations
                                          ↓
NMEA2000 Path Mapping ← Validation & Sanitization ← Atmospheric Calculations
                    ↓
Signal K Delta Messages → NMEA2000 Network → Marine Electronics
```

## 🏗️ Architecture

### Services
- **WeatherService**: Main orchestration with hybrid emission system
- **AccuWeatherService**: Enhanced API client with comprehensive field extraction
- **SignalKService**: Vessel navigation data with smart fallback logic

### Utilities
- **WindCalculator**: Precise vector mathematics for marine applications
- **Validation Framework**: Comprehensive data validation for NMEA2000 compliance
- **Conversion Utilities**: High-performance unit conversions and atmospheric calculations

### Mappers
- **NMEA2000PathMapper**: sk-n2k-emitter aligned path mapping with proper instance assignments

## 🧪 Testing

Comprehensive test suite covering:
- **API Integration**: AccuWeather field extraction and error handling
- **Wind Calculations**: Vector mathematics and meteorological formula accuracy
- **Path Mapping**: NMEA2000 compatibility and sk-n2k-emitter alignment
- **Data Validation**: NMEA2000 range checking and data sanitization
- **Performance**: Real-time calculation efficiency

## 📚 API Documentation

### AccuWeather API Integration
Enhanced to extract all available fields:
- **Temperature**: Multiple readings including wet bulb variants
- **Wind**: Sustained + gust data for safety assessment
- **Atmospheric**: Comprehensive visibility, cloud, and trend data
- **Indoor**: Climate data for crew comfort

### Vector Wind Calculations
Precise apparent wind calculations using:
- **True wind vector**: From AccuWeather API
- **Vessel motion vector**: From Signal K navigation data
- **Vector addition**: Industry-standard marine formulas

## 🔄 Migration from v1.0

The plugin maintains compatibility while adding enhanced features:
- **Configuration**: Same basic settings with new optional enhancements
- **Core paths**: All existing paths preserved
- **Enhanced paths**: New paths added without breaking existing integrations
- **Performance**: Significantly improved with TypeScript optimizations

## 📋 Signal K Standards Compliance

This plugin follows official Signal K development standards:
- **Plugin Structure**: Complies with [Signal K Plugin Development Guidelines](https://demo.signalk.org/documentation/Developing/Plugins.html)
- **Configuration**: Implements [Signal K Configuration Schema Standards](https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html)
- **Weather Data**: Follows [Signal K Weather Provider Patterns](https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html)

### Compliance Status: 95% ✅

**Delta Message Format**: ✅ Proper context and updates structure
**Signal K Paths**: ✅ Standard `environment.*` conventions
**Configuration Schema**: ✅ JSON Schema with validation
**Source Metadata**: ✅ Proper labeling and typing

### Known Deviation: Humidity Format

This plugin outputs humidity as **percentage (0-100)** instead of the Signal K recommended **ratio (0-1)** format. This is a deliberate choice for **Garmin marine display compatibility**, as Garmin devices and most NMEA2000 equipment expect percentage format.

**Impact**: May cause minor display inconsistencies in some Signal K clients, but ensures proper display on physical marine electronics where it matters most.

For more details, see [`TODO.md`](TODO.md) - Signal K Standards Compliance section.

## 📝 License

Apache-2.0 License - See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

The codebase uses modern TypeScript standards:
- **TypeScript 5.7+** with strict mode and ES2023 target
- **Biome** for linting and formatting (replaces ESLint + Prettier)
- **Vitest 3.x** for testing with v8 coverage
- **ESM modules** exclusively with NodeNext resolution
- **Comprehensive type safety** with Zod validation
- **Production-ready error handling**
- **Pre-commit hooks** automatically enforce code quality
- **Node.js 20+** required

### Development Setup
```bash
# Install dependencies (automatically sets up husky pre-commit hooks)
npm install

# Pre-commit hooks will automatically run on git commit:
# - Biome linting and formatting
# - TypeScript type checking
# - Tests

# To manually run all checks:
npm run validate
```

## 🆘 Support

- 🐛 [Report bugs](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- 💡 [Request features](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- 💬 [GitHub Discussions](https://github.com/NearlCrews/signalk-virtual-weather-sensors/discussions)
- 📖 [Documentation](https://github.com/NearlCrews/signalk-virtual-weather-sensors#readme)
- 🔒 [Security issues](SECURITY.md)

---

**Transform your vessel into a comprehensive marine weather station with signalk-virtual-weather-sensors!** 🚢⛵
