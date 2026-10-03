/** A parse worker: gunzips a set and finds its references and plug-ins (see `createWorkerParser`). */
import { type ParseScope, serveParser } from '@livesaver/web'

serveParser(self as unknown as ParseScope)
