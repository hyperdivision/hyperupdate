# hyperupdate

P2P Electron updater with binary diffing built in

```
npm install hyperupdate
```

## Status

Note that this project is still experimental

## Usage

First setup the releaser in your app

``` sh
npm install -g hyperupdate
cd your-electron-app
hyperupdate-release # will print a release config map
```

The release lines are store in `./hyperupdate`, you might want to add this folder to your `.gitignore`.

Then in your Electron app, setup the updater in either your electron process or in the renderer process if you
have Node.js integration enabled.

``` js
const Hyperupdate = require('hyperupdate')

const u = new Hyperupdate({
  darwin: '<from-above>',
  linux: '<from-above>',
  win32: '<from-above>'
})

u.on('update-available', () => {
  console.log('New update available', this.latestRelease)
})

u.on('update-downloaded', () => {
  console.log('New update downloaded', this.latestRelease)
})
```

After the `update-downloaded` event has fired you can use the `updateAndRelaunch` method to apply the new update

``` js
u.updateAndRelaunch() // will apply the update and relaunch your app
```

## RPC

If you want to run the updater in the Electron process instead of the renderer you can use the RPC interface to access it.

In the Electron process do

``` js
await u.listen()
```

And then in renderer do

``` js
const Client = require('hyperupdate/client')

const u = new Client()
```

The remote client has the same interface as the normal updater instance.

## Adding a new release

To add a new release, bump the version in your Electron's package.json and build your app using electron-builder.

Then point `hyperupdate-release` to the `.app` file on mac or unpacked directory on linux / windows.

``` sh
# on mac
hyperupdate-release ./dist/mac/my-app.app

# on linux
hyperupdate-release ./dist/linux-unpacked

# on windows
hyperupdate-release ./dist/win-unpacked
```

Hyperupdate will chunk each release using a bundled rabin chunker, to try to make the update diff as small as possible.

After it has been added the updater will start swarming the new release.

If you the release you add is the same as the latest release, hyperupdate will just start swarming the releases instead
of re-adding it.


## License

MIT
