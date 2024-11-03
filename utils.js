import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Path to self
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Find the node_modules folder 
let found_node_modules = undefined;
export function findNodeModulesRoot()
{
    // Already locations
    if (found_node_modules != undefined)
        return found_node_modules;

    let dir = __dirname;
    while (true)
    {
        let node_modules = path.join(dir, "node_modules");
        if (existsSync(node_modules))
            return found_node_modules = node_modules;
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

// Convert a URL pattern with * wildcards in to a regexp
export function patternToRegex(pattern)
{
    return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => {
        if (m == '*')
            return `(.*)`;
        else
            return m;
    })}$`);
}

// Check if a pathname exists
export function exists(pathname)
{
    return fs.stat(pathname)
                .then(() => true)
                .catch(() => false);
}


export async function tryUnlink(pathname)
{
    try
    {
        await fs.unlink(pathname);
    }
    catch
    {
        // don't care
    }
}