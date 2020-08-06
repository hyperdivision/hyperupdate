#!/usr/bin/env node

const Releaser = require('./lib/releaser')
const path = require('path')
const replicator = require('@hyperswarm/replicator')

if (!process.argv[2]) {
  const a = new Releaser('./hyperupdate/darwin')
  const b = new Releaser('./hyperupdate/linux')
  const c = new Releaser('./hyperupdate/win32')

  a.ready(function () {
    b.ready(function () {
      c.ready(function () {
        console.log('Hyperupdate release config:')
        console.log({
          darwin: a.key.toString('hex'),
          linux: b.key.toString('hex'),
          win32: c.key.toString('hex')
        })
      })
    })
  })
  return
}

const { platform, version, folder } = parse(process.argv[2])

const r = new Releaser('./hyperupdate/' + platform)

r.ready(function () {
  console.log('Hyperupdate ' + platform + ' key: ' + r.key.toString('hex'))
  console.log('Adding release....')
  r.getLatestReleaseInfo(function (err, release) {
    if (err) throw err

    if (release && release.version === version) return done(null, null)
    r.addRelease(folder, { version }, done)

    function done (err, newRelease) {
      if (err) throw err

      if (newRelease) console.log('Added release', newRelease)
      else console.log('Release already added...', release)

      console.log('Swarming...')

      replicator(r, {
        announceLocalAddress: true,
        lookup: true,
        announce: true
      })
    }
  })
})

function parse (folder) {
  const dir = path.basename(folder)
  const parent = path.basename(path.dirname(folder))

  if (parent === 'mac') {
    return {
      platform: 'darwin',
      version: require(path.resolve(folder, '../../../package.json')).version,
      folder
    }
  }

  if (dir === 'linux-unpacked') {
    return {
      platform: 'linux',
      version: require(path.resolve(folder, '../../package.json')).version,
      folder
    }
  }

  if (dir === 'win-unpacked') {
    return {
      platform: 'win32',
      version: require(path.resolve(folder, '../../package.json')).version,
      folder
    }
  }

  throw new Error('Unsupported dist. Use the unpacked folder or .app file.')
}
