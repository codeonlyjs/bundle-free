import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Path to self
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Find the node_modules folder 
export function findNodeModulesRoot()
{
    let dir = __dirname;
    while (true)
    {
        let node_modules = path.join(dir, "node_modules");
        if (existsSync(node_modules))
            return node_modules;
        let parentDir = path.dirname(dir);
        if (parentDir == dir)
        {
            throw new Error("Failed to locate node_modules");
        }
        dir = parentDir;
    }
}


// Helper to escape a string for use in a regular expression
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pattern_to_regex(pattern)
{
    return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => {
        if (m == '*')
            return `(.*)`;
        else
            return m;
    })}$`);
}

function match_exports(exports, exportName, conditions, pathMatch)
{
    if (typeof(exports) === 'string')
    {
        let target = exports;
        if (pathMatch)
            target = target.replace("*", pathMatch[1]);
        else if (exportName != '.')
            return null;
        return target;
    }

    for (let k of Object.keys(exports))
    {
        if (k.startsWith("."))
        {
            pathMatch = exportName.match(pattern_to_regex(k));
            if (pathMatch)
                return match_exports(exports[k], exportName, conditions, pathMatch);
        }
    }

    for (let c of conditions)
    {
        if (exports[c])
        {
            let match = match_exports(exports[c], exportName, conditions, pathMatch);
            if (match)
                return match;
        }
    }

    if (exports.default)
    {
        let match = match_exports(exports.default, exportName, conditions, pathMatch);
        if (match)
            return match;
    }

    return null;
}

// Get the ESM preferred entry point to a package
export function getPackageExport(pkg, exportName, conditions)
{
    if (!exportName || exportName == "" || exportName == "/")
        exportName = ".";

    if (pkg.exports)
    {
        return match_exports(pkg.exports, exportName, conditions, null);
    }

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

export function exists(pathname)
{
    return fs.stat(pathname)
                .then(() => true)
                .catch(() => false);
}