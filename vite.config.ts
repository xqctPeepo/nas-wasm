import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

// Custom plugin for dev server routing
function devServerRouting(): Plugin {
  return {
    name: 'dev-server-routing',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (!url) {
          next();
          return;
        }

        // Only handle HTML requests (not assets)
        if (url.endsWith('.html') || (!url.includes('.') && !url.startsWith('/@'))) {
          // Rewrite /astar to /pages/astar.html
          if (url === '/astar' || url.startsWith('/astar?')) {
            req.url = '/pages/astar.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /preprocess-smolvlm-500m to /pages/preprocess-smolvlm-500m.html
          else if (url === '/preprocess-smolvlm-500m' || url.startsWith('/preprocess-smolvlm-500m?')) {
            req.url = '/pages/preprocess-smolvlm-500m.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /preprocess-smolvlm-256m to /pages/preprocess-smolvlm-256m.html
          else if (url === '/preprocess-smolvlm-256m' || url.startsWith('/preprocess-smolvlm-256m?')) {
            req.url = '/pages/preprocess-smolvlm-256m.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /image-captioning to /pages/image-captioning.html
          else if (url === '/image-captioning' || url.startsWith('/image-captioning?')) {
            req.url = '/pages/image-captioning.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
          // Rewrite /function-calling to /pages/function-calling.html
          else if (url === '/function-calling' || url.startsWith('/function-calling?')) {
            req.url = '/pages/function-calling.html' + (url.includes('?') ? url.substring(url.indexOf('?')) : '');
          }
        }
        next();
      });
    },
  };
}

// Recursively copy directory and rewrite import.meta.url in JS files to use absolute paths
function copyDir(src: string, dest: string, moduleName: string): void {
  if (!existsSync(src)) {
    return;
  }

  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, moduleName);
    } else if (entry.name.endsWith('.js')) {
      // For JS files, read, rewrite import.meta.url to use absolute paths, then write
      let content = readFileSync(srcPath, 'utf-8');
      
      // Verify file has content before processing
      if (!content || content.length === 0) {
        throw new Error(`Empty file: ${srcPath}`);
      }
      
      // Rewrite: new URL('wasm_module_bg.wasm', import.meta.url)
      // To: '/pkg/wasm_module/wasm_module_bg.wasm'
      // This ensures WASM binaries load correctly regardless of where the script is located
      content = content.replace(
        /new URL\((['"])([^'"]+)\1,\s*import\.meta\.url\)/g,
        (match, quote, wasmPath) => {
          const absolutePath = `/pkg/${moduleName}/${wasmPath}`;
          return quote + absolutePath + quote;
        }
      );
      
      // Verify exports are preserved (check for export statements)
      const exportCount = (content.match(/^export\s+(function|const|let|var|default|{)/gm) || []).length;
      if (exportCount === 0 && entry.name.includes('wasm_')) {
        throw new Error(`File ${destPath} appears to have no exports after processing`);
      }
      
      // Verify file size is reasonable (should be at least 1KB for WASM modules)
      if (content.length < 1000 && entry.name.includes('wasm_') && !entry.name.includes('.d.ts')) {
        throw new Error(`File ${destPath} is suspiciously small (${content.length} bytes). Original: ${srcPath}`);
      }
      
      writeFileSync(destPath, content, 'utf-8');
      
      // Verify the written file
      const writtenContent = readFileSync(destPath, 'utf-8');
      if (writtenContent.length !== content.length) {
        throw new Error(`File write verification failed for ${destPath}. Expected ${content.length} bytes, got ${writtenContent.length}`);
      }
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Plugin to rewrite pkg/ import paths to absolute paths
function rewriteWasmImports(): Plugin {
  return {
    name: 'rewrite-wasm-imports',
    renderChunk(code, chunk) {
      // renderChunk processes chunks after they're generated, including external imports
      // This ensures we catch dynamic imports even when modules are marked external
      // Rewrite relative pkg/ imports to absolute /pkg/ paths
      let modifiedCode = code;
      
      // Pattern 1: import('../../pkg/...') or import("../pkg/...")
      modifiedCode = modifiedCode.replace(
        /import\s*\((['"])(\.\.\/)+pkg\/([^'"]+)\1\)/g,
        (match, quote, dots, path) => {
          return `import(${quote}/pkg/${path}${quote})`;
        }
      );
      
      // Pattern 2: Single level relative ../pkg/...
      modifiedCode = modifiedCode.replace(
        /import\s*\((['"])\.\.\/pkg\/([^'"]+)\1\)/g,
        (match, quote, path) => {
          return `import(${quote}/pkg/${path}${quote})`;
        }
      );
      
      // Pattern 3: Already absolute but might need fixing (shouldn't happen, but just in case)
      // This is a no-op but ensures consistency
      
      return modifiedCode !== code ? { code: modifiedCode, map: null } : null;
    },
    generateBundle(options, bundle) {
      // Also process in generateBundle as fallback for any chunks that weren't processed
      for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
        if (chunkOrAsset.type === 'chunk' && chunkOrAsset.code) {
          let code = chunkOrAsset.code;
          
          // Same patterns as renderChunk
          code = code.replace(
            /import\s*\((['"])(\.\.\/)+pkg\/([^'"]+)\1\)/g,
            (match, quote, dots, path) => {
              return `import(${quote}/pkg/${path}${quote})`;
            }
          );
          
          code = code.replace(
            /import\s*\((['"])\.\.\/pkg\/([^'"]+)\1\)/g,
            (match, quote, path) => {
              return `import(${quote}/pkg/${path}${quote})`;
            }
          );
          
          chunkOrAsset.code = code;
        }
      }
    },
  };
}

// Plugin to copy pkg directory to dist/pkg during build
function copyWasmModules(): Plugin {
  return {
    name: 'copy-wasm-modules',
    writeBundle() {
      // Use writeBundle instead of buildEnd to ensure dist/ exists
      // This hook is called after all files are written to disk
      const pkgDir = resolve(__dirname, 'pkg');
      const distPkgDir = resolve(__dirname, 'dist', 'pkg');

      if (existsSync(pkgDir)) {
        // Remove existing dist/pkg if it exists to ensure clean copy
        if (existsSync(distPkgDir)) {
          rmSync(distPkgDir, { recursive: true, force: true });
        }
        // Copy with base path for import.meta.url rewriting
        const entries = readdirSync(pkgDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const moduleName = entry.name;
            copyDir(
              join(pkgDir, moduleName),
              join(distPkgDir, moduleName),
              moduleName
            );
          }
        }
      }
    },
    buildEnd() {
      // Also run in buildEnd as a fallback to ensure copy happens
      const pkgDir = resolve(__dirname, 'pkg');
      const distPkgDir = resolve(__dirname, 'dist', 'pkg');

      if (existsSync(pkgDir) && !existsSync(distPkgDir)) {
        const entries = readdirSync(pkgDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const moduleName = entry.name;
            copyDir(
              join(pkgDir, moduleName),
              join(distPkgDir, moduleName),
              moduleName
            );
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [devServerRouting(), rewriteWasmImports(), copyWasmModules()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 0, // Prevent WASM from being inlined as data URIs
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        astar: resolve(__dirname, 'pages/astar.html'),
        'preprocess-smolvlm-500m': resolve(__dirname, 'pages/preprocess-smolvlm-500m.html'),
        'preprocess-smolvlm-256m': resolve(__dirname, 'pages/preprocess-smolvlm-256m.html'),
        'image-captioning': resolve(__dirname, 'pages/image-captioning.html'),
        'function-calling': resolve(__dirname, 'pages/function-calling.html'),
      },
      output: {
        format: 'es',
      },
      external: (id) => {
        // Mark pkg/ directory imports as external - they should be loaded at runtime, not bundled
        // This preserves:
        // 1. All exports (no tree-shaking removes calculate, process_text, get_stats)
        // 2. import.meta.url (so WASM binary paths work correctly)
        // The rewriteWasmImports plugin rewrites import paths to absolute /pkg/ paths
        // The copyWasmModules plugin copies files to dist/pkg/ with rewritten WASM paths
        return id.includes('/pkg/') || id.includes('\\pkg\\');
      },
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  optimizeDeps: {
    exclude: ['../pkg'],
  },
  // Ensure WASM files are treated as static assets
  assetsInclude: ['**/*.wasm'],
});

