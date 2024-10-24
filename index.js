import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import express from 'express';

// Path to self
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Find the node_modules folder 
function find_node_modules()
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

let node_modules = find_node_modules();

// Helper to escape a string for use in a regular expression
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Middleware for serving client side es6 module apps
export function bundleFree(options)
{
    // Work out the app prefix where to mount
    let prefix = options.prefix ?? "/";
    if (!prefix.endsWith("/"))
        prefix += "/";

    // Create import map to be injected into served html files
    let importMap = null;
    let rxModuleRef = null;
    if (options.modules?.length > 0)
    {
        // Should only use this in development mode
        if (process.env.NODE_ENV == "production")
        {
            console.error("WARNING: bundle-free module mapping is not intended to be used in production environments.");
        }
        

        // Generate import map
        importMap = { imports: {} };
        for (let i=0; i<options.modules.length; i++)
        {
            let m = options.modules[i];
            if (typeof(m) === 'string')
            {
                let pkgDir = path.join(node_modules, m);
                let pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json")));
                m = {
                    module: m,
                    url: `${prefix}node_modules/${m}/${pkg.main ?? "index.js"}`,
                };
                options.modules[i] = m
            }

            importMap.imports[m.module] = m.url;
        }

        // Generate a regexp to match anything in a .html file that looks like a reference
        // to one of the listed modules
        let rxModuleNames = `(?:${options.modules.map(m => escapeRegExp(m.module)).join("|")})`;
        rxModuleRef = new RegExp(`([\\\'\\\"])(${rxModuleNames}\/)`, "g");
    }


    // Create a router
    let router = express.Router();

    // Handler to inject importmap into html files
    router.use(prefix, async (req, res, next) => {

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
    router.use(prefix, express.static(options.path, { index: false }));

    // Serve the node_modules folder
    router.use(`${prefix}node_modules`, express.static(node_modules, { index: false }));

    // If still not found, patch the default html file (if this is an SPA app)
    router.use(prefix, async (req, res, next) => {
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
            content = content.replace(rxModuleRef, (m, delim, module) => `${delim}${prefix}node_modules/${module}`);
        
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
