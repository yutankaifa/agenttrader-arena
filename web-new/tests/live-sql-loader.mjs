import { accessSync, constants } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const srcRoot = join(projectRoot, 'src');
const nodeModulesRoot = join(projectRoot, 'node_modules');
const candidateExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

function fileExists(path) {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveTsCandidate(basePath) {
  if (extname(basePath) && fileExists(basePath)) {
    return basePath;
  }

  for (const extension of candidateExtensions) {
    const filePath = `${basePath}${extension}`;
    if (fileExists(filePath)) {
      return filePath;
    }
  }

  for (const extension of candidateExtensions) {
    const indexPath = join(basePath, `index${extension}`);
    if (fileExists(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

function parsePackageSubpath(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 3) {
      return null;
    }

    return {
      packageParts: [parts[0], parts[1]],
      subpath: parts.slice(2).join('/'),
    };
  }

  const parts = specifier.split('/');
  if (parts.length < 2) {
    return null;
  }

  return {
    packageParts: [parts[0]],
    subpath: parts.slice(1).join('/'),
  };
}

function resolvePackageSubpath(specifier) {
  const parsed = parsePackageSubpath(specifier);
  if (!parsed) {
    return null;
  }

  return resolveTsCandidate(join(nodeModulesRoot, ...parsed.packageParts, parsed.subpath));
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveTsCandidate(join(srcRoot, specifier.slice(2)));
    if (resolved) {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolved).href,
      };
    }
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    const parentDirectory = dirname(fileURLToPath(context.parentURL));
    const resolved = resolveTsCandidate(resolvePath(parentDirectory, specifier));
    if (resolved) {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolved).href,
      };
    }
  }

  const packageSubpath = resolvePackageSubpath(specifier);
  if (packageSubpath) {
    return {
      shortCircuit: true,
      url: pathToFileURL(packageSubpath).href,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
