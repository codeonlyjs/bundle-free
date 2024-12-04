# Bundle Free

BundleFree is an ExpressJS middleware for use during development that:

* serves NPM packages to the browser without requiring a bundler or build 
  server - and does so in a manner that's compatible with bundling for production

* can use Rollup to convert CommonJS modules to ES6 for use client side

* provides an easy way to inject livereload scripts so that when files are 
  saved during development the browser automatically refreshes and updates

* can display prominent in-browser JavaScript error messages


Notes: 

* this is only intended to be used during development - for production you
  should still use a bundler. 

* this is not a browserification tool and only works for NPM packages designed
  to work in browsers in the first place.


## Install

```
npm install --save codeonlyjs/bundle-free
```

## Usage

Suppose you have a client side ES6 app that's in the `./client` sub-folder
of your ExpressJS project. Also, assume the bundled version is
available in the `./client/dist` folder.

* For production we want to serve `./client/dist`.  

* For development we want to serve `./client`.

(Obviously, you can adjust paths to suit your project).

First, import the middleware:

```js
import { bundleFree } from '@codeonlyjs/bundle-free';
```

Next, "use" the middleware:

```js
if (process.env.NODE_ENV == "production")
{
    // Production, serve bundled app
    app.use(express.static(path.join(__dirname, "client/dist")));
}
else
{
    // Development, serve unbundled app
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Modules to be made available to the unbundled app
        modules: [ 
            '@scoped/package1',
            'package2'
        ],

    }));
}
```

Now, in your client side `.js` files you can directly reference any
modules listed in the `modules` option.

```js
// Client side script files can now import directly from the bare
// module name:
import * from '@scoped/package1';
```


## Other Import Map Entries

Since browsers only support a single ES6 import map, if you need to specify
other modules, use an object with `module` and `url` keys instead of a 
string in the modules list:

```js
    modules: [ 
        { module: '@scoped/package', url: "/mylibs/package/index.js" },
        'package2'
    ],
```

## Live Reload Script

Since bundle-free is patching `.html` files anyway, why not also inject in the 
[`livereload`](https://www.npmjs.com/package/livereload) script so that saving
files automatically updates the browser.

By setting the `livereload` option to either `true` (to use the default livereload
server port) or to port number, bundle-free will automatically insert the script
at the bottom of the page.

See [`livereload`](https://www.npmjs.com/package/livereload) for more.

eg:

```js
    // npm install --save livereload
    import livereload from 'livereload';

    // omitted...

    if (developmentMode)
    {
        // Development only
        app.use(bundleFree({

            // other settings omitted...

            // Insert the live reload script
            livereload: true,
        }));

        // Create live reload server and watch directories...
        let lrs = livereload.createServer();
        lrs.watch(path.join(__dirname, "client"));
    }

```

## Handling CommonJS

While BundleFree is designed primarily for serving ES6 NPM packages
it will also attempt to serve CommonJS packages.

If a referenced package or any of its dependencies are only available 
as CommonJS, BundleFree will use Rollup to convert the entire package to 
ES6 and serve the repackaged bundle.

YMMV


## Mounting in a Sub-path

Mounting on a sub-path is supported as follows:

```js
    app.use("/somepath", bundleFree({ ... }));
```



## Single Page Apps

Single page apps that use normal URL paths for in-page navigation need server
support to serve the main `index.html` file of the SPA for any URL that doesn't
match a file in the client directory.  

eg: suppose the page `http://somesite.com/products/productname` should 
    be handled by the single page app at `/index.html`

To support this, set the `spa` property to true:

```js
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Serve URLs that don't match a file as index.html
        spa: true;

        // Modules to be made available to the unbundled app
        modules: [ 
            '@scoped/module1',
            '@scoped/module2'
        ]

    }));
```

Since you probably want this same behaviour for the production release, you 
can use bundle-free without the module remapping:

```js
    app.use(bundleFree({
        path: path.join(__dirname, "client/dist"),
        spa: true,
    }));
```

Finally, if the `/index.html` file references relative files you'll probably
want to make them absolute too (otherwise they won't work in sub-path urls).

eg: suppose `index.html` references `./Main.js`, this won't work for a single page 
app if `index.html` is served in response to a request for `/sub/sub/page` - 
because the browser will try to request this as `/sub/sub/Main.js` which 
doesn't exist.

We can't just use an absolute URL in the `index.html` file because then the
bundler won't find it (at least Vite doesn't seem to)

By using the `replace` option we can serve the absolute path the `/Main.js`
during development, but leave the relative `./Main.js` in place for when
running the bundler.

```js
    replace: [
        { from: "./Main.js", to: "/Main.js" }
    ],
```

`from` can be a string or regular expression.


## Prominent Error Display

Usually web-browsers are fairly quiet about JavaScript errors unless
you bring up the debugger/inspector and check in the console.

BundleFree includes an option `inYaFace` that when set to true injects
a script that watches for client side JavaScript errors and displays
a very prominent "in your face" error message.


```js
    app.use(bundleFree({

        // Other options omitted

        // Display prominent errors
        inYaFace: true,

    }));
```

## Complete Example

Here's a complete example that supports single-page app mode, live reload 
and prominent error display.

```js
if (process.env.NODE_ENV == "production")
{
    app.use(bundleFree({
        path: path.join(__dirname, "client/dist"),
        spa: true,
    }));
}
else
{
    app.use(bundleFree({
        path: path.join(__dirname, "client"),
        modules: [ 
            '@scoped/module1',
            '@scoped/module2'
        ],
        replace: [
            { from: "./Main.js", to: "/Main.js" }
        ],
        spa: true,
        inYaFace: true,
        livereload: true
    }));

    // Create live reload server and watch directories...
    let lrs = livereload.createServer();
    lrs.watch(path.join(__dirname, "client"));
}
```

