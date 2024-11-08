import path from 'node:path';
import { readFileSync } from 'node:fs';
import { findNodeModulesRoot, patternToRegex } from "./utils.js";

// Helper to walk the tree of package.json "exports" keys
// looking for a match
// - exports - the current key in the exports tree
// - exportName - the exported name we're looking for (typically ".")
// - conditions - user specified conditions - 
//                  eg: "import", "require", "browser" etc...
// - pathMatch - regexp result of match path from ancestor node
function matchExports(exports, exportName, conditions, pathMatch)
{
    // If this is a string then we've matched if the path 
    // has also matched, or the path "."
    if (typeof(exports) === 'string')
    {
        let target = exports;
        if (pathMatch)
            target = target.replace("*", pathMatch[1]);
        else if (exportName != '.')
            return null;
        return target;
    }

    // Check all keys for paths (they start with '.')
    for (let k of Object.keys(exports))
    {
        if (k.startsWith("."))
        {
            pathMatch = exportName.match(patternToRegex(k));
            if (pathMatch)
                return matchExports(exports[k], exportName, conditions, pathMatch);
        }
    }

    // Check all keys for conditions
    for (let c of conditions)
    {
        if (exports[c])
        {
            let match = matchExports(exports[c], exportName, conditions, pathMatch);
            if (match)
                return match;
        }
    }

    // Check for a default condition
    if (exports.default)
    {
        let match = matchExports(exports.default, exportName, conditions, pathMatch);
        if (match)
            return match;
    }

    // Doesn't match
    return null;
}

// Get the export file for a given export name from a module
// under certain conditions
// - pkg - package.json for the package
// - exportName - the exported name to locate
// - conditions - the conditions to match
export function getPackageExport(pkg, exportName, conditions)
{
    // Root or bare module name?
    if (!exportName || exportName == "" || exportName == "/")
        exportName = ".";

    // Use exports key if specified
    if (pkg.exports)
    {
        return matchExports(pkg.exports, exportName, conditions, null);
    }

    // Non-root path?
    if (exportName != ".")
    {
        if (conditions.indexOf("import") >= 0)
        {
            if (exportName.endsWith(".mjs") || pkg.type == "module")
                return exportName;
            else
                return null;
        }
        if (conditions.indexOf("requires") >= 0)
        {
            if (exportName.endsWith(".cjs") || pkg.type != "module")
                return exportName;
            else
                return null;
        }
        return exportName;
    }

    // Default export "main: xxx"
    if (conditions.indexOf('import') >= 0)
    {
        if (pkg.module)
            return pkg.module;
        if (pkg.main)
        {
            if (pkg.main.endsWith(".mjs"))
                return pkg.main;
            if (pkg.main.endsWith(".js") && pkg.type == "module")
                return pkg.main;
        }
    }

    if (conditions.indexOf('require') >= 0)
    {
        if (pkg.main)
        {
            if (pkg.main.endsWith(".cjs"))
                return pkg.main;
            if (pkg.main.endsWith(".js") && (pkg.type === undefined || pkg.type == "commonjs"))
                return pkg.main;
        }

        if (pkg.type === undefined || pkg.type === "commonjs")
            return "index.js";
    }

    return null;
}


// Cache of previously loaded module infos
let pkgMap = new Map();

// Get the package file for a module
export function getPackage(moduleName)
{
    // Check if already loaded
    let pkg = pkgMap.get(moduleName);
    if (pkg)
        return pkg;

    // Load package.json
    let moduleDir = path.join(findNodeModulesRoot(), moduleName);
    pkg = JSON.parse(readFileSync(path.join(moduleDir, "package.json")));

    // Add to map
    pkgMap.set(moduleName, pkg);

    // Build full list of dependencies
    pkg.$all_deps = [];
    if (pkg.dependencies)
    {
        for (let dep of Object.keys(pkg.dependencies))
        {
            let depPkg = getPackage(dep);
            pkg.$all_deps.push(depPkg, ...depPkg.$all_deps);
        }
    }

    return pkg;
}

// Check if a package is a ES6 module
export function isModulePackage(pkg)
{
    return getPackageExport(pkg, '.', [ "import" ]) != null;
}

// Check if a package only supports bare "." exports
// and no sub-module exports.
export function isBarePackage(pkg)
{
    if (!pkg.exports)
        return false;

    return is_bare(pkg.exports);

    function is_bare(exports)
    {
        if (typeof(exports) === 'string')
            return true;
        for (let k of Object.keys(exports))
        {
            if (k.startsWith('.') && k!='.')
                return false;
            if (!is_bare(exports[k]))
                return false;
        }
        return true;
    }
}