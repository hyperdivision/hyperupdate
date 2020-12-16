#!/usr/bin/env node

const Releaser = require('./lib/releaser')
const path = require('path')
const fs = require('fs')
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

const dist = process.argv[2]
const dirs = fs.readdirSync(dist)
const platforms = []

if (dirs.includes('mac')) {
  const app = firstApp(path.join(dist, 'mac'))
  if (app) platforms.push(parse(app))
}
if (dirs.includes('linux-unpacked')) platforms.push(parse(path.join(dist, 'linux-unpacked')))
if (dirs.includes('win-unpacked')) platforms.push(parse(path.join(dist, 'win-unpacked')))
if (!dirs.length) platforms.push(parse(dist))

loop()

function loop () {
  if (!platforms.length) return
  release(platforms.shift(), loop)
}

function firstApp (dir) {
  const all = fs.readdirSync(dir)
  for (const app of all) {
    if (app.endsWith('.app')) return path.join(dir, app)
  }
  return null
}

function release ({ platform, version, folder }, cb) {
  const r = new Releaser('./hyperupdate/' + platform)
  const prefix = '[' + platform + ']'

  console.log(prefix, 'Releasing ' + folder)

  r.ready(function () {
    console.log(prefix, 'Hyperupdate key: ' + r.key.toString('hex'))
    console.log(prefix, 'Adding release....')
    r.getLatestReleaseInfo(function (err, release) {
      if (err) throw err

      if (release && release.version === version) return done(null, null)
      r.addRelease(folder, { version }, done)

      function done (err, newRelease) {
        if (err) throw err

        if (newRelease) console.log(prefix, 'Added release', newRelease)
        else console.log(prefix, 'Release already added...', release)

        console.log(prefix, 'Swarming...')

        replicator(r, {
          announceLocalAddress: true,
          lookup: true,
          announce: true
        })

        if (cb) cb()
      }
    })
  })
}

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
