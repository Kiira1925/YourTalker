import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const updateFeedUrl = process.env.YOURTALKER_UPDATE_URL?.trim() ?? ''
const githubRepository = process.env.GITHUB_REPOSITORY?.trim() ?? ''
const [githubOwner = '', githubRepo = ''] = githubRepository.split('/')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __YOURTALKER_UPDATE_URL__: JSON.stringify(updateFeedUrl),
      __YOURTALKER_GITHUB_OWNER__: JSON.stringify(githubOwner),
      __YOURTALKER_GITHUB_REPO__: JSON.stringify(githubRepo)
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()]
  }
})
