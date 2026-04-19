import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'es2023',
  format: 'esm',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  minifyWhitespace: true,
  minifyIdentifiers: process.env.NODE_ENV === 'production',
  minifySyntax: true,
  treeShaking: true,
  splitting: false,
  metafile: true,
  legalComments: 'none',

  // External dependencies - don't bundle these
  external: [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
    // Node.js built-ins
    'node:*',
    'fs',
    'path',
    'url',
    'events',
    'util',
    'stream',
    'crypto',
    'os',
    'http',
    'https',
  ],

  // Define globals for better error messages
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.PKG_NAME': JSON.stringify(packageJson.name),
    'process.env.PKG_VERSION': JSON.stringify(packageJson.version),
  },

  // Banner for Signal K plugin compatibility
  banner: {
    js: `
// signalk-virtual-weather-sensors - Signal K Weather Plugin
// Generated: ${new Date().toISOString()}
// Version: ${packageJson.version}
// Target: ES2023 | Node.js 20+
`.trim(),
  },

  // Better error reporting
  logLevel: 'info',
  color: true,
  
  // Performance optimizations
  charset: 'utf8',
  keepNames: false,
};

try {
  console.log('🏗️  Building Signal K Virtual Weather Sensors plugin...');
  console.log(`Target: ${config.target} | Format: ${config.format}`);
  
  const result = await build(config);

  if (result.errors.length > 0) {
    console.error('❌ Build failed with errors:');
    for (const error of result.errors) {
      console.error(error);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  Build completed with warnings:');
    for (const warning of result.warnings) {
      console.warn(warning);
    }
  }

  // Analyze bundle size
  if (result.metafile) {
    const outputSize = Object.values(result.metafile.outputs).reduce(
      (acc, output) => acc + output.bytes,
      0
    );
    console.log(`📊 Bundle size: ${(outputSize / 1024).toFixed(2)} KB`);
  }

  console.log('✅ Build completed successfully!');
  console.log(`📦 Output: ${config.outfile}`);
  console.log(`🗺️  Source map: ${config.outfile}.map`);
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
