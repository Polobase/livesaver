/**
 * Runs before anything else of the app: `livesaver web --pair` opens the page with a pairing
 * behind the `#` of its address. It is taken and the address cleared before the router reads
 * the address as a place to go to (which would keep the token in view).
 */
import { takePairingFromAddress } from './create.js'

takePairingFromAddress()
