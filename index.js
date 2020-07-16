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

module.exports = class Upgrader extends EventEmitter {
  constructor (keys, opts = {}) {
    super()

    const key = keys[process.platform]
    if (!key) throw new Error('Must pass a release config')

    const storage = opts.storage || path.join(electron.app.getPath('userData'), 'hyperupdate', key.toString('hex'))

    this.version = opts.version || electron.app.getVersion()
    this.releaser = new Releaser(storage, key)
    this.latestRelease = { version: this.version }
    this.updateAvailable = false
    this.updateDownloaded = false
    this.downloadingUpdate = false
    this.swarm = null
    this.closing = false

    this._checkLatestVersion()
    this._autoClose = () => this.close()

    if (isRemote) window.addEventListener('beforeunload', this._autoClose)
  }

  updateAndRelaunch () {
    if (!this.updateAvailable) throw new Error('No update available')
    if (!this.updateDownloaded) throw new Error('Update not downloaded')

    const { execPath, argv } = electron.process
    const appPath = electron.app.getAppPath()

    this.releaser.upgrade(this.latestRelease, appPath, execPath, argv, (err) => {
      if (err) return this.emit('error', err)
      electron.app.quit()
    })
  }

  close (cb) {
    this.closing = true
    if (isRemote) window.removeEventListener('beforeunload', this._autoClose)
    if (this.swarm) this.swarm.destroy()
    this.releaser.close(cb)
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