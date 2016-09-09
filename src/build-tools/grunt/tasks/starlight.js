/*
 * grunt-starlight
 * https://github.com/paulcuth/starlight
 *
 * Copyright (c) 2015 Paul Cuthbertson
 * Licensed under the MIT license.
 */

'use strict';

const parser = require('luaparse');
const vlq = require('vlq');
const codeGen = require('../lib/code-generator');
const SourceMapper = require('../lib/SourceMapper');
const path = require('path');


function parseFile(filePath, content, options) {
  var ast = parser.parse(content, { locations: true });
  var modPath = path.relative(options.basePath, filePath);
  modPath = modPath.replace(/\//g, '.').replace(/\.lua$/, '');

  return {
    filePath,
    modPath,
    content,
    ast,
  };
}


module.exports = function(grunt) {
  // Please see the Grunt documentation for more information regarding task
  // creation: http://gruntjs.com/creating-tasks

  grunt.registerMultiTask('starlight', 'A Lua -> ES6 transpiler', function() {
    // Merge task-specific and/or target-specific options with these defaults.
    const options = this.options({
      basePath: '',
      sourceMap: false,
    });

    // Iterate over all specified file groups.
    this.files.forEach(function(f) {
      let mainFilename = options.main;
      let firstFilename;

      const sourceMapper = new SourceMapper({
        bootstrap: {
          filename: 'starlight.js',
          content: '-- Starlight bootstrap code',
        },
      });

      const runtimeInit = codeGen.getRuntimeInit();
      sourceMapper.pushBootstrap(runtimeInit);

      f.src
        .filter(function (filePath) {
           return grunt.file.exists(filePath) || grunt.log.warn(`Source file '${filePath}' not found.`);
        })
        .map(function (filePath) {
          return parseFile(filePath, grunt.file.read(filePath), options);
        })
        .forEach(function (file) {

          // Store first filename, to use as default entry point if none given
          if (!firstFilename) {
            firstFilename = file.modPath;
          }

          // Add file to source mapper
          const filename = path.relative(path.dirname(f.dest), file.filePath);
          sourceMapper.addFile({
            filename,
            content: file.content,
          });

          // Push file to source mapper

          const modname = file.modPath;
          const { scope, scopeDef } = codeGen.extendScope(0);
          const moduleBootstrapPrefix = `__star_call($get($, 'rawset'), Tget($get($, 'package'), 'preload'), '${modname}', (__star_tmp = function (...args) { ${scopeDef} $.setVarargs(args);\n`;
          const moduleBootstrapSuffix = `;return [];}, __star_tmp.toString = () => 'function: [preloaded: ${modname}]', __star_tmp));\n`;
          const tree = codeGen.generateTree(file.ast, scope);

          sourceMapper.pushBootstrap(moduleBootstrapPrefix);
          sourceMapper.pushTree({ tree, filename });
          sourceMapper.pushBootstrap(moduleBootstrapSuffix);
        });


      // Calculate main file
      if (mainFilename) {
        mainFilename = mainFilename.replace(/\//g, '.').replace(/\.lua$/, '');

      } else {
        mainFilename = firstFilename;
        if (sourceMapper.files.length > 1) {
          grunt.log.writeln(`No main file specified, using '${mainFilename}'.`);
          grunt.log.writeln("To specify the entry point, pass a config object to gulp-starlight with a 'main' property.");
        }
      }

      // Push init code
      sourceMapper.pushBootstrap(`__star_call($get($, 'require'), '${mainFilename}');`);

      // Write output and source map files
      const { output, sourceMap } = sourceMapper.render({ outputFilename: f.dest });
      const sourceMapLink = options.sourceMap ? `\n//# sourceMappingURL=${path.basename(f.dest)}.map` : '';

      const outputWritten = grunt.file.write(f.dest, `;(()=>{${output}})();${sourceMapLink}`);
      if (outputWritten) {
        grunt.log.writeln(`File "${f.dest}" created.`);
      }

      if (options.sourceMap) {
        const mapWritten = grunt.file.write(`${f.dest}.map`, sourceMap);
        if (mapWritten) {
          grunt.log.writeln(`File "${f.dest}.map" created.`);
        }
      }

    });
  });
};
