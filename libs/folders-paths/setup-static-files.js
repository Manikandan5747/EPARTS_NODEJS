const express = require("express");
const path = require("path");
const staticPaths = require("@libs/folders-paths/static-paths");
// const checkApiKey = require('@libs/JWT/apikey-auth-api');

function setupStaticFiles(app) {
  staticPaths.forEach(({ route, dir }) => {
    const resolvedPath = path.resolve(dir);
    // Apply API Key middleware before serving static files
    app.use(route,  express.static(resolvedPath));
    console.log(`📁 Serving static path: ${route} → ${resolvedPath}`);
  });
}

module.exports = setupStaticFiles;
