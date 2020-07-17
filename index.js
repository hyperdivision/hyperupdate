const Releaser = require('./lib/releaser')
const replicator = require('@hyperswarm/replicator')
const { EventEmitter } = require('events')
const path = require('path')

let isRemote = false
let electron = require('electron')

if (electron.remote) {
  electron = electron.remote
  isRemote = true
}

class Upgrader extends EventEmitter {
  constructor (keys, opts = {}) {
    super()

    const key = keys[process.platform]
    if (!key) throw new Error('Must pass a release config')

    const storage = opts.storage || path.join(electron.app.getPath('userData'), 'hyperupdate', key.toString('hex'))

    this.version = opts.version || electron.app.getVersion()
    this.releaser = Upgrader.isPackaged() ? new Releaser(storage, key) : null
    this.latestRelease = { version: this.version }
    this.updateAvailable = false
    this.updateDownloaded = false
    this.downloadingUpdate = false
    this.swarm = null
    this.closing = false

    if (this.releaser) this._checkLatestVersion()
    this._autoClose = () => this.close()

    if (isRemote) window.addEventListener('beforeunload', this._autoClose)
  }

  updateAndRelaunch () {
    if (!this.updateAvailable) throw new Error('No update available')
    if (!this.updateDownloaded) throw new Error('Update not downloaded')

    const { execPath, argv } = electron.process
    const appPath = Upgrader.appPath()

    if (!appPath) throw new Error('App is not packaged')

    this.releaser.upgrade(this.latestRelease, appPath, execPath, argv.slice(1), (err) => {
      if (err) return this.emit('error', err)
      electron.app.quit()
    })
  }

  static isPackaged () {
    return !!Upgrader.appPath()
  }

  static appPath () {
    const appPath = electron.app.getAppPath()
    if (appPath.indexOf('app.asar') === -1) return null

    switch (process.platform) {
      case 'linux':
      case 'win32':
        return path.join(appPath, '../..')
      case 'darwin':
        return path.join(appPath, '../../..')
    }

    throw new Error('Unsupported platform')
  }

  close (cb = noop) {
    this.closing = true
    if (isRemote) window.removeEventListener('beforeunload', this._autoClose)
    if (this.swarm) this.swarm.destroy()
    if (this.releaser) this.releaser.close(cb)
    else process.nextTick(cb)
  }

  _startSwarm () {
    this.releaser.hasUpgraded((_, yes) => {
      if (this.closing) return

      this.swarm = replicator(this.releaser, {
        lookup: true,
        announce: yes
      })

      this._checkLatestVersion()
    })
  }

  _checkLatestVersion () {
    if (this.closing) return
    if (this.updateAvailable) return
    if (!this.swarm) return this._startSwarm()

    this.releaser.getLatestReleaseInfo((_, release) => {
      if (this.closing) return

      if (!release || !newer(this.latestRelease, release)) {
        this.releaser.update(() => this._checkLatestVersion())
        return
      }

      this.latestRelease = release
      this.updateAvailable = true
      this.emit('update-available')

      this.downloadingUpdate = true
      this.emit('update-downloading')
      this.releaser.downloadRelease(this.latestRelease, (err) => {
        if (err) return this.emit('error', err)
        this.downloadingUpdate = false
        this.updateDownloaded = true
        this.emit('update-downloaded')
      })
    })
  }
}

module.exports = Upgrader

function newer (old, cur) {
  const a = old.version.split('.').map(n => Number(n))
  const b = cur.version.split('.').map(n => Number(n))

  if (a[0] < b[0]) return true
  if (a[0] > b[0]) return false
  if (a[1] < b[1]) return true
  if (a[1] > b[1]) return false

  return a[2] < b[2]
}

function noop () {}
