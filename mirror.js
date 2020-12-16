#!/usr/bin/env node

const Corestore = require('corestore')
const Networker = require('@corestore/networker')
const { Header } = require('./lib/messages')

const keys = process.argv.slice(2).filter(k => /^[0-9a-fA-F]{64}$/.test(k)).map(k => Buffer.from(k, 'hex'))
const store = new Corestore('./hyperupdate-mirror')

const down = { releases: 0, chunks: 0 }
const up = { releases: 0, chunks: 0 }

store.ready(function () {
  const network = new Networker(store)
  const feeds = keys.map(k => store.get(k))

  for (const feed of feeds) {
    console.log('Mirroring release feed: ' + feed.key.toString('hex'))
    network.configure(feed.discoveryKey, { announce: true, lookup: true })
    feed.download({ start: 0, end: -1 })
    feed.on('download', () => down.releases++)
    feed.on('upload', () => up.releases++)
    feed.get(0, { ifAvailable: false, wait: true }, function (_, data) {
      if (!data) return
      const c = parseChunkFeed(data)
      if (!c) return
      const chunkFeed = store.get(c)
      console.log('Mirroring chunk feed: ' + c.toString('hex'))
      chunkFeed.download({ start: 0, end: -1 })
      chunkFeed.on('download', () => down.chunks++)
      chunkFeed.on('upload', () => up.chunks++)
    })
  }
})

function parseChunkFeed (data) {
  try {
    const h = Header.decode(data)
    if (h.protocol === 'hyperupdate') return h.chunkFeed
  } catch (_) {
    return null
  }
}

setInterval(function () {
  console.log('Current stats', { down, up })
}, 5000).unref()
