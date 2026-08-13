#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

const log = (message, color = '') => console.log(`${color}${message}${RESET}`)

const exitError = (message) => {
  log(message, RED)
  process.exit(1)
}

const run = (command) => execSync(command, { stdio: 'inherit' })

const CHANGELOG_PATH = 'CHANGELOG.md'
const PACKAGE_PATH = 'package.json'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const VERSION_KEYWORDS = ['patch', 'minor', 'major']
const CONVENTIONAL_SUBJECT_PATTERN = /^(feat|fix|perf|refactor|docs|ci|build|chore|style|test|revert)(\([^)]+\))?(!)?: (.+)$/
const BUMP_COMMIT_PREFIX = 'chore: bump version to '

// --- Parse the version argument at the boundary: a v-prefixed X.Y.Z or a bump keyword ---
const parseVersionArgument = (rawArgument) => {
  if (!rawArgument) return null
  const stripped = rawArgument.startsWith('v') ? rawArgument.slice(1) : rawArgument
  if (SEMVER_PATTERN.test(stripped)) return { kind: 'exact', value: stripped }
  if (VERSION_KEYWORDS.includes(stripped)) return { kind: 'step', value: stripped }
  return null
}

const isDryRun = process.argv[2] === '--dry-run'
const versionArgument = isDryRun ? process.argv[3] : process.argv[2]
const parsedVersion = parseVersionArgument(versionArgument)

// --- Guard: a valid version argument is required ---
if (!parsedVersion) {
  exitError('Usage: node scripts/bump-version.mjs [--dry-run] <patch|minor|major|X.Y.Z>')
}

// --- Guard: never rewrite version files over uncommitted work ---
const workingTreeIsDirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim().length > 0
if (workingTreeIsDirty) {
  exitError('Working tree is not clean. Commit or stash changes before bumping the version.')
}

// --- Read the current version from package.json (parse at the boundary) ---
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8'))
const currentVersion = packageJson.version
if (!SEMVER_PATTERN.test(currentVersion)) {
  exitError(`package.json has an invalid version "${currentVersion}". Expected X.Y.Z.`)
}

// --- Compute the next version ---
const computeNextVersion = (currentVersion, parsedVersion) => {
  if (parsedVersion.kind === 'exact') return parsedVersion.value
  const [major, minor, patch] = currentVersion.split('.').map(Number)
  if (parsedVersion.value === 'major') return `${major + 1}.0.0`
  if (parsedVersion.value === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const newVersion = computeNextVersion(currentVersion, parsedVersion)

// --- Guard: never "bump" to the version already in place ---
if (newVersion === currentVersion) {
  exitError(`Version ${newVersion} is already the current version. Pick a higher version.`)
}

// --- Guard: the new version must not already exist in the changelog ---
const changelog = readFileSync(CHANGELOG_PATH, 'utf-8')
if (changelog.includes(`## [${newVersion}]`)) {
  exitError(`Version ${newVersion} already exists in ${CHANGELOG_PATH}.`)
}

// --- Find the previous release tag to bound the commit window ---
const previousTag = execSync('git describe --tags --abbrev=0 2>/dev/null || true', { encoding: 'utf-8' }).trim()

// --- Build the git-log range: previousTag..HEAD, or the full history for a first release ---
const commitRange = previousTag ? `${previousTag}..HEAD` : null
const logCommand = commitRange
  ? `git log --no-merges --pretty=format:'%s' ${commitRange}`
  : `git log --no-merges --pretty=format:'%s'`

// --- Read every commit subject in the window, skipping blank lines and bump commits ---
const commitSubjects = execSync(logCommand, { encoding: 'utf-8' })
  .split('\n')
  .map((subject) => subject.trim())
  .filter((subject) => subject.length > 0 && !subject.startsWith(BUMP_COMMIT_PREFIX))

// --- Parse each subject at the boundary; unparsed subjects survive verbatim ---
const parseCommitSubject = (subject) => {
  const match = subject.match(CONVENTIONAL_SUBJECT_PATTERN)
  if (!match) return { kind: 'unparsed', rawSubject: subject }
  return {
    kind: 'conventional',
    type: match[1],
    scope: match[2] ?? '',
    isBreaking: match[3] === '!',
    description: match[4],
  }
}

const parsedCommits = commitSubjects.map(parseCommitSubject)

// --- Classify each commit into exactly one release section ---
const classifyCommit = (commit) => {
  if (commit.kind === 'unparsed') return 'other'
  if (commit.isBreaking) return 'breaking'
  switch (commit.type) {
    case 'feat':
      return 'features'
    case 'fix':
      return 'bug-fixes'
    case 'refactor':
    case 'perf':
      return 'refactors'
    case 'docs':
    case 'ci':
    case 'build':
    case 'chore':
    case 'style':
    case 'test':
    case 'revert':
      return 'maintenance'
    default:
      return 'other'
  }
}

// --- Group commits into release sections, preserving newest-first order within each ---
const groupCommits = (commits) => {
  const groups = new Map([
    ['breaking', []],
    ['features', []],
    ['bug-fixes', []],
    ['refactors', []],
    ['maintenance', []],
    ['other', []],
  ])
  for (const commit of commits) {
    groups.get(classifyCommit(commit)).push(commit)
  }
  return groups
}

const groupedCommits = groupCommits(parsedCommits)

const SECTION_HEADINGS = [
  { groupKey: 'breaking', heading: '### ⚠ BREAKING CHANGES' },
  { groupKey: 'features', heading: '### Features' },
  { groupKey: 'bug-fixes', heading: '### Bug Fixes' },
  { groupKey: 'refactors', heading: '### Refactors' },
  { groupKey: 'maintenance', heading: '### Maintenance' },
  { groupKey: 'other', heading: '### Other' },
]

// --- Render a bullet: unparsed subjects verbatim, conventional descriptions with a sentence-style lead (acronyms preserved) ---
const lowerCaseLeadUnlessAcronym = (text) => {
  // Preserve leading acronyms (XHR, API, JS): when the second character is also
  // an uppercase letter, the first character belongs to an all-caps run.
  if (text.length >= 2 && /[A-Z]/.test(text[1])) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

const renderBullet = (commit) => {
  if (commit.kind === 'unparsed') return `- ${commit.rawSubject}`
  return `- ${lowerCaseLeadUnlessAcronym(commit.description)}`
}

// --- Render the full "## [version] - date" section; empty groups are dropped entirely ---
const renderReleaseSection = (newVersion, releaseDate, groups) => {
  const lines = [`## [${newVersion}] - ${releaseDate}`, '']
  for (const { groupKey, heading } of SECTION_HEADINGS) {
    const group = groups.get(groupKey)
    if (group.length === 0) continue
    lines.push(heading)
    for (const commit of group) lines.push(renderBullet(commit))
    lines.push('')
  }
  while (lines[lines.length - 1] === '') lines.pop()
  return `${lines.join('\n')}\n`
}

// --- Insert the new section right after the changelog header, before any existing version ---
const insertReleaseSection = (changelog, releaseSection) => {
  const firstVersionSectionIndex = changelog.search(/^## \[/m)
  if (firstVersionSectionIndex === -1) {
    return `${changelog.trimEnd()}\n\n${releaseSection}`
  }
  const headerBlock = changelog.slice(0, firstVersionSectionIndex)
  const existingSections = changelog.slice(firstVersionSectionIndex)
  return `${headerBlock}${releaseSection}\n${existingSections}`
}

// --- Format today as a local ISO date (YYYY-MM-DD) ---
const formatLocalIsoDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const releaseDate = formatLocalIsoDate(new Date())
const releaseSection = renderReleaseSection(newVersion, releaseDate, groupedCommits)

// --- Dry-run: report everything without touching the repository ---
if (isDryRun) {
  log('\n── DRY RUN (no files will be modified) ──', YELLOW)
  log(`Target version: ${currentVersion} → ${newVersion}`)
  log(`Release date: ${releaseDate}`)
  log('Changelog section that WOULD be added:\n')
  console.log(releaseSection)
  log('Commit message that WOULD be created:', YELLOW)
  log(`  chore: bump version to ${newVersion}`)
  log('Tag that WOULD be created:', YELLOW)
  log(`  v${newVersion} — "Release v${newVersion}"`)
  log('\nDry run complete — no files modified, no commit, no tag.', GREEN)
  process.exit(0)
}

// --- Real run: write version files, commit, tag locally (never push) ---
packageJson.version = newVersion
writeFileSync(PACKAGE_PATH, `${JSON.stringify(packageJson, null, 2)}\n`)
writeFileSync(CHANGELOG_PATH, insertReleaseSection(changelog, releaseSection))
log('✓ Updated package.json', GREEN)
log(`✓ Updated ${CHANGELOG_PATH}`, GREEN)

log('\n→ Staging version files (package.json, CHANGELOG.md)...', YELLOW)
run('git add package.json CHANGELOG.md')

log('→ Committing (skipping hooks)...', YELLOW)
run(`git commit --no-verify -s -m "chore: bump version to ${newVersion}"`)

log('→ Creating annotated local tag...', YELLOW)
run(`git tag -a v${newVersion} -m "Release v${newVersion}"`)

// Verify the tag actually landed: `git tag -a` has been observed to exit 0
// without an error yet leave the ref missing.
try {
  execSync(`git rev-parse --verify -q v${newVersion}`)
} catch {
  exitError(`Tag v${newVersion} was not created despite 'git tag' reporting success. Run 'git tag -a v${newVersion} -m "Release v${newVersion}"' manually and verify with 'git tag -l'.`)
}

log('\n══════════════════════════════════════════', GREEN)
log('  ✓ Version bump complete!', GREEN)
log(`  ${currentVersion} → ${newVersion}`, GREEN)
log(`  ✓ Created local tag v${newVersion}.`, GREEN)
log('  Review, then push when ready:', YELLOW)
log('      git push origin main --follow-tags', YELLOW)
log('══════════════════════════════════════════\n', GREEN)
