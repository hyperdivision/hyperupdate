const getSocketPath = require('./lib/socket-path')
const HRPC = require('./lib/rpc')
const { EventEmitter } = require('events')

module.exports = class UpdaterClient extends EventEmitter {
  constructor (name) {
    super()

    this.socketPath = getSocketPath(name)
    this.client = HRPC.connect(this.socketPath)
    this.latestRelease = null
    this.version = null
    this.updateAvailable = false
    this.updateDownloaded = false
    this.updateDownloading = false

    this.client.updater.onRequest({ onUpdateStatus: (s) => this._update(s) })

    this.ready().catch((err) => this.emit('error', err))
  }

  _update (s) {
    const wasDownloaded = this.updateDownloaded
    const wasAvailable = this.updateAvailable
    const wasDownloading = this.updateDownloading

    this.version = s.version
    this.latestRelease = s.latestRelease
    this.updateAvailable = s.updateAvailable
    this.updateDownloaded = s.updateDownloaded
    this.updateDownloading = s.updateDownloading

    if (!wasAvailable && this.updateAvailable) {
      this.emit('update-available')
    }
    if (!wasDownloading && this.updateDownloading) {
      this.emit('update-downloading')
    }
    if (!wasDownloaded && this.updateDownloaded) {
      this.emit('update-downloaded')
    }
  }

  async ready () {
    if (!this.version) {
      this._update(await this.client.updater.status())
      this.emit('ready')
    }
  }

  updateAndRelaunch () {
    return this.client.updater.updateAndRelaunch()
  }

  downloadUpdate () {
    return this.client.updater.downloadUpdate()
  }

  nextUpdate () {
    return this.client.updater.nextUpdate()
  }
}
