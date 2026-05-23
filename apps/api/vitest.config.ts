import { resolve } from 'path'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { createVitestConfig } from '../../vitest.base'

export default createVitestConfig({
    name: '@reputo/api',
    include: ['tests/**/*.unit.spec.ts'],
    coverageInclude: ['src/**/*.ts'],
    coverageExclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/dto/*.ts',
        'src/config/*.ts',
    ],
    plugins: [
        swc.vite({
            module: { type: 'es6' },
        }),
        tsconfigPaths(),
    ],
    resolve: {
        alias: {
            src: resolve(__dirname, './src'),
            '@reputo/contracts': resolve(
                __dirname,
                '../../packages/contracts/src/index.ts'
            ),
            '@reputo/reputation-algorithms': resolve(
                __dirname,
                '../../packages/reputation-algorithms/src/index.ts'
            ),
            '@reputo/storage': resolve(
                __dirname,
                '../../packages/storage/src/index.ts'
            ),
            '@reputo/algorithm-validator': resolve(
                __dirname,
                '../../packages/algorithm-validator/src/index.ts'
            ),
        },
    },
})
