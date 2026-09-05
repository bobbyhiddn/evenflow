import { build } from 'esbuild'

// Compile the TypeScript test and its source imports in memory. No additional
// runtime dependency or generated test files are needed beside the Vite toolchain.
const result = await build({ entryPoints: ['test/core.test.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
