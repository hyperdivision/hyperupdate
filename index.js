const Releaser = require('./lib/releaser')
const replicator = require('@hyperswarm/replicator')
const { EventEmitter } = require('events')
const HRPC = require('./lib/rpc')
const electron = require('./lib/electron')
const getSocketPath = require('./lib/socket-path')
const Client = require('./client')
const path = require('path')

class Upgrader extends EventEmitter {
  constructor (opts = {}) {
    super()

    const key = opts[process.platform]
    if (!key) throw new Error('Must pass a release config')

    const storage = opts.storage || path.join(opts.userData || electron.userData, 'hyperupdate', key.toString('hex'))

    this.name = opts.name || null
    this.appPath = opts.appPath || electron.appPath
    this.version = opts.version || electron.appVersion || '0.0.0'
    this.isPackaged = opts.isPackaged || electron.isPackaged
    this.releaser = this.isPackaged ? new Releaser(storage, key) : null
    this.autoQuit = opts.autoQuit !== false
    this.execPath = opts.execPath || electron.execPath
    this.argv = opts.argv || electron.argv
    this.latestRelease = { version: this.version }
    this.updateAvailable = false
    this.updateDownloaded = false
    this.updateDownloading = false
    this.swarm = null
    this.server = null
    this.closing = false
    this.clients = new Set()

    if (this.releaser) this._checkLatestVersion()
    this._autoClose = () => this.close()
    this._cancelDownload = (fn) => fn()

    if (electron.isRemote) window.addEventListener('beforeunload', this._autoClose)
  }

  listen () {
    if (this.server) throw new Error('Already listening')

    const self = this
    this.server = HRPC.createServer(client => {
      this.clients.add(client)
      client.on('close', () => this.clients.delete(client))

      client.updater.onRequest({
        status (req) {
          return self
        },
        updateAndRelaunch (req) {
          return self.updateAndRelaunch()
        },
        downloadUpdate (req) {
          return self.downloadUpdate()
        },
        nextUpdate (req) {
          return self.nextUpdate()
        }
      })
    })

    return this.server.listen(getSocketPath(this.name))
  }

  static connect (name) {
    return new Client(name)
  }

  nextUpdate () {
    return new Promise((resolve, reject) => {
      const onupdate = () => {
        this.removeListener('closing', onclosing)
        this.removeListener('update-available', onupdate)
        resolve(this.latestRelease)
      }
      const onclosing = () => {
        this.removeListener('closing', onclosing)
        this.removeListener('update-available', onupdate)
        reject(new Error('Closing'))
      }

      this.on('update-available', onupdate)
      this.on('closing', onclosing)
    })
  }

  updateAndRelaunch () {
    return new Promise((resolve, reject) => {
      if (!this.updateAvailable) throw new Error('No update available')
      if (!this.updateDownloaded) throw new Error('Update not downloaded')
      if (!this.isPackaged) throw new Error('App is not packaged')

      this.releaser.upgrade(this.latestRelease, this.appPath, this.execPath, this.argv.slice(1), (err) => {
        if (err) return reject(err)
        if (this.autoQuit) electron.quit()
        resolve()
      })
    })
  }

  isUpdateDownloaded () {
    return new Promise((resolve, reject) => {
      this.releaser.isDownloaded(this.latestRelease, (err, yes) => {
        if (err) return reject(err)
        resolve(yes)
      })
    })
  }

  downloadUpdate () {
    return new Promise((resolve, reject) => {
      const oncancelled = () => {
        if (prev !== this._cancelDownload) { // parallel download
          prev = this._cancelDownload
          this._cancelDownload(oncancelled)
          return
        }

        this.updateDownloading = true
        this._onUpdate('downloading')
        this._cancelDownload = this.releaser.downloadRelease(this.latestRelease, (err) => {
          if (prev !== this._cancelDownload) return reject(new Error('Download was cancelled'))
          this.updateDownloading = false
          if (err) return reject(err)
          this.updateDownloaded = true
          this._onUpdate('downloaded')
          resolve()
        })
        prev = this._cancelDownload
      }

      let prev = this._cancelDownload
      this._cancelDownload(oncancelled)
    })
  }

  close () {
    if (!this.closing) {
      this.closing = true
      this.emit('closing')
    }

    if (electron.isRemote) window.removeEventListener('beforeunload', this._autoClose)
    if (this.swarm) this.swarm.destroy()

    return new Promise((resolve, reject) => {
      if (!this.releaser) return resolve()
      this.releaser.close((err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  _startSwarm () {
    this.releaser.hasUpgraded((_, yes) => {
      if (this.closing) return

      this.swarm = replicator(this.releaser, {
        announceLocalAddress: true,
        lookup: true,
        announce: yes
      })

      this._checkLatestVersion()
    })
  }

  _checkLatestVersion () {
    if (this.closing) return
    if (this.updateDownloading || this.updateDownloaded) return
    if (!this.swarm) return this._startSwarm()

    this.releaser.getLatestReleaseInfo((_, release) => {
      if (this.closing) return
      if (this.updateDownloading || this.updateDownloaded) return

      if (!release || !newer(this.latestRelease, release)) {
        this.releaser.update(() => this._checkLatestVersion())
        return
      }

      this.latestRelease = release
      this.updateAvailable = true
      this._onUpdate('available')

      this._checkLatestVersion()
    })
  }

  _onUpdate (name) {
    this.emit('update-' + name)
    for (const client of this.clients) {
      client.updater.onUpdateStatus(this)
    }
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
