import { exec } from 'child_process';
import { promisify } from 'util';

let packages = ['@kusocat/core', '@kusocat/inertia', '@kusocat/inertia-svelte'];

const versions = new Map<string, string>();
const packageData: Map<
    string,
    {
        path: string;
        original: string;
        json: any;
    }
> = new Map();

const argv = process.argv.slice(2);

if (argv.length) {
    packages = packages.filter(pkg => argv.includes(pkg));
}

async function getVersion(pkg: string) {
    if (versions.has(pkg)) {
        return versions.get(pkg)!;
    }
    const path = import.meta.resolveSync(`${pkg}/package.json`);
    const json = await import(path);
    versions.set(pkg, json.version);
    return json.version;
}

for (const pkg of packages) {
    const path = import.meta.resolveSync(`${pkg}/package.json`);
    const original = await Bun.file(path).text();
    const json = JSON.parse(original);
    packageData.set(pkg, { path, original, json });
    versions.set(pkg, json.version);
}

for (const [pkg, { path, original, json }] of packageData) {
    if ('dependencies' in json) {
        for (const [dep, version] of Object.entries(json.dependencies as Record<string, string>)) {
            if (version.startsWith('workspace:')) {
                json.dependencies[dep] = '^' + (await getVersion(dep));
            }
        }
    }
    if ('devDependencies' in json) {
        for (const [dep, version] of Object.entries(
            json.devDependencies as Record<string, string>,
        )) {
            if (version.startsWith('workspace:')) {
                json.devDependencies[dep] = '^' + (await getVersion(dep));
            }
        }
    }
    await Bun.write(path, JSON.stringify(json, null, 2) + '\n');
    console.log(`Publishing ${pkg}...`);
    await promisify(exec)(`npm publish --access public`, {
        cwd: path.replace(/\/package\.json$/, ''),
    });
    await Bun.write(path, original);
}

export {};
