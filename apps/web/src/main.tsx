import { render } from 'preact'
import { App } from './app.js'
import { localToken } from './local.js'
import { LocalApp } from './local-app.js'

// Served by livesaver on this computer, the page can also fix; on its own it only reads.
const token = localToken()
render(token ? <LocalApp token={token} /> : <App />, document.getElementById('app') as HTMLElement)
