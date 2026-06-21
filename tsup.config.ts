import {defineConfig} from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    cli: 'cli/init.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: false,
  // React/React-Router are provided by the host Hydrogen app.
  external: ['react', 'react/jsx-runtime', 'react-router'],
});
