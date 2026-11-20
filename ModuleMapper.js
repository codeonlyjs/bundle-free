import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { isModulePackage, getPackageExport } from './packageUtils.js';
import { runRollup } from './rollupModule.js';
import { doesEs6ModuleHaveDefaultExport, escapeRegExp, readPackageFile } from './utils.js';
import merge from "deepmerge";

/** File extensions served by default (via the `$` file route and module css/js routes) */
export const defaultAllowedExtensions = Object.freeze([
    ".js", ".mjs", ".css", ".map", ".wasm",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
]);

// Returned from mapUrl when a request is related to module mapping
// but is not permitted (or doesn't exist)
const NOT_FOUND = Object.freeze({ notFound: true });

// Check if a path is equal to or contained within a root directory
// (both paths must be absolute and normalized)
function isPathInside(root, file)
{
    if (process.platform === "win32")
    {
        root = root.toLowerCase();
        file = file.toLowerCase();
    }
    let rel = path.relative(root, file);
    if (rel === "")
        return true;
    return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

// Check that each segment of a URL tail is safe to map to a file system path
// (no "..", no back slashes, no null characters and no drive letters)
function isSafeUrlTail(tail)
{
    if (!tail)
        return true;
    for (let part of tail.split("/"))
    {
        let decoded;
        try
        {
            decoded = decodeURIComponent(part);
        }
        catch
        {
            return false;
        }
        if (decoded === ".." || /[\\\0]/.test(decoded) || /^[a-zA-Z]:/.test(decoded))
            return false;
    }
    return true;
}


/** Handled module mapping */
export class ModuleMapper
{
    constructor(options)
    {
        // Setup default options
        options = Object.assign({
            baseDir: process.cwd(),
            moduleBaseUrl: "/modules",
            modules: [],
            autoDeps: true,
            allowedDirs: [],
            allowExtensions: [],
            disallowExtensions: [],
            unsafeAllowAnyFile: false,
        }, options);

        // Store options
        this.#options = options;

        // Resolve modules
        this.#resolveModules();

        // Work out which directories and file types can be served
        this.#resolveAllowedFiles();

        // Regex for [@company/]module or '$'
        let rxModuleName = "((?:(?:(?:@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/))?(?:[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?))|\\$)"

        // Regex to match url that we need to deal with
        this.#rxUrl = new RegExp("^" + escapeRegExp(options.moduleBaseUrl + "/") + rxModuleName + "(?:\/(.*))?$");
    }

    #options;
    #moduleMap;
    #rxUrl;
    #allowedDirs;
    #allowedExtensions;

    /** The (real path) directories from which files can be served
     * @type {string[]}
     */
    get allowedDirs() { return this.#allowedDirs; }

    /** The set of file extensions that can be served
     * @type {Set<string>}
     */
    get allowedExtensions() { return this.#allowedExtensions; }

    // Build the list of allowed directories and file extensions
    #resolveAllowedFiles()
    {
        let options = this.#options;

        if (options.unsafeAllowAnyFile)
        {
            console.warn("warning: bundle-free `unsafeAllowAnyFile` is enabled - any file on this machine can be served");
        }

        // Allowed extensions = defaults + allowExtensions - disallowExtensions
        let normExt = (x) => (x.startsWith(".") ? x : "." + x).toLowerCase();
        let exts = new Set(defaultAllowedExtensions);
        for (let x of options.allowExtensions ?? [])
            exts.add(normExt(x));
        for (let x of options.disallowExtensions ?? [])
            exts.delete(normExt(x));
        this.#allowedExtensions = exts;

        // Allowed directories = explicit allowedDirs + location of every mapped module
        let dirs = new Set();
        let addDir = (dir) => {
            try
            {
                dirs.add(fs.realpathSync(path.resolve(options.baseDir, dir)));
            }
            catch (err)
            {
                if (err.code != "ENOENT")
                    throw err;
            }
        };
        for (let dir of options.allowedDirs ?? [])
            addDir(dir);
        for (let m of this.#moduleMap.values())
        {
            if (m.location && !m.ignore && !m.url && !m.virtual)
                addDir(m.location);
        }
        this.#allowedDirs = [...dirs];
    }

    /**
     * Check if a file can be served
     * @param {string} file the fully qualified file path
     * @param {Object} [opts]
     * @param {string} [opts.within] the file must also be inside this directory (eg: the module location)
     * @param {boolean} [opts.checkExtension] whether to check the file extension (default true)
     * @returns {Promise<string|null>} the real path of the file, or null if not allowed
     */
    async checkFile(file, opts)
    {
        if (this.#options.unsafeAllowAnyFile)
            return file;

        opts = Object.assign({ checkExtension: true }, opts);

        // Check extension
        if (opts.checkExtension)
        {
            let ext = path.extname(file).toLowerCase();
            if (!this.#allowedExtensions.has(ext))
                return null;
        }

        // Resolve symlinks (also fails if file doesn't exist)
        let real;
        try
        {
            real = await fsPromises.realpath(file);
            if (!(await fsPromises.stat(real)).isFile())
                return null;
        }
        catch
        {
            return null;
        }

        // Check the extension of the real file too
        if (opts.checkExtension && !this.#allowedExtensions.has(path.extname(real).toLowerCase()))
            return null;

        // Must be within specified directory
        if (opts.within)
        {
            let within;
            try
            {
                within = await fsPromises.realpath(opts.within);
            }
            catch
            {
                return null;
            }
            if (!isPathInside(within, real))
                return null;
        }

        // Must be within an allowed directory
        if (!this.#allowedDirs.some(dir => isPathInside(dir, real)))
            return null;

        return real;
    }

    /** Given a html string, injects the module import map into it's <head> section */
    injectImportMap(html)
    {
        // Not necessary?
        if (this.#moduleMap.size == 0)
            return html;

        // Update <head>
        let headFound = false;
        let result = html.replace(/<head>([\s\S]*?)<\/head>/, (m, head) => {

            // Replace existing import map
            let didUpdateExisting = false;
            head = head.replace(/<script\s+type\s*=\s*"importmap"\s*>([\s\S]*?)<\/script>/, (m, oldmap) => {
                didUpdateExisting = true;
                let existing = JSON.parse(oldmap);
                Object.assign(existing.imports, this.importMap);
                return `<script type="importmap">${JSON.stringify(existing, null, 4)}</script>`;
            });

            // No existing import map, add one
            if (!didUpdateExisting)
            {
                head = `\n    <script type="importmap">${JSON.stringify({ imports: this.importMap }, null, 4)}</script>${head}\n`;
            }

            // Flag that we found it
            headFound = true;

            // Return update <head>
            return `<head>${head}</head>`;
        });

        if (!headFound)
            throw new Error("Couldn't find <head> block in html, unable to inject import map");

        return result;
    }

    /** Given a url, works out how to map it to a module 
    /* @param {string} url the url to map
    /* @returns {Object} an object that describes how to map it, or null of not related to module mapping.  
    /*                   Either { file: "" } or { contentType: "", content: ""}
    */
    async mapUrl(url)
    {
        // Is this a module specific url?
        let m = url.match(this.#rxUrl);
        if (m == null)
            return null;

        let [, moduleName, tail] = m;

        // Reject anything that tries to navigate outside the mapped location
        if (!this.#options.unsafeAllowAnyFile && !isSafeUrlTail(tail))
            return NOT_FOUND;

        // File system?
        if (moduleName == '$')
        {
            // This is direct file load url
            if (!tail)
                return NOT_FOUND;
            let file = await this.checkFile(this.decodePath(tail));
            if (!file)
                return NOT_FOUND;
            return { file };
        }

        // Find module
        let module = this.#moduleMap.get(moduleName);
        if (!module)
            return null;

        // Virtual module?
        if (tail && module.virtual)
        {
            return {
                contentType: "application/javascript",
                content: module.virtual,
            }
        }

        // Bare?
        if (!tail)
            tail = ".";
        else
        {
            tail = "./" + tail;

            if (tail.endsWith(".css"))
            {
                let cssFile = getPackageExport(module.package, tail, ["browser"]);
                if (cssFile)
                {
                    let file = await this.checkFile(path.join(module.location, cssFile), { within: module.location });
                    if (!file)
                        return NOT_FOUND;
                    return {
                        file,
                    }

                    /*
                    let cssContent = await fsPromises.readFile(path.join(module.location, cssFile), "utf8");
                    return {
                        contentType: "application/javascript",
                        content: 
`let styleEl = document.createElement("style");
styleEl.setAttribute("data-source", ${JSON.stringify(url)});
styleEl.textContent = ${JSON.stringify(cssContent)};
document.head.appendChild(styleEl);
export default styleEl;
`,
*/
                }
            }
        }

        // Don't serve ES6 module directly if client explicitly asked for module to be rolled up
        let file;
        if (!module.rollup)
        {
            // ES6 module?
            file = getPackageExport(module.package, tail, ["import", "browser"]);
            if (file != null)
            {
                // Fully qualify path and check it's allowed
                file = await this.checkFile(path.join(module.location, file), { within: module.location });
                if (!file)
                    return NOT_FOUND;

                // Generate a proxy for this module that fowards to the real file system location
                let content = `export * from '${this.#options.moduleBaseUrl}/$/${this.encodePath(file)}';` 
                if (await doesEs6ModuleHaveDefaultExport(file))
                    content += `\nexport { default } from '${this.#options.moduleBaseUrl}/$/${this.encodePath(file)}';` 

                // Send it
                return {
                    contentType: "application/javascript",
                    content,
                }
            }
        }

        // Roll up common js module
        file = getPackageExport(module.package, tail, ["require", "browser"]);
        if (file != null)
        {
            // Rollup entry point must be within the module (any extension)
            file = await this.checkFile(path.join(module.location, file), { within: module.location, checkExtension: false });
            if (!file)
                return NOT_FOUND;

            let code = await runRollup(file);
            return {
                contentType: "application/javascript",
                content: code,
            }
        }
    }


    /** 
     * Encode a path to URL format 
     * @param {string} filepath the file system path (fully qualified) to encode
     * @returns {string} the file path as a string suitable for use in a URL
     */
    encodePath(filepath)
    {
        // Make it relative
        var relPath = path.relative(this.#options.baseDir, filepath);

        // Forward slashes
        relPath = relPath.replace(/\\/g, "/");

        // Normalize by removing redundant ./ and replacing ../ with $$/
        const result = [];
        for (const part of relPath.split("/")) 
        {
            if (part === '' || part === '.') 
            {
                // Skip empty parts (from //) and ./
                continue;
            } 
            else if (part === '..') 
            {
                result.push('$$');
            } 
            else 
            {
                result.push(part);
            }
        }
        
        return result.join('/');
    }

    /** 
     * Decode a URL to a file path 
     * @param {string} url the url string to decode
     * @returns {string} a fully qualified file path
     */
    decodePath(url)
    {
        // Normalize by removing redundant ./ and replacing ../ with $up/
        const result = [];
        for (const part of url.split('/')) 
        {
            if (part === '' || part === '.') 
            {
                // Skip empty parts (from //) and ./
                continue;
            } 
            else if (part === '$$') 
            {
                result.push('..');
            } 
            else 
            {
                result.push(part);
            }
        }
        
        return path.resolve(this.#options.baseDir, result.join('/'));
    }

    /** The options this object was constructed with (and with defaults filled out) 
     * @type {Object}
     */
    get options() { return this.#options; }

    /** The module map 
     * @type {Map<string, Object>}
     */
    get moduleMap() { return this.#moduleMap; }

    /** Generate the import map 
     * @type {string}
     */
    get importMap()
    {
        // Create import map with correct /base/
        let im = { };

        for (let m of this.#moduleMap.values())
        {
            if (!m.url)
            {
                let url = this.options.moduleBaseUrl + "/" + m.name;
                im[m.name] = url;

                if (!m.virtual)
                    im[m.name + "/"] = url + "/";
            }
            else
            {
                im[m.name] = m.url;
            }
        }
        return im;
    }

    // Resolve module list
    #resolveModules()
    {
        let rootModules = new Map();
        let options = this.options;
        let self = this;

        // Work out all explicitly referenced modules
        for (let i=0; i<options.modules.length; i++)
        {
            let m = options.modules[i];

            // Simple "modulename"
            if (typeof(m) === 'string')
            {
                // All base modules?
                if (m === '*')
                {
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
                    continue;
                }
                m = { name: m };
            }

            // Must have a name
            if (!m.name)
                throw new Error("missing module `name` property");

            // Check not already defined
            let existing = rootModules.get(m.name) ?? {};

            // Setup module info
            let modinfo = Object.assign(existing, m);
            rootModules.set(modinfo.name, modinfo);
        }


        // Load root modules and all dependencies
        let modules = new Map();
        for (let m of [...rootModules.values()])
        {
            loadModule(m);
        }

        // Store modules
        this.#moduleMap = modules;

        function loadModule(m)
        {
            // Already loaded
            if (modules.has(m.name))
                return;
            modules.set(m.name, m);

            // Quit if to be ignore, virtual or already resolve
            if (m.ignore || m.url || m.virtual)
                return;

            // Locate the module
            if (!m.location)
            {
                m.location = locateModule(m.refloc ?? options.baseDir, m.name);
                if (!m.location)
                    return;
            }
            else
            {
                // Explicit location, resolve it
                m.location = path.resolve(self.options.baseDir, m.location);
            }

            // Setup url
            let url = self.encodePath(m.location);

            // Read package file
            let pkg = readPackageFile(m.location);
            if (!pkg)
            {
                console.error(`warning: no package.json file found for module ${m.name} (in ${m.location})`)
                pkg = {};
            } 
            m.package = merge.all([m.package ?? {}, pkg],  { arrayMerge: (d, s, opt) => s });

            // Does this package need to be rolled up?
            if (m.rollup === undefined)
                m.rollup = !isModulePackage(m.package);

            // If package is rolled up, then we don't need dependencies
            if (m.nodeps === undefined && m.rollup)
                m.nodeps = true;

            // Load all dependencies
            if (self.options.autoDeps && m.package.dependencies && m.nodeps !== true)
            {
                for (let dep of Object.keys(m.package.dependencies))
                {
                    // Get settings for this module
                    let settings = rootModules.get(dep) ?? {};

                    // Load dependencies
                    loadModule(Object.assign({ 
                        name: dep, 
                        refloc: m.location 
                    }, settings));
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
}

