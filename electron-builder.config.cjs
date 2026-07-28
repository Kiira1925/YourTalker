const updateUrl = process.env.YOURTALKER_UPDATE_URL?.trim() || 'https://updates.invalid/yourtalker'
const [githubOwner, githubRepo] = (process.env.GITHUB_REPOSITORY?.trim() || '').split('/')
const publish = githubOwner && githubRepo
  ? {
      provider: 'github',
      owner: githubOwner,
      repo: githubRepo,
      releaseType: 'draft'
    }
  : {
      provider: 'generic',
      url: updateUrl
    }

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'jp.yourtalker.app',
  productName: 'YourTalker',
  asar: true,
  directories: {
    output: 'release'
  },
  files: ['out/**/*', 'package.json'],
  publish: [publish],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    artifactName: '${productName}-Setup-${version}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    differentialPackage: true
  }
}
