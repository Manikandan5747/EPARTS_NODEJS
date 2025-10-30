const express = require("express");
const path = require("path");
const staticPaths = require("@libs/folders-paths/static-paths");

function setupStaticFiles(app) {
  staticPaths.forEach(({ route, dir }) => {
    const resolvedPath = path.resolve(dir);
    app.use(route, express.static(resolvedPath));
    console.log(`📁 Serving static path: ${route} → ${resolvedPath}`);
  });
}

module.exports = setupStaticFiles;
