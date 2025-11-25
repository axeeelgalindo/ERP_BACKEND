// src/utils/Routes.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP_DIRS = new Set(["lib", "utils", "migrations", "prisma", "node_modules"]);

export default async function Router(server) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);
  const srcDir     = path.resolve(__dirname, ".."); // => .../src

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  // Detecta archivos routes.js existentes (solo minúsculas)
  const routeFiles = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    if (SKIP_DIRS.has(d.name)) continue;

    const f = path.join(srcDir, d.name, "routes.js"); // solo "routes.js"
    if (fs.existsSync(f)) routeFiles.push({ dir: d.name, file: f });
  }

  // Log explícito de lo que se va a registrar
  server.log.info({ found: routeFiles.map(r => r.file) }, "Rutas detectadas: ");

  // Evitar dobles registros si el plugin se llama dos veces por error
  const loaded = new Set();

  for (const { dir, file } of routeFiles) {
    const key = path.resolve(file);
    if (loaded.has(key)) {
      server.log.warn({ file }, "routes.js ya estaba cargado, se omite");
      continue;
    }

    try {
      const mod = await import(pathToFileURL(file).href);
      const plugin = mod.default || mod.routes || mod.plugin;

      if (typeof plugin !== "function") {
        server.log.warn(`⚠️ ${dir}/routes.js no exporta una función`);
        continue;
      }

      await server.register(plugin); // el prefix /api lo aplica server.register(Router, { prefix: '/api' })
      loaded.add(key);
      server.log.info(`Rutas registradas: <${dir.toUpperCase()}>`);
    } catch (err) {
      server.log.error({ err }, `❌ Error al registrar rutas de ${dir}`);
    }
  }
}
