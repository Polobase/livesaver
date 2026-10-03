/**
 * One set end to end: resolve every reference, choose replacements, place copies, compute the
 * byte-exact patch and verify it.
 */
import {
  documentFromXml,
  encodeDocument,
  type FileRef,
  type FileStat,
  fileRefs,
  type Host,
  inProcessParser,
  type LiveDoc,
  type ParsedSet,
  posix,
  RelPathIds,
} from '@livesaver/core'
import { type Edit, patch as patchDoc } from '@livesaver/xml'
import {
  type Action,
  type Change,
  type Decision,
  emptyCounts,
  importDir,
  isStale,
  keepInPack,
  lastMod,
  type ProcessOptions,
  type Project,
  refEdits,
  type SetResult,
  shown,
  wantedLocation,
} from './collect.js'
import { isInside } from './env.js'
import { mapLimited } from './file-index.js'
import { checkOf, classify, methodText, resolveExisting, type Status } from './match.js'

/** References whose files are read at the same time before a set's decisions are made. */
const READ_AHEAD = 16

export class VerifyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerifyError'
  }
}

export async function processSet(
  setPath: string,
  project: Project,
  host: Host,
  options: ProcessOptions & { readonly parsed?: ParsedSet } = {},
): Promise<SetResult> {
  const { root, env, probe } = project
  const result: SetResult = {
    setPath,
    projectRoot: root,
    creator: '',
    minorVersion: '',
    counts: emptyCounts(),
    changes: [],
    missing: [],
    files: [],
    decisions: [],
    backup: '',
    written: false,
    error: '',
    skipped: false,
  }
  const parsed = options.parsed ?? (await inProcessParser(host).parse(setPath))
  if (!parsed.ok) {
    result.error = parsed.error
    return result
  }
  const { doc, refs } = parsed
  result.creator = doc.creator
  result.minorVersion = doc.minorVersion
  const groups = new Map<string, FileRef[]>()
  for (const ref of refs) {
    const group = groups.get(ref.key)
    if (group) group.push(ref)
    else groups.set(ref.key, [ref])
  }

  const setDir = posix.dirname(setPath)
  // Found by scanning the whole document, so only when a reference really gets rewritten.
  let relIds: RelPathIds | undefined
  const ids = () => {
    relIds ??= RelPathIds.of(doc)
    return relIds
  }
  const edits: Edit[] = []
  const stale: [FileRef[], string][] = []
  const decide = (ref: FileRef, status: Status, extra: Partial<Decision> = {}) =>
    result.decisions.push({
      key: ref.key,
      name: ref.name,
      kind: ref.kind,
      status,
      destination: '',
      source: '',
      method: '',
      certain: true,
      stale: false,
      ...extra,
    })
  // Choosing a replacement reads files (fingerprints, sometimes whole samples). The decisions
  // below are made one by one, in order; the reading for them is started here for many
  // references at once, so a file system with slow round trips (a browser, a network drive) is
  // not waited for one file at a time. Nothing is decided here: the probe and the project keep
  // what was read, and a failure shows up at its reference below.
  await mapLimited([...groups.values()], READ_AHEAD, async (same) => {
    const ref = same[0] as FileRef
    if (!ref.name) return
    try {
      if (!(await resolveExisting(ref, setDir, root, env, probe))) await project.choose(ref)
    } catch {}
  })
  try {
    for (const same of groups.values()) {
      const ref = same[0] as FileRef
      if (!ref.name) continue // empty reference (e.g. an empty Simpler)
      const device = ref.kind === 'device'
      const existing = await resolveExisting(ref, setDir, root, env, probe)
      let dst: string
      let source: string
      let status: Status
      let action: Action
      let change: Pick<Change, 'method' | 'check' | 'suffix' | 'keptInPack' | 'certain'>
      if (existing) {
        const kind = classify(existing, root, env)
        if (kind === 'project') {
          result.counts.ok++
          result.files.push(existing)
          const isOld = isStale(ref, existing, root)
          if (isOld) stale.push([same, existing])
          decide(ref, 'ok', { destination: existing, stale: isOld })
          continue
        }
        if (
          kind === 'builtin' ||
          (kind === 'pack' && (await keepInPack(existing, env, probe, project.options, device)))
        ) {
          result.counts.kept++
          result.files.push(existing)
          decide(ref, 'kept', { destination: existing })
          continue
        }
        dst = await project.place(existing, '', await importDir(ref, existing, probe))
        source = existing
        status = 'external'
        action = 'collected'
        change = {
          method: 'existed outside the project',
          check: 'existed-outside',
          suffix: 0,
          keptInPack: '',
          certain: true,
        }
      } else {
        const choice = await project.choose(ref)
        if (choice.status !== 'found') {
          result.counts[choice.status]++
          result.missing.push({ ref, choice })
          decide(ref, choice.status, { method: methodText(choice) })
          continue
        }
        let method = methodText(choice)
        let keptInPack: Change['keptInPack'] = ''
        if (isInside(choice.path, root)) {
          dst = choice.path
          source = ''
        } else if (await keepInPack(choice.path, env, probe, project.options, device)) {
          keptInPack = device ? 'device' : 'large'
          method += `, kept in the pack (${device ? 'Max device' : 'large'})`
          dst = choice.path
          source = ''
        } else {
          const wanted = wantedLocation(ref, root)
          dst = await project.place(choice.path, wanted, await importDir(ref, choice.path, probe))
          source = choice.path
        }
        status = 'found'
        action = 'repaired'
        change = {
          method,
          check: checkOf(choice),
          suffix: choice.suffix,
          keptInPack,
          certain: choice.verified,
        }
      }
      result.counts[status]++
      const lastModDate = await lastMod(dst, source || dst, probe)
      for (const r of same)
        edits.push(...(await refEdits(doc, r, dst, root, setDir, env, ids(), lastModDate)))
      const oldPath = ref.path || ref.hintPath || ref.relPath
      result.changes.push({
        action,
        name: ref.name,
        oldPath,
        newPath: shown(dst, root),
        source,
        ...change,
      })
      decide(ref, status, {
        destination: dst,
        source,
        method: change.method,
        certain: change.certain,
      })
    }
    if (edits.length === 0) return result
    for (const [same, existing] of stale) {
      for (const r of same)
        edits.push(...(await refEdits(doc, r, existing, root, setDir, env, ids(), undefined)))
      const ref = same[0] as FileRef
      result.changes.push({
        action: 'path-updated',
        name: ref.name,
        oldPath: ref.path || ref.relPath,
        newPath: posix.relpath(existing, root),
        source: '',
        method: '',
        check: '',
        suffix: 0,
        keptInPack: '',
        certain: true,
      })
    }
    const p = patchDoc(doc.xml)
    for (const e of edits) p.replaceRange(e.start, e.end, e.text)
    const newXml = p.apply()
    await verify(newXml, doc, refs, setDir, project, options.quickPlan ?? false)
    if (options.keepXml) {
      result.newXml = newXml
      result.edits = p.edits()
    }
    if (project.writer.apply) {
      const data = await encodeDocument(doc, newXml, host.codec)
      if (parsed.stat) {
        const now = await host.fs.stat(setPath)
        if (!now || !sameFile(now, parsed.stat)) {
          throw new Error('the set changed after it was read (is Live saving it?); not written')
        }
      }
      result.backup = await project.writer.writeSet(setPath, root, data)
      result.written = true
    }
  } catch (error) {
    result.error = (error as Error).message
    return result
  }
  return result
}

function sameFile(a: FileStat, b: FileStat): boolean {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino
}

/** The patched XML must be well-formed, keep every reference, and (when applying) resolve. */
async function verify(
  newXml: Uint8Array,
  doc: LiveDoc,
  oldRefs: readonly FileRef[],
  setDir: string,
  project: Project,
  quickPlan: boolean,
) {
  let newDoc: LiveDoc
  try {
    // Strict: every byte of the patched XML is scanned. Only a plan may do without.
    const strict = project.writer.apply || !quickPlan
    newDoc = documentFromXml(newXml, doc.gzipped, strict, doc.search)
  } catch (error) {
    throw new VerifyError(`patched XML is not well-formed: ${(error as Error).message}`)
  }
  const newRefs = fileRefs(newDoc)
  if (newRefs.length !== oldRefs.length)
    throw new VerifyError('the number of sample references changed')
  if (!project.writer.apply) return // copies do not exist in a dry run
  for (let i = 0; i < newRefs.length; i++) {
    const before = oldRefs[i] as FileRef
    const after = newRefs[i] as FileRef
    if (after.key === before.key) continue
    const target = await resolveExisting(after, setDir, project.root, project.env, project.probe)
    if (!target || !(isInside(target, project.root) || project.env.isPackFile(target))) {
      throw new VerifyError(
        `reference to ${after.name} points neither into the project nor into a pack`,
      )
    }
  }
}
