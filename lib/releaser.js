const pack = require('./pack')
const { Header, Release } = require('./messages')
const RabinStream = require('rabin-stream')
const fs = requireFS()
const lock = require('fd-lock')
const pump = require('pump')
const hypercore = require('hypercore')
const sodium = require('sodium-native')
const hypertrie = require('hypertrie')
const path = require('path')
const { Readable } = require('streamx')
const { Node } = require('hypertrie/lib/messages')
const tar = require('tar-fs')
const { execFile } = require('child_process')
const thunky = require('thunky')

const UPGRADER = path.join(__dirname, 'spawn.js')

module.exports = class Releaser {
  constructor (storage, key = null) {
    this.storage = storage
    this.chunks = key ? null : hypertrie(storage + '/chunks', key, { sparse: true })
    this.releases = hypercore(storage + '/releases', key, { sparse: true })

    this.upgrading = path.join(storage, 'upgrading')
    this.unpacked = path.join(storage, 'latest-unpacked')
    this.key = null
    this.discoveryKey = null
    this.ready(noop)

    this._getChunks = thunky((cb) => {
      if (this.chunks) return this.chunks.ready(cb)
      this.releases.get(0, { wait: true, ifAvailable: false, valueEncoding: Header }, (err, header) => {
        if (err) return cb(err)
        this.chunks = hypertrie(storage + '/chunks', header.chunkFeed, { sparse: true })
        this.chunks.ready(cb)
      })
    })
  }

  replicate (isInitiator, opts) {
    if (typeof isInitiator === 'object' && isInitiator && !isInitiator.pipe) {
      opts = isInitiator
      isInitiator = !!opts.initiator
    }

    const stream = this.releases.replicate(isInitiator, { ...opts, live: true })

    this._getChunks((err) => {
      if (err) return stream.destroy(err)
      this.chunks.replicate(isInitiator, { ...opts, stream, live: true })
    })

    return stream
  }

  ready (cb) {
    this.releases.ready((err) => {
      if (err) return cb(err)
      this.key = this.releases.key
      this.discoveryKey = this.releases.discoveryKey
      cb(null)
    })
  }

  update (cb) {
    this.releases.update({ hash: false, ifAvailable: false }, () => this.getLatestReleaseInfo(cb))
  }

  getReleaseInfo (seq, cb) {
    this.releases.get(seq, { valueEncoding: Release }, cb)
  }

  getLatestReleaseInfo (cb) {
    this.releases.update({ ifAvailable: true, hash: false }, () => {
      if (!this.releases.length) return cb(null, null)
      this.releases.get(this.releases.length - 1, { valueEncoding: Release }, cb)
    })
  }

  hasUpgraded (cb) {
    this.stat(this.upgrading, (_, st) => {
      cb(null, !!st)
    })
  }

  downloadRelease (release, cb) {
    this._getChunks(err => {
      if (err) return cb(err)
      this.chunks.feed.download(release.chunks)
      this.unpackRelease(release, cb)
    })
  }

  upgrade (release, appPath, execPath, argv, cb) {
    this._getChunks(err => {
      if (err) return cb(err)

      this._setUpgrading((err) => {
        if (err) return cb(err)

        execFile(process.execPath, [UPGRADER, this.upgrading, this.unpacked, appPath, execPath, ...argv], { detached: true, stdio: 'ignore' }, noop)
        setTimeout(cb, 100) // unsure if this is nessesary, but oh well
      })
    })
  }

  unpackRelease (release, cb) {
    const rs = this.createReleaseStream(release)

    rimraf(this.unpacked, (err) => {
      if (err) return cb(err)

      pump(rs, tar.extract(this.unpacked, { map, fs }), (err) => {
        if (err) return cb(err)
        cb(null, this.unpacked)
      })

      function map (header) {
        header.mtime = header.ctime = new Date()
        return header
      }
    })
  }

  _setUpgrading (cb) {
    fs.open(this.upgrading, 'w+', function (err, fd) {
      if (err) return cb(err)
      if (!lock(fd)) return cb(new Error('Upgrade in progress'))
      cb(null)
    })
  }

  createReleaseStream (release) {
    const self = this
    let i = 0
    let pending = null

    return new Readable({
      open (cb) {
        self._getChunks(cb)
      },

      read (cb) {
        if (i >= release.chunks.length) {
          this.push(null)
          return cb(null)
        }

        pending = self.chunks.feed.get(release.chunks[i++], { wait: true, ifAvailable: false }, (err, data) => {
          pending = null
          if (err) return cb(err)
          const { valueBuffer } = Node.decode(data)
          this.push(valueBuffer)
          cb(null)
        })
      },

      destroy (cb) {
        if (pending) self.chunks.feed.cancel(pending)
        cb(null)
      }
    })
  }

  addRelease (path, r, cb) {
    this._getChunks((err) => {
      if (err) return cb(err)

      this.releases.ready((err) => {
        if (err) return cb(err)

        if (!this.releases.length) this.releases.append(Header.encode({ protocol: 'hyperupdate', chunkFeed: this.chunks.key }))
        this._addRelease(path, r, cb)
      })
    })
  }

  close (cb) {
    if (!cb) cb = noop

    if (this.chunks) this.chunks.feed.close()
    this.releases.close(() => {
      if (this.chunks) return this.chunks.feed.close(cb)
      else cb()
    })
  }

  _addRelease (path, r, cb) {
    if (!cb) cb = () => {}

    chunk(path, (err, buffers) => {
      if (err) return cb(err)

      let diffLength = 0
      let byteLength = 0
      let i = 0
      let dedup = 0
      const chunks = []

      const condition = (oldNode, newNode, cb) => {
        if (!oldNode) diffLength += newNode.value.byteLength
        dedup = oldNode ? oldNode.seq : 0
        return cb(null, !oldNode)
      }

      const loop = (err, node) => {
        if (err) return cb(err)
        if (node || dedup) chunks.push(dedup || node.seq)
        if (i >= buffers.length) {
          const res = {
            ...r,
            diffLength,
            byteLength,
            chunks
          }
          this.releases.append(Release.encode(res), (err, seq) => {
            if (err) return cb(err)
            cb(null, res, seq)
          })
          return
        }
        const buf = buffers[i++]
        byteLength += buf.byteLength
        const out = Buffer.alloc(32)
        sodium.crypto_generichash(out, buf)
        this.chunks.put(out.toString('hex'), buf, { condition }, loop)
      }

      loop(null, null)
    })
  }
}

function chunk (input, cb) {
  fs.stat(input, function (err, st) {
    if (err) return cb(err)

    const r = new RabinStream({
      min: 4 * 1024,
      max: 512 * 1024,
      bits: 25
    })

    const chunks = []
    let ended = false

    r.on('data', function (data) {
      chunks.push(data)
    })
    r.on('end', function () {
      ended = true
    })
    r.on('error', function (err) {
      cb(err)
    })
    r.on('close', function () {
      if (ended) cb(null, chunks)
    })

    const s = st.isDirectory() ? pack(input) : fs.createReadStream(input)
    pump(s, r)
  })
}

function rimraf (folder, cb) {
  fs.lstat(folder, (err, st) => {
    if (err || !st) return cb(null)
    if (!st.isDirectory()) return fs.unlink(folder, cb)
    fs.readdir(folder, (err, names) => {
      if (err) return cb(err)

      loop(null)

      function loop (err) {
        if (err) return cb(err)
        if (!names.length) return fs.rmdir(folder, cb)
        rimraf(path.join(folder, names.pop()), loop)
      }
    })
  })
}

function requireFS () {
  try {
    return require('original-fs')
  } catch (_) {
    return require('fs')
  }
}

function noop () {}