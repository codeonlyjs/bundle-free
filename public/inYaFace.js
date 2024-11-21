(function () {
    let div;
    let count = 0;
    let styleNode;

    const styles = `
.in-ya-face
{
    all: unset;
    border: 1px solid red;
    padding: 10px;
    background-color:#600000e0; 
    color:#eee;
    font-family:sans-serif;
    font-size: 12pt;
    position:fixed;
    left:40px;
    right:40px;
    top:40px;
    z-index: 10000;
}
.in-ya-face *,
.in-ya-face *:before,
.in-ya-face *:after
{
    margin: initial;
    padding: initial;
    background: unset;
}
.in-ya-face h2,
.in-ya-face p
{
    margin: 10px 0;
}
.in-ya-face button
{
    padding: 7px;
    border: none;
    font-size: 15pt;
    color: #ccc;
    position:absolute;
    top:10px;
    right:10px
}
.in-ya-face button:hover
{
    color: white;
}
.in-ya-face pre
{
    overflow: auto;
}
.in-ya-face pre.code
{
    border: 1px solid #808080; 
    background-color: black; 
    padding: 10px; 
}
.in-ya-face .pre-error-lines
{
    color:#bbb;
}
.in-ya-face .error-line
{
    color:orange;
}
.in-ya-face .error-message-line
{
    color:white;
}
.in-ya-face .other-errors
{
    text-align: center;
}
`

    // Hook up for error events
    window.addEventListener("unhandledrejection", (ev) => {
        // Try to convert the unhandled rejection error into same format as "error"
        let ev2 = { 
            error: ev.reason.message,
        };
        let loc = ev.reason.stack.match(/\((.*?):(\d+):(\d+)\)$/m);
        if (loc)
        {
            ev2.filename = loc[1];
            ev2.lineno = parseInt(loc[2]);
            ev2.colno = parseInt(loc[3]);   
            ev2.stack = ev.reason.stack;
        }
        showError(ev2);
    });
    window.addEventListener("error", showError);
    
    async function showError(ev) 
    {
        if (!ev.error)
            return;

        // Don't show more than once at a time...
        if (div)
        {
            count++;
            div.style.removeProperty("display");
            div.querySelector(".other-errors").innerText = `and ${count} more...`;
            return;
        }

        // Reset displayed error count
        count = 0;

        // Create HTML description of error
        let html;
        html = `<h2>${htmlEncode(ev.error)}</h2>`;
        if (ev.stack)
        {
            html += `<p><pre>${htmlEncode(ev.stack)}</pre></p>`;
        }
        else if (ev.lineno)
        {
            html += `<p>at <strong>${htmlEncode(ev.filename)}</strong> line <strong>${ev.lineno}</strong> column <strong>${ev.colno}</strong></p>\n`;
        }

        // Place holder for source code display
        html += `<div class="source-code"></div>`;

        // Placeholder for additional error count
        html += `<p class="other-errors"></p>`

        // Close button
        html += `<button>✖</button>`;

        // First time, create styles
        if (!styleNode)
        {
            // Register styles
            styleNode = document.createElement("style");
            styleNode.innerHTML = styles;
        }

        // Create an enclosing div and add to document
        div = document.createElement("div");
        div.classList.add("in-ya-face");
        div.style.display = "none";
        div.innerHTML = html;
        div.appendChild(styleNode);
        document.body.appendChild(div);

        // Close button handler
        let elButton = div.querySelector("button");
        elButton.addEventListener("click", (ev) => {
            div.remove();
            div = null;
        });

        
        // Try to get the source of the error
        // Note: this code is async and will inject the results into the error div, once source
        // code has been retrieved.
        if (ev.lineno)
        {
            try
            {
                // Get source file
                let src = await (await fetch(ev.filename)).text();

                //await new Promise(r => setTimeout(r, 2000));

                // Normalize line endings and split
                src = src.replace(/(?:\r\n|\n\r|\r|\n)/g, x => '\n');
                let lines = src.split('\n');
                let line = lines[ev.lineno-1];

                // Render snippet
                html = `<pre class="code"><code>`;
                const maxCol = 50;
                const maxColTrim = 35;
                if (ev.colno < maxCol)
                {
                    // Narrow enough column number, show a few lines before
                    html += `<span class="pre-error-lines">`;
                    html += lines.slice(Math.max(0, ev.lineno-10), ev.lineno-1).map(x => htmlEncode(x)).join("\n");
                    html += "</span>";
                    html += `\n<span class="error-line"><strong>${htmlEncode(line)}</strong></span>\n`;
                    html += `<span class="error-message-line">${" ".repeat(ev.colno-1)}╰─── ${htmlEncode(ev.error)}</span>\n`;
                }
                else
                {
                    // Wide column number, assume minimized code and show just a snippet of the error line
                    html += `<span class="error-line">${htmlEncode(line.substring(maxColTrim, maxColTrim + 100))}</span>\n`;
                    html += `<span class="error-message-line">${" ".repeat(ev.colno-1 - (maxColTrim))}╰─── ${htmlEncode(ev.error)}</span>\n`;
                }
                html += `</code></pre>\n`;
            }
            catch (err)
            {
                html = `<p>(couldn't retrieve source code - ${err.message})</p>`;
            }

            // Put source code into place holder
            div.querySelector(".source-code").innerHTML = html;
            div.style.removeProperty("display");
        }

        // Helper to encode html
        function htmlEncode(str)
        {
            if (str === null || str === undefined)
                return "";
            return (""+str).replace(/["'&<>]/g, function(x) {
                switch (x) 
                {
                    case '\"': return '&quot;';
                    case '&': return '&amp;';
                    case '\'':return '&#39;';
                    case '<': return '&lt;';
                    case '>': return'&gt;';
                }
            });
        }
    };
})();