const path = require('path')

let electron = null
let isRemote = false

try {
  electron = require('electron')
  if (typeof electron === 'string') electron = null
  else if (electron.remote) {
    electron = electron.remote
    isRemote = true
  }
} catch (_) {}

exports.isElectron = !!electron
exports.isRemote = isRemote
exports.isPackaged = false
exports.appVersion = electron && electron.app.getVersion()
exports.appPath = process.cwd()
exports.userData = electron && electron.app.getPath('userData')
exports.execPath = isRemote ? electron && electron.process.execPath : process.execPath
exports.argv = isRemote ? electron && electron.process.argv : process.argv
exports.quit = () => electron && electron.app.quit()

if (electron) {
  const appPath = electron.app.getAppPath()
  if (appPath.indexOf('app.asar') > -1) {
    switch (process.platform) {
      case 'linux':
      case 'win32':
        exports.isPackaged = true
        exports.appPath = path.join(appPath, '../..')
        break
      case 'darwin':
        exports.isPackaged = true
        exports.appPath = path.join(appPath, '../../..')
        break
    }
  }
}
