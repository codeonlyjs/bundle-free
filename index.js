import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import express from 'express';
import { findNodeModules, escapeRegExp, thisDir, } from "./utils.js";
import { getPackage, getPackageExport, isBarePackage, isModulePackage } from "./packageUtils.js";


// Middleware for serving client side es6 module apps
export function bundleFree(options)
{
    // Clone options
    options = Object.assign({}, options);

    // Create a router
    let router = express.Router();

    // Work out if we need to do HTML file patching
    let needHtmlPatching = 
        options.inYaFace || 
        options.livereload || 
        options.replace?.length > 0 ||
        options.modules?.length > 0;

    let needOurPublicFolder = 
        options.inYaFace;

    // Serve our public files
    if (needOurPublicFolder)
    {
        router.use("/bundle-free/public", express.static(path.join(thisDir(), "public"), { index: false }));
    }

    // Create import map to be injected into served html files
    let imports = null;
    let rxModuleRef = null;
    let exported_modules = new Map();
    if (options.modules?.length > 0)
    {        
        imports = {};

        // Should only use this in development mode
        if (process.env.NODE_ENV == "production")
        {
            console.error("WARNING: bundle-free module mapping is not intended to be used in production environments.");
        }
        
        // Find node modules if not specified
        if (!options.node_modules)
            options.node_modules = findNodeModules();

        // Generate import map with all specified and dependant modules
        for (let i=0; i<options.modules.length; i++)
        {
            let m = options.modules[i];
            
            // User import declaration?
            if (m.url)
            {
                imports[m.module] = m.url;
            }

            if (typeof(m) === 'string')
            {
                options.modules[i] = m = { module: m }
            }

            if (m.module)
            {
                m.package = getPackage(options, m.module);
                exported_modules.set(m.module, m.package);

                // Is this a module package?
                if (isBarePackage(m.package) && isModulePackage(m.package))
                {
                    m.package.bundleMode = "bundle";
                }
                else
                {
                    for (let d of m.package.$all_deps)
                    {
                        exported_modules.set(d.name, d);
                    }
                }
            }
        }

        // Add module imports to import map
        // (add both bare name and '/' path name)
        for (let [k,b] of exported_modules.entries())
        {
            imports[k] = `{{base}}node_modules/bundle-free/${k}`;
            imports[`${k}/`] = `{{base}}node_modules/bundle-free/${k}/`;
        }

        // Generate a regexp to match anything in a .html file that looks like a reference
        // to one of the listed modules
        let moduleNames = options.modules
                                .filter(x => !!x.module)
                                .map(m => escapeRegExp(m.module))
        let rxModuleNames = `(?:${moduleNames.join("|")})`;
        rxModuleRef = new RegExp(`([\\\'\\\"])(${rxModuleNames}\/)`, "g");
    
        // Rewrite request for package entry points, possibly
        // running rollup if necessary
        router.use(async (req, res, next) => {

            if (req.method != "GET" && req.method != "HEAD")
                return next();

            let base = req.baseUrl;

            // Is it a module request?
            let m = req.path.match(/^\/node_modules\/bundle-free\/((?:@[^\/]+\/)?[^\/]+)(\/.*)?$/);
            if (m)
            {
                let pkg = exported_modules.get(m[1]);

                if (pkg.bundleMode == "bundle")
                {
                    let rollupModule = await import("./rollupModule.js");
                    let url = await rollupModule.rollupModule(options, pkg, ".", false);
                    req.url = base + "/" + url;
                }
                else
                {
                    let import_file = getPackageExport(pkg, m[2], [ "import" ]);
                    if (import_file)
                    {
                        return res.redirect(`${base}/node_modules/${m[1]}/${import_file}`);
                    }
                    else
                    {
                        let rollupModule = await import("./rollupModule.js");
                        let url = await rollupModule.rollupModule(options, pkg, m[2]);
                        req.url = base + "/" + url;
                    }
                }
            }

            next();
        });
    
        // Serve the node_modules folder
        router.use(`/node_modules`, express.static(options.node_modules, { index: false }));
    }

    // Resolve default filename and map unknown urls to spa index.html (if spa enabled)
    router.use(async (req, res, next) => {

        if (req.method != "GET" && req.method != "HEAD")
            return next();

        try
        {
            // Check if file exists?
            let s = await fs.stat(path.join(options.path, req.path));

            // Make sure directory requests end with /
            if (s.isDirectory())
            {
                if (!req.path.endsWith("/"))
                {
                    let u = new URL(req.originalUrl)
                    u.pathname += "/";
                    return res.redirect(u.href);
                }

                if (options.spa)
                {
                    req.url = replaceUrlPath(req.url, "/" + resolveDefault(req, res));
                }
                else if (req.path.endsWith("/"))
                {
                    let def = resolveDefault(req, res);
                    if (def)
                        req.url = replaceUrlPath(req.url, req.path + "/" + resolveDefault(req, res));
                }
            }
        }
        catch
        {
            // Not a known file?
            if (options.spa)
            {
                req.url = replaceUrlPath(req.url, "/" + resolveDefault(req, res));
            }
        }

        // Carry on
        next();
    });
        
    
    // Patch HTML file
    if (needHtmlPatching)
    {
        router.use(async (req, res, next) => {

            if (req.method != "GET" && req.method != "HEAD")
                return next();
                
            if (req.path.match(/(?:.htm|.html)$/i))
            {
                try
                {
                    await patch_html_file(req.baseUrl, path.join(options.path, req.path));
                    return;
                }
                catch
                {
                    // Probably file not found, pass it on
                    // fall through and keep looking in other middlewares
                }
            }

            next();
        })
    }

    // Serve everything else directly from the client directory
    router.use(express.static(options.path, { index: false }));

    // Attach helpers
    Object.assign(router, { 
        patch_html,
        patch_html_file,
    });

    return router;

    // Helper to patch html for import map, inYaFace, livereload and user replacements
    async function patch_html_file(base, filename)
    {
        // Read the content
        let content = await fs.readFile(filename, "utf8");
        return patch_html(base, content);
    }

    function patch_html(base, content)
    {
        // Fix up non-relative paths to node modules
        if (rxModuleRef)
            content = content.replace(rxModuleRef, (m, delim, module) => `${delim}${base}node_modules/${module}`);

        // Create import map with correct /base/
        let basedImports = { };
        for (let k of Object.keys(imports))
        {
            basedImports[k] = imports[k].replace(/\{\{base\}\}/g, base + "/");
        }

    
        // Update <head>
        content = content.replace(/<head>([\s\S]*?)<\/head>/, (m, head) => {

            // Replace existing import map
            let didUpdateExisting = false;
            head = head.replace(/<script\s+type\s*=\s*"importmap"\s*>([\s\S]*?)<\/script>/, (m, oldmap) => {
                didUpdateExisting = true;
                let existing = JSON.parse(oldmap);
                Object.assign(existing.imports, basedImports);
                return `<script type="importmap">${JSON.stringify(existing, null, 4)}</script>`;
            });

            // No existing import map, add one
            if (!didUpdateExisting)
            {
                head = `\n    <script type="importmap">${JSON.stringify({ imports: basedImports }, null, 4)}</script>${head}\n`;
            }
        
            // In ya face?
            if (options.inYaFace)
                head = `\n    <script src="${base}/bundle-free/public/inYaFace.js"></script>${head}\n`;

            // Return update <head>
            return `<head>${head}</head>`;
        });


        // Live reload?
        if (options.livereload)
        {
            let port = typeof(options.livereload) === "Number" ? options.livereload : 35729; 
            content = content.replace("</body>", `
<script>
    document.write('<script src="http://' + (location.host || 'localhost').split(':')[0] + ':${port}/livereload.js?snipver=1"></' + 'script>')
</script>
</body>`);
        }

        // User replacements
        if (options.replace)
        {
            for (let r of options.replace)
            {
                let rx = typeof(r.from) === 'string' ? new RegExp(escapeRegExp(r.from), "g") : r.from;
                content = content.replace(rx, r.to);
            }
        }

        // Send it
        res.send(content);
    }

    // Helper to resolve default eg: "index.html"
    function resolveDefault(req, res)
    {
        if (options.default instanceof Function)
        {
            return options.default(req, res);
        }
        return options.default ?? "index.html";
    }
}


function replaceUrlPath(oldUrl, newPath)
{
    let u = new URL(oldUrl, "http://x");
    return newPath + u.search;
}