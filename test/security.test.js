import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModuleMapper, defaultAllowedExtensions } from '../ModuleMapper.js';

let root, baseDir, outside;

function write(file, content)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-free-test-")));
    baseDir = path.join(root, "project");
    outside = path.join(root, "outside");

    write(path.join(baseDir, "package.json"), JSON.stringify({ dependencies: { esm: "1", cjs: "1", linked: "1" } }));
    write(path.join(baseDir, "server.js"), "const secret = 'xyz';");
    write(path.join(baseDir, "extra", "thing.js"), "export default 1;");

    // ES6 module package
    let esm = path.join(baseDir, "node_modules", "esm");
    write(path.join(esm, "package.json"), JSON.stringify({ name: "esm", type: "module", main: "index.js" }));
    write(path.join(esm, "index.js"), "export default 1;");
    write(path.join(esm, "sub.js"), "export let x = 1;");
    write(path.join(esm, "style.css"), "body {}");
    write(path.join(esm, "data.json"), "{}");
    fs.symlinkSync(path.join(baseDir, "server.js"), path.join(esm, "escape.js"));

    // CommonJS package
    let cjs = path.join(baseDir, "node_modules", "cjs");
    write(path.join(cjs, "package.json"), JSON.stringify({ name: "cjs", main: "index.js" }));
    write(path.join(cjs, "index.js"), "module.exports = 1;");

    // Package located outside the project (eg: npm link)
    write(path.join(outside, "linked", "package.json"), JSON.stringify({ name: "linked", type: "module", main: "index.js" }));
    write(path.join(outside, "linked", "index.js"), "export default 1;");
    write(path.join(outside, "other.js"), "export default 1;");
    fs.symlinkSync(path.join(outside, "linked"), path.join(baseDir, "node_modules", "linked"), "dir");
});

after(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function mapper(options)
{
    return new ModuleMapper(Object.assign({ baseDir, modules: ["*"] }, options));
}

function fileUrl(m, file)
{
    return `/modules/$/${m.encodePath(file)}`;
}

test("serves files from mapped modules, including those outside the project", async () => {
    let m = mapper();
    let file = path.join(baseDir, "node_modules", "esm", "sub.js");
    assert.deepEqual(await m.mapUrl(fileUrl(m, file)), { file });

    let linked = path.join(outside, "linked", "index.js");
    assert.match(fileUrl(m, linked), /\$\$/);
    assert.deepEqual(await m.mapUrl(fileUrl(m, linked)), { file: linked });
});

test("module entry point proxies to an allowed file", async () => {
    let m = mapper();
    for (let name of ["esm", "linked"])
    {
        let action = await m.mapUrl(`/modules/${name}`);
        assert.equal(action.contentType, "application/javascript");
        let target = action.content.match(/from '([^']+)'/)[1];
        assert.ok((await m.mapUrl(target)).file);
    }
});

test("module css is served", async () => {
    let m = mapper();
    assert.deepEqual(await m.mapUrl("/modules/esm/style.css"), { file: path.join(baseDir, "node_modules", "esm", "style.css") });
});

test("cjs modules are rolled up", async () => {
    let m = mapper();
    let action = await m.mapUrl("/modules/cjs");
    assert.equal(action.contentType, "application/javascript");
});

test("$$ can't escape to arbitrary files", async () => {
    let m = mapper();
    let up = "$$/".repeat(30);
    assert.deepEqual(await m.mapUrl(`/modules/$/${up}etc/passwd`), { notFound: true });
    assert.deepEqual(await m.mapUrl(fileUrl(m, path.join(outside, "other.js"))), { notFound: true });
});

test("files in baseDir aren't served by default", async () => {
    let m = mapper();
    assert.deepEqual(await m.mapUrl("/modules/$/server.js"), { notFound: true });
    assert.deepEqual(await m.mapUrl("/modules/$/package.json"), { notFound: true });
    assert.deepEqual(await m.mapUrl("/modules/$"), { notFound: true });
});

test("allowedDirs permits additional directories", async () => {
    let m = mapper({ allowedDirs: ["extra"] });
    assert.deepEqual(await m.mapUrl("/modules/$/extra/thing.js"), { file: path.join(baseDir, "extra", "thing.js") });
    assert.deepEqual(await m.mapUrl("/modules/$/server.js"), { notFound: true });
});

test(".. in module url tail is rejected", async () => {
    let m = mapper();
    let up = "../".repeat(30);
    for (let url of [
        `/modules/esm/${up}etc/x.css`,
        `/modules/esm/${up}etc/passwd`,
        `/modules/esm/%2e%2e/%2e%2e/server.js`,
        `/modules/esm/..%2f..%2fserver.js`,
        `/modules/esm/..%5c..%5cserver.js`,
        `/modules/$/C:/Windows/win.ini`,
    ])
    {
        assert.deepEqual(await m.mapUrl(url), { notFound: true }, url);
    }
});

test("symlinks can't escape allowed directories", async () => {
    let m = mapper();
    assert.deepEqual(await m.mapUrl(fileUrl(m, path.join(baseDir, "node_modules", "esm", "escape.js"))), { notFound: true });
    assert.deepEqual(await m.mapUrl("/modules/esm/escape.js"), { notFound: true });
});

test("missing files are not found (and don't throw)", async () => {
    let m = mapper();
    assert.deepEqual(await m.mapUrl("/modules/esm/missing.js"), { notFound: true });
    assert.deepEqual(await m.mapUrl("/modules/$/node_modules/esm/missing.js"), { notFound: true });
});

test("file extensions are restricted, and can be customized", async () => {
    let json = path.join(baseDir, "node_modules", "esm", "data.json");
    let css = path.join(baseDir, "node_modules", "esm", "style.css");

    assert.ok(!defaultAllowedExtensions.includes(".json"));

    let m = mapper();
    assert.deepEqual(await m.mapUrl(fileUrl(m, json)), { notFound: true });

    m = mapper({ allowExtensions: ["json"], disallowExtensions: [".css"] });
    assert.deepEqual(await m.mapUrl(fileUrl(m, json)), { file: json });
    assert.deepEqual(await m.mapUrl(fileUrl(m, css)), { notFound: true });
    assert.deepEqual(await m.mapUrl("/modules/esm/style.css"), { notFound: true });
});

test("unsafeAllowAnyFile restores old behaviour", async () => {
    let m = mapper({ unsafeAllowAnyFile: true });
    assert.deepEqual(await m.mapUrl("/modules/$/server.js"), { file: path.join(baseDir, "server.js") });
});
