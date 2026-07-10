import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { isModulePackage, getPackageExport } from './packageUtils.js';
import { runRollup } from './rollupModule.js';
import { doesEs6ModuleHaveDefaultExport, escapeRegExp, readPackageFile } from './utils.js';
import merge from "deepmerge";


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
        }, options);

        // Store options
        this.#options = options;

        // Resolve modules
        this.#resolveModules();

        // Regex for [@company/]module or '$'
        let rxModuleName = "((?:(?:(?:@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/))?(?:[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?))|\\$)"

        // Regex to match url that we need to deal with
        this.#rxUrl = new RegExp("^" + escapeRegExp(options.moduleBaseUrl + "/") + rxModuleName + "(?:\/(.*))?$");
    }

    #options;
    #moduleMap;
    #rxUrl;

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

        // File system?
        if (moduleName == '$')
        {
            // This is direct file load url
            return {
                file: this.decodePath(tail),
            }
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
                    return {
                        file: path.join(module.location, cssFile),
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
                // Fully qualify path
                file = path.join(module.location, file);

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
            let code = await runRollup(path.join(module.location, file));
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

