import path from 'node:path';
import fs from 'node:fs';
import { isModulePackage } from './packageUtils.js';
import { rollupModule, runRollup } from './rollupModule.js';

// Get the package file for a module
export function readPackageFile(folder)
{
    try
    {
        return JSON.parse(fs.readFileSync(path.join(folder, "package.json")));
    }
    catch (err)
    {
        if (err.code == "ENOENT")
            return null;
        throw err;
    }
}

// Resolve module list
export function resolveModules(options)
{
    // Setup default options
    options = Object.assign({
        baseDir: process.cwd(),
        moduleBaseUrl: "/modules",
        modules: [],
    }, options);

    let rootModules = new Map();

    // Work out all explicitly referenced modules
    for (let i=0; i<options.modules.length; i++)
    {
        let m = options.modules[i];

        // Simple "modulename"
        if (typeof(m) === 'string')
        {
            m = { name: m };
        }

        // Must have a name
        if (!m.name)
            throw new Error("missing module `name` property");

        // Check not already defined
        if (rootModules.has(m.name))
            throw new Error(`duplicate module: '${m.name}'`);

        // Setup module info
        let modinfo = Object.assign({
            reason: "explicit",
            refloc: options.baseDir,
        }, m);
        rootModules.set(modinfo.name, modinfo);
    }

    // Read dependencies from the project package file
    let rootPkg = readPackageFile(options.baseDir);
    if (rootPkg?.dependencies)
    {
        for (let name of Object.keys(rootPkg.dependencies))
        {
            if (!rootModules.has(name))
            {
                rootModules.set(name, { 
                    name,  
                    refloc: options.baseDir,
                });
            }
        }
    }

    // Load root modules and all dependencies
    let modules = new Map();
    for (let m of [...rootModules.values()])
    {
        loadModule(m);
    }

    // Load the project's default dependencies
    //loadModule(options.baseDir, { name: "." });



    return [...modules.values()];

    function loadModule(m)
    {
        if (modules.has(m.name))
            return;
        modules.set(m.name, m);

        // Explicitly ignored module?
        if (m.ignore)
            return;

        if (!m.url)
            m.url = options.moduleBaseUrl + "/" + m.name;

        // Virtual module
        if (m.virtual)
            return;

        // Locate the module
        if (!m.location)
            m.location = locateModule(m.refloc, m.name);

        console.log(`loading module ${m.name} from ${path.relative(options.baseDir, m.location)}`);

        // Read package file
        if (!m.package)
        {
            m.package = readPackageFile(m.location);
            if (!m.package)
            {
                console.error(`warning: no package.json file found for module ${m.name} (in ${m.location})`)
                m.package = {};
            }
        }

        // Does this package need to be rolled up?
        if (m.rollup === undefined)
            m.rollup = !isModulePackage(m.package);

        // If package is rolled up, then we don't need dependencies
        if (m.nodeps === undefined && m.rollup)
            m.nodeps = true;

        // Load all dependencies
        if (m.package.dependencies && m.nodeps !== true)
        {
            for (let dep of Object.keys(m.package.dependencies))
            {
                // Ignore if already referenced
                if (!rootModules.has(dep))
                {
                    loadModule({ 
                        name: dep, 
                        refloc: m.location 
                    });
                }
            }
        }
    }

    function locateModule(dir, name)
    {
        if (name == ".")
            return dir;

        // Remember start location
        let startDir = dir;

        // Search in all node_modules directories
        while (true)
        {
            // Look for node_modules/{module-name}
            let folder = path.join(dir, "node_modules", name);
            if (fs.existsSync(folder))
                return fs.realpathSync(folder);

            // Walk up, abort when reach root
            let parentDir = path.dirname(dir);
            if (parentDir == dir)
                throw new Error(`Can't find module '${name}' (searching from '${startDir})`);
            dir = parentDir;
        }
    }
}

// Resolve modules
var modules = resolveModules({
    modules: [],
});

// Roll up CJS modules
let bundleDir = "node_modules/.bundle-free";
fs.mkdirSync(bundleDir, { recursive: true });
for (var m of modules.filter(x => x.rollup))
{
    console.log(`Rollup ${m.name}`);
    await runRollup(m.location, path.join(bundleDir, m.name + ".js"));
}

console.log(JSON.stringify(modules, null, 4));