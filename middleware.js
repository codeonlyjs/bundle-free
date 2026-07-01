import { ModuleMapper } from './ModuleMapper.js';
import { fileURLToPath } from 'node:url';
import { ensureRegExp } from './utils.js';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BundleFree ExpressJS middleware
export function bundleFreeMiddleware(options)
{
    // Setup default options
    options = Object.assign({
        baseDir: process.cwd(),
        replace: [],
        rules: [],
    }, options);

    // Make sure replacements are regex
    for (let rep in options.replace)
    {
        if (rep.from)
            rep.from = ensureRegExp(rep.url);
    }

    // Create manager
    let bf = new ModuleMapper(options);

    return async function(req, res, next) 
    {
        // Process URL rules
        if (processUrlRules(req, res, next))
            return;

        // Only interested in GET and HEAD requests
        if (req.method != "GET" && req.method != "HEAD")
            return next();

        // Our assets?
        if (req.path == "/inYaFace.js")
        {
            res.sendFile(path.join(__dirname, "public", "inYaFace.js"));
            return;
        }

        // Install output filter
        installOutputFilter(req, res);

        // Map module urls
        let action = await bf.mapUrl(req.path);
        if (action != null)
        {
            // Mapped to a file?
            if (action.file)
            {
                res.sendFile(action.file)
                return;
            }

            // Generated content?
            if (action.content)
            {
                res.type(action.contentType);
                res.send(action.content);
                return;
            }
        }

        // Continue
        return next();
    }

    function isBinaryFileType(path)
    {
        return path.match(/\.(png|jpe?g|gif|bmp|svg|webp|ico|pdf|zip|rar|7z|tar|gz|mp3|mp4|wav|ogg|avi|mov|wmv|woff2?|ttf|eot|otf|exe)$/) != null;
    }

    function installOutputFilter(req, res)
    {
        // Don't bother for common binary formats
        if (isBinaryFileType(req.path))
            return;

        const origEnd = res.end.bind(res);
        const chunks = [];

        res.write = (chunk, encoding, callback) =>
        {
            // handle overload: res.write(chunk, callback)
            if (typeof encoding === 'function')
            {
                callback = encoding;
                encoding = undefined;
            }
            if (chunk)
            {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
            }
            if (callback) 
                callback(); // pretend it flushed immediately
            return true;
        };

        res.end = (chunk, encoding, callback) =>
        {
            if (typeof chunk === 'function')
            {
                callback = chunk;
                chunk = undefined;
                encoding = undefined;
            } 
            else if (typeof encoding === 'function')
            {
                callback = encoding;
                encoding = undefined;
            }

            if (chunk)
            {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
            }

            // Get full body
            let body = Buffer.concat(chunks);

            // Get content type
            const contentType = (res.getHeader('content-type') || '').toString().split(';')[0].trim();

            let text;

            // Patch HTML
            if (contentType === 'text/html')
            {
                text = body.toString('utf8');

                // Inject import map
                text = bf.injectImportMap(text);

                // Inject live reload
                text = injectLiveReloadScript(text);

                // Inject inYaFace
                text = injectInYaFace(text);
            }

            // Other replacements (only for known content types)
            if (contentType)
            {
                for (let rep of options.replace)
                {
                    // Matching content type
                    if (rep.contentType && !contentType.match(rep.contentType))
                        continue;

                    // Matching path
                    if (rep.url && !req.path.match(rep.url))
                        continue;

                    // Get text
                    if (!text)
                        text = body.toString('utf8');

                    // Replace
                    text = text.replace(rep.from, rep.to);
                }
            }

            if (text)
                body = Buffer.from(text, 'utf8');
            
            res.removeHeader('content-length'); // let chunked encoding handle it
            return origEnd(body, callback);
        };
    };

    function injectLiveReloadScript(html)
    {
        // Live reload?
        if (!options.livereload)
            return html;

        let port = typeof(options.livereload.port) === "Number" ? options.livereload.port : 35729; 
        return html.replace("</body>", `
<script>
    document.write('<script src="http://' + (location.host || 'localhost').split(':')[0] + ':${port}/livereload.js?snipver=1"></' + 'script>')
</script>
</body>`);
    }

    function injectInYaFace(html)
    {
        if (!options.inYaFace)
            return html;

        let headFound = false;
        let result = html.replace(/<head>([\s\S]*?)<\/head>/, (m, head) => {

            // Flag that we found it
            headFound = true;

            head = `\n    <script src="/inYaFace.js"></script>${head}\n`;

            // Return update <head>
            return `<head>${head}</head>`;
        });

        if (!headFound)
            throw new Error("Couldn't find <head> block in html, unable to inject import map");

        return result;

    }

    function processUrlRules(req, res, next)
    {
        // Process rules...
        for (let rule of options.rules)
        {
            // Get the regex
            let rx = rule.redirect || rule.rewrite;

            // If the rule contains "://" also include the protocol and hostname in the test string
            let testUrl;
            if (rule.redirect && rx.toString().indexOf(":\\/\\/")>=0)
            {
                testUrl = req.protocol + "://" + req.headers.host + req.url;
            }
            else
            {
                testUrl = req.url;
            }

            // Apply the replacement
            let newUrl = testUrl.replace(rx, rule.to);
            if (newUrl === testUrl)
                continue;

            // Deliberate suppress url
            if (newUrl=="")
            {
                let err = new Error('Not Found');
                err.status = 404;
                next(err);
                return true;
            }

            // Redirect?
            if (rule.redirect)
            {
                res.redirect(newUrl);
                return true;
            }

            // Rewrite?
            if (rule.rewrite)
            {
                req.url = newUrl;
            }
        }

        return false;
    }
}

