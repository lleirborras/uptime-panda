const jsesc = require("jsesc");
const { escape: htmlEscape } = require("html-escaper");

/**
 * Returns a string that represents the javascript that is required to insert the Umami Analytics script
 * into a webpage.
 * @param {string} scriptUrl the Umami Analytics script url.
 * @param {string} websiteId Website ID to use with the Umami Analytics script.
 * @returns {string} HTML script tags to inject into page
 */
function getUmamiAnalyticsScript(scriptUrl, websiteId) {
    let escapedScriptUrlJS = jsesc(scriptUrl, { isScriptContext: true });
    let escapedWebsiteIdJS = jsesc(websiteId, { isScriptContext: true });

    if (escapedScriptUrlJS) {
        escapedScriptUrlJS = escapedScriptUrlJS.trim();
    }

    if (escapedWebsiteIdJS) {
        escapedWebsiteIdJS = escapedWebsiteIdJS.trim();
    }

    // Escape the Script url for use in an HTML attribute.
    let escapedScriptUrlHTMLAttribute = htmlEscape(escapedScriptUrlJS);

    // Escape the website id for use in an HTML attribute.
    let escapedWebsiteIdHTMLAttribute = htmlEscape(escapedWebsiteIdJS);

    return `
        <script defer src="${escapedScriptUrlHTMLAttribute}" data-website-id="${escapedWebsiteIdHTMLAttribute}"></script>
    `;
}

module.exports = {
    getUmamiAnalyticsScript,
};
