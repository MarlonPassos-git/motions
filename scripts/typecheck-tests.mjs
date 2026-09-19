import { spawnSync } from 'node:child_process';

// test/ sits outside tsconfig.json's src/**/*.ts include, so nothing
// type-checked it. A broken import passed typecheck, lint and format alike and
// surfaced only when the spec ran, which cost three bugs in one session: a
// missing getVimMode import, an import of useSourceProperties that helpers
// never exported, and a node:path call placed inside a browser callback.
//
// Type-checking test/ outright is not available: strict reports about 4100
// errors there, because the suite uses loose typing deliberately and eslint
// already switches those rules off for test/. Relaxing strict instead makes
// the vendored fengari sources report two errors of their own, and excluding
// them strips types from their importers and cascades into thousands.
//
// So this reports only resolution failures. They are unaffected by strictness,
// they are the class that actually broke, and they carry no noise from the
// typing the suite has deliberately not done.
const RESOLUTION_ERRORS = new Set([
    'TS2304', // cannot find name
    'TS2305', // module has no exported member
    'TS2307', // cannot find module
    'TS2551', // property does not exist, did you mean
    'TS2552', // cannot find name, did you mean
]);

const result = spawnSync(
    'npx',
    ['tsc', '-p', 'tsconfig.test.json', '--noEmit', '--pretty', 'false'],
    { encoding: 'utf8' },
);

const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`.split('\n');
const found = lines.filter((line) => {
    const match = /error (TS\d+):/.exec(line);
    return match && RESOLUTION_ERRORS.has(match[1]) && line.startsWith('test/');
});

if (found.length > 0) {
    console.error('Unresolved names or modules in test/:\n');
    for (const line of found) console.error(`  ${line}`);
    console.error(
        `\n${found.length} resolution error(s). These only surface at runtime otherwise.`,
    );
    process.exit(1);
}

console.log('test/: no unresolved names or modules');
