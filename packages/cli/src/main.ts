import { Command } from 'commander'
import { runFind, runIndex, runSql } from './commands/catalog.js'
import { runCollect } from './commands/doctor.js'
import { runEnv } from './commands/env.js'
import { runInfo } from './commands/info.js'
import { runInit } from './commands/init.js'
import { runMovePlan, runMoveRun, runMoveSets } from './commands/move.js'
import { runAudit, runList, runUpgrade } from './commands/plugins.js'
import { runReorgPlan, runReorgRun } from './commands/reorg.js'
import { runRun } from './commands/run.js'
import { runRuns, runUndo } from './commands/runs.js'
import { runStatus } from './commands/status.js'

const collect = (value: string, previous: string[] = []) => [...previous, value]

export function program(): Command {
  const cli = new Command('livesaver')
    .description('Keep your Ableton Live projects alive: relink, collect, upgrade, audit.')
    .version('0.0.0')

  const collectOptions = (command: Command) =>
    command
      .argument('<targets...>', 'project folders, folders of projects, or single .als files')
      .option('--search <dir>', 'additional search location (repeatable)', collect)
      .option('--no-default-search', 'only search the --search locations')
      .option('--ignore <dir>', 'folder not used for the sample search (repeatable)', collect)
      .option('--exclude <dir>', 'folder whose sets are not processed (repeatable)', collect)
      .option(
        '--pack-limit <MB>',
        'pack/Core Library files above this size stay in the pack (default 50; 0 = never copy)',
      )
      .option('--config <file>', 'config file (default ~/.config/livesaver/config.json)')
      .option('--report-dir <dir>', 'write the report files (CSV, Markdown) to this folder')
      .option('--json', 'print the full result as JSON')
      .option('-q, --quiet', 'no progress output')
      .option('--workers <n>', 'parser threads (default: CPU cores − 1, max 8; 0 = none)')
      .option(
        '--full',
        'check every set, including unchanged complete ones (otherwise they are skipped)',
      )

  collectOptions(
    cli
      .command('doctor')
      .description(
        'Check sets for missing and external samples/Max devices (read-only; plans what collect would do)',
      ),
  ).action(async (targets: string[], flags) => {
    process.exitCode = await runCollect('doctor', targets, flags)
  })

  collectOptions(
    cli
      .command('collect')
      .description(
        'Relink missing samples/Max devices and collect external ones into each project, like Live\'s "Collect All and Save" (dry run unless --apply)',
      ),
  )
    .option(
      '--apply',
      'really write: copy files, back up and patch sets (Live must not be running)',
    )
    .option('--force', 'apply even while Live is running (unsafe for open sets)')
    .action(async (targets: string[], flags) => {
      process.exitCode = await runCollect('collect', targets, flags)
    })

  const plugins = cli
    .command('plugins')
    .description('Plug-ins: what is installed, what the sets use')
  plugins
    .command('list')
    .description('The plug-ins installed on this Mac: formats, native or Rosetta, versions')
    .option('--format <vst2|vst3|au>', 'only this format')
    .option('--rosetta', 'only plug-ins that run only under Rosetta')
    .option('--unscanned', 'only bundles Live has not scanned')
    .option('--no-auval', "don't ask auval for all registered Audio Units")
    .option('--json', "print JSON (with each bundle's version and moduleinfo.json)")
    .action(async (flags) => {
      process.exitCode = await runList(flags)
    })
  plugins
    .command('audit')
    .description(
      'Plug-ins the sets use against what is installed: missing, Rosetta-only, native alternatives, VST3 available, unused (read-only)',
    )
    .argument('<targets...>', 'project folders, folders of projects, or single .als files')
    .option('--uninstall <name>', 'show what breaks if this plug-in is uninstalled (all formats)')
    .option('--exclude <dir>', 'folder whose sets are not read (repeatable)', collect)
    .option('--report-dir <dir>', 'write the reports to this folder')
    .option('--workers <n>', 'parser threads (0 = none)')
    .option('--no-auval', "don't ask auval for all registered Audio Units")
    .option('--json', 'print the result as JSON')
    .action(async (targets: string[], flags) => {
      process.exitCode = await runAudit(targets, flags)
    })
  plugins
    .command('upgrade')
    .description(
      'Switch VST2 plug-in instances to the installed VST3 version (verified plug-ins; dry run unless --apply)',
    )
    .argument('<targets...>', 'project folders, folders of projects, or single .als files')
    .option('--apply', 'really write (Live must not be running)')
    .option('--force', 'apply even while Live is running (unsafe for open sets)')
    .option('--plugin <name>', 'only this plug-in (repeatable)', collect)
    .option('--exclude <dir>', 'folder whose sets are not processed (repeatable)', collect)
    .option('--report-dir <dir>', 'write the report to this folder')
    .option('--json', 'print the result as JSON')
    .action(async (targets: string[], flags) => {
      process.exitCode = await runUpgrade(targets, flags)
    })

  cli
    .command('status')
    .description(
      'Mark every project and set in Finder: progress (tags) and the facts (comments); reports and the rating sheet (dry run unless --apply)',
    )
    .argument('<targets...>', 'folders of projects, project folders, or single .als files')
    .option('--apply', 'really set tags and comments (and take over / rewrite the rating sheet)')
    .option('--exclude <dir>', 'folder whose sets are not processed (repeatable)', collect)
    .option('--no-comments', 'only tags, no Finder comments (Finder is not controlled)')
    .option(
      '--no-auval',
      "don't ask auval for all registered Audio Units (faster; only Live's database and bundles count)",
    )
    .option('--exports <dir>', 'folder with mixdowns')
    .option('--sheet <csv>', 'rating sheet to take entries from and rewrite')
    .option('--no-sheet', 'no rating sheet')
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the reports to this folder')
    .option('--workers <n>', 'parser threads (0 = none)')
    .option('--json', 'print the result as JSON')
    .option('-q, --quiet', 'no progress output')
    .action(async (targets: string[], flags) => {
      process.exitCode = await runStatus(targets, flags)
    })

  const reorg = cli
    .command('reorg')
    .description('Sort project folders into status folders by their decision tag')
  reorg
    .command('plan')
    .description('Write a plan (CSV) from the decision tags; changes nothing')
    .argument('<folders...>', 'folders with projects')
    .option(
      '--into <dir>',
      'folder that holds the status folders (default: config, else the first folder)',
    )
    .option('--exclude <dir>', 'folder to leave out (repeatable)', collect)
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the plan to this folder')
    .action(async (folders: string[], flags) => {
      process.exitCode = await runReorgPlan(folders, flags)
    })
  reorg
    .command('run')
    .description('Check a plan; with --apply move the project folders (never replacing anything)')
    .argument('<plan>', 'plan CSV (columns Project and Target)')
    .option('--apply', 'really move (Live must not be running)')
    .option('--force', 'apply even while Live is running')
    .option('--into <dir>', 'folder that holds the status folders')
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the report to this folder')
    .action(async (plan: string, flags) => {
      process.exitCode = await runReorgRun(plan, flags)
    })

  const move = cli
    .command('move')
    .description("Move sets that ended up in another song's project into a project of their own")
  move
    .command('plan')
    .description('Find such sets and write a plan (CSV); changes nothing')
    .argument('<folders...>', 'folders with projects')
    .option('--exclude <dir>', 'folder to leave out (repeatable)', collect)
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the plan to this folder')
    .action(async (folders: string[], flags) => {
      process.exitCode = await runMovePlan(folders, flags)
    })
  move
    .command('run')
    .description(
      'Carry out a plan: copy the samples, check every reference, move sets and backups (dry run unless --apply)',
    )
    .argument('<plan>', 'plan CSV (columns Set and Target project)')
    .option('--apply', 'really move (Live must not be running)')
    .option('--force', 'apply even while Live is running')
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the report to this folder')
    .action(async (plan: string, flags) => {
      process.exitCode = await runMoveRun(plan, flags)
    })
  move
    .command('sets')
    .description(
      'Move these sets (with backups and samples) into the target project (dry run unless --apply)',
    )
    .argument('<target>', 'target project folder (created if missing)')
    .argument('<sets...>', 'sets of one project')
    .option('--apply', 'really move (Live must not be running)')
    .option('--force', 'apply even while Live is running')
    .option('--config <file>', 'config file')
    .option('--report-dir <dir>', 'write the report to this folder')
    .action(async (target: string, sets: string[], flags) => {
      process.exitCode = await runMoveSets(target, sets, flags)
    })

  cli
    .command('index')
    .description(
      'Bring the catalog up to date with these folders (only changed sets are read again)',
    )
    .argument('<targets...>', 'folders of projects, project folders, or single .als files')
    .option('--full', 'read every set again')
    .option('--exclude <dir>', 'folder whose sets are left out (repeatable)', collect)
    .option('--config <file>', 'config file')
    .option('--workers <n>', 'parser threads (0 = none)')
    .option('--no-auval', "don't ask auval for all registered Audio Units")
    .option('--json', 'print the result as JSON')
    .option('-q, --quiet', 'no progress output')
    .action(async (targets: string[], flags) => {
      process.exitCode = await runIndex(targets, flags)
    })

  cli
    .command('find')
    .description(
      'Search the catalog, e.g. find plugin:serum bpm:120..128 stage:arranged missing:samples "night drive"',
    )
    .argument('[query...]', 'words and field:value terms (see `livesaver find --help`)')
    // "-stage:empty" is a negated term, not an option
    .allowUnknownOption()
    .option('--sort <field>', 'project (default), path, name, modified, length, bpm, stage')
    .option('--limit <n>', 'at most this many sets')
    .option('--paths', 'print only the paths (for scripts)')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      `
Fields: plugin: format: sample: device: stage: missing: rosetta: complete: error: bpm: length:
        bars: tracks: audio: midi: clips: scenes: automation: blocks: locators: plugins:
        samples: live: modified: project: path: name: has: duplicate:
Ranges: 120..128  >120  >=120  <4:00  2024..2025   Negation: -stage:empty   Quotes: "night drive"`,
    )
    .action(async (query: string[], flags) => {
      process.exitCode = await runFind(query, flags)
    })

  cli
    .command('sql')
    .description(
      'Run a read-only SQL query against the catalog (tables sets, set_plugins, set_refs)',
    )
    .argument('<sql>', 'e.g. "SELECT name, tempo FROM sets ORDER BY tempo DESC LIMIT 5"')
    .option('--json', 'print JSON')
    .action(async (sql: string, flags) => {
      process.exitCode = await runSql(sql, flags)
    })

  cli
    .command('run')
    .description(
      'Run a codemod over sets: a built-in (see --list) or your own .ts/.js file (dry run unless --apply)',
    )
    .argument('[codemod]', 'built-in name or path to a codemod module')
    .argument('[targets...]', 'project folders, folders of projects, or single files')
    .option('--list', 'list the built-in codemods')
    .option('--option <key=value>', 'an option for the codemod (repeatable)', collect)
    .option('--apply', 'really write: back up, journal and replace the changed sets')
    .option('--force', 'apply even while Live is running (unsafe for open sets)')
    .option('--exclude <dir>', 'folder whose sets are left out (repeatable)', collect)
    .option('--report-dir <dir>', 'write the report to this folder')
    .option('--json', 'print the result as JSON')
    .action(async (codemod: string | undefined, targets: string[], flags) => {
      process.exitCode = await runRun(codemod, targets, flags)
    })

  cli
    .command('init')
    .description('Write ~/.config/livesaver/config.json from the detected Live setup')
    .option('--force', 'replace an existing config')
    .action(async (flags) => {
      process.exitCode = await runInit(flags)
    })

  cli
    .command('runs')
    .description('List runs (reports, journals and the originals kept for undo)')
    .action(async () => {
      process.exitCode = await runRuns()
    })

  cli
    .command('undo')
    .description(
      'Reverse an applied run: restore sets, tags, comments and the rating sheet, move folders back, trash copies nobody uses',
    )
    .argument('<run>', 'run id from `livesaver runs`')
    .option('--config <file>', 'config file')
    .option('--force', 'undo even while Live is running')
    .action(async (id: string, flags) => {
      process.exitCode = await runUndo(id, flags)
    })

  cli
    .command('info')
    .description('Show what livesaver reads from one Live file (.als/.adg/.adv/.alc)')
    .argument('<file>')
    .option('--refs', 'list every sample and Max device reference')
    .option('--json', 'print JSON')
    .action(async (file: string, flags) => {
      process.exitCode = await runInfo(file, flags)
    })

  cli
    .command('env')
    .description('Show the detected Live installation, libraries and search locations')
    .option('--config <file>', 'config file')
    .option('--json', 'print JSON')
    .action(async (flags) => {
      process.exitCode = await runEnv(flags)
    })

  return cli
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await program().parseAsync(argv)
}
