import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import express from 'express';
import { findNodeModulesRoot, escapeRegExp } from "./utils.js";
import { getPackage, getPackageExport, isBarePackage, isModulePackage } from "./packageUtils.js";

// Find the closest "node_modules"
let node_modules = findNodeModulesRoot();



// Middleware for serving client side es6 module apps
export function bundleFree(options)
{
    // Work out the app base where to mount
    let base = options.base ?? "/";
    if (!base.endsWith("/"))
        base += "/";

    // Create import map to be injected into served html files
    let importMap = null;
    let rxModuleRef = null;
    let exported_modules = new Map();
    if (options.modules?.length > 0)
    {
        // Should only use this in development mode
        if (process.env.NODE_ENV == "production")
        {
            console.error("WARNING: bundle-free module mapping is not intended to be used in production environments.");
        }
        
        importMap = {
            imports: {
            },
        } 

        // Generate import map with all specified and dependant modules
        for (let i=0; i<options.modules.length; i++)
        {
            let m = options.modules[i];
            
            // User import declaration?
            if (m.url)
            {
                importMap.imports[m.module] = m.url;
            }

            if (typeof(m) === 'string')
            {
                options.modules[i] = m = { module: m }
            }

            if (m.module)
            {
                m.package = getPackage(m.module);
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
            importMap.imports[k] = `${base}node_modules/bundle-free/${k}`;
            importMap.imports[`${k}/`] = `${base}node_modules/bundle-free/${k}/`;
        }

        // Generate a regexp to match anything in a .html file that looks like a reference
        // to one of the listed modules
        let moduleNames = options.modules
                                .filter(x => !!x.module)
                                .map(m => escapeRegExp(m.module))
        let rxModuleNames = `(?:${moduleNames.join("|")})`;
        rxModuleRef = new RegExp(`([\\\'\\\"])(${rxModuleNames}\/)`, "g");
    }

    // Create a router
    let router = express.Router();

    // Handler to rewrite node_module paths and inject
    // import maps and replacements into html files
    router.use(base, async (req, res, next) => {

        // Is it a module request?
        let m = req.path.match(/^\/node_modules\/bundle-free\/((?:@[^\/]+\/)?[^\/]+)(\/.*)?$/);
        if (m)
        {
            let pkg = exported_modules.get(m[1]);

            if (pkg.bundleMode == "bundle")
            {
                let rollupModule = await import("./rollupModule.js");
                let url = await rollupModule.rollupModule(pkg, ".", false);
                req.url = base + url;
            }
            else
            {
                let import_file = getPackageExport(pkg, m[2], [ "import" ]);
                if (import_file)
                {
                    return res.redirect(`${base}node_modules/${m[1]}/${import_file}`);
                }
                else
                {
                    let rollupModule = await import("./rollupModule.js");
                    let url = await rollupModule.rollupModule(pkg, m[2]);
                    req.url = base + url;
                }
            }
        }

        // Work out filename being requested
        let filename = req.path;
        if (filename == "/")
        {
            var originalUrl = url.parse(req.originalUrl);
            if (!originalUrl.pathname.endsWith("/"))
            {
                originalUrl.pathname += "/";
                let urlNew = url.format(originalUrl);
                return res.redirect(urlNew);
            }
            filename = "/index.html";
        }

        // If it's a html file, inject the importmap so `import ... from "bare-module-name"` works.
        if (filename.match(/(?:.htm|.html)$/i))
        {
            try
            {
                await serve_html_file(req, res, path.join(options.path, filename));
                return;
            }
            catch
            {
                // Probably file not found, pass it on
                // fall through and keep looking in other middlewares
            }
        }

        next();
    });

    // Serve the client app folder
    router.use(base, express.static(options.path, { index: false }));

    // Serve the node_modules folder
    router.use(`${base}node_modules`, express.static(node_modules, { index: false }));

    // If still not found, patch the default html file (if this is an SPA app)
    router.use(base, async (req, res, next) => {
        if (options.spa)
        {
            try
            {
                await serve_html_file(req, res, path.join(options.path, options.default ?? "index.html"));
                return;
            }
            catch
            {
                next();
            }
        }
        else
        {
            next();
        }
    });

    return router;

    async function serve_html_file(req, res, filename)
    {
        // Only patch if needed
        if (rxModuleRef)
        {
            // Read the content
            let content = await fs.readFile(filename, "utf8");

            // Fix up non-relative paths to node modules
            content = content.replace(rxModuleRef, (m, delim, module) => `${delim}${base}node_modules/${module}`);
        
            // Insert import map in the <head> block
            content = content.replace("<head>", `<head>\n<script type="importmap">\n${JSON.stringify(importMap, null, 4)}\n</script>\n`);

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
        else
        {
            res.sendFile(filename);
        }
    }
}
