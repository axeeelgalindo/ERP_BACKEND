// src/usuarios/routes.js
import {
  // auth & usuarios
  makeLogin, me,
  listUsuarios, getUsuario, createUsuario, updateUsuario, deleteUsuario,
  disableUsuario, restoreUsuario,
  // roles (en el mismo módulo)
  listRoles, getRol, createRol, updateRol, deleteRol,
  disableRol, restoreRol,
} from "./controllers.js";

import {
  // usuarios
  LoginBody, UsuarioCreateBody, UsuarioIdParam, UsuarioQuery, UsuarioUpdateBody,
  // roles
  RolQuery, RolCreateBody, RolUpdateBody, RolIdParam, ForceQuery,
} from "./validators.js";

export default async function usuariosRoutes(server) {
  // 🔧 Airbag de auth (por si aún no está decorado)
  if (typeof server.authenticate !== "function") {
    server.decorate("authenticate", async (request, reply) => {
      try {
        const token = await request.jwtVerify();
        const empresaId =
          token?.empresa?.id ?? token?.empresa_id ?? token?.empresaId ?? null;
        request.scope = {
          empresaId,
          userId: token?.userId ?? token?.sub ?? null,
          rolCodigo: token?.rol?.codigo ?? null,
        };
        if (!request.scope.empresaId) {
          return reply.unauthorized("Falta empresa en el contexto");
        }
      } catch {
        return reply.unauthorized("Token inválido o ausente");
      }
    });
  }

  /* ===== AUTH ===== */
  server.post("/login", { schema: { body: LoginBody } }, makeLogin(server));
  server.get("/me", { onRequest: [server.authenticate] }, me);

  /* ===== USUARIOS ===== */
  server.get("/usuarios", {
    onRequest: [server.authenticate],
    schema: { querystring: UsuarioQuery }, // incluye includeDeleted/force opcional
  }, listUsuarios);

  server.get("/usuarios/:id", {
    onRequest: [server.authenticate],
    schema: { params: UsuarioIdParam },
  }, getUsuario);

  server.post("/usuarios/add", {
    onRequest: [server.authenticate],
    schema: { body: UsuarioCreateBody },
  }, createUsuario);

  server.patch("/usuarios/update/:id", {
    onRequest: [server.authenticate],
    schema: { params: UsuarioIdParam, body: UsuarioUpdateBody },
  }, updateUsuario);

  // Soft delete / restore
  server.patch("/usuarios/disable/:id", {
    onRequest: [server.authenticate],
    schema: { params: UsuarioIdParam },
  }, disableUsuario);

  server.patch("/usuarios/restore/:id", {
    onRequest: [server.authenticate],
    schema: { params: UsuarioIdParam },
  }, restoreUsuario);

  // Hard delete (con ?force opcional si decides usarlo)
  server.delete("/usuarios/delete/:id", {
    onRequest: [server.authenticate],
    schema: { params: UsuarioIdParam, querystring: UsuarioQuery }, // para tomar force si lo implementas
  }, deleteUsuario);

  /* ===== ROLES (mismo módulo) ===== */
  server.get("/roles", {
    onRequest: [server.authenticate],
    schema: { querystring: RolQuery }, // q, includeDeleted
  }, listRoles);

  server.get("/roles/:id", {
    onRequest: [server.authenticate],
    schema: { params: RolIdParam },
  }, getRol);

  server.post("/roles/add", {
    onRequest: [server.authenticate],
    schema: { body: RolCreateBody },
  }, createRol);

  server.patch("/roles/update/:id", {
    onRequest: [server.authenticate],
    schema: { params: RolIdParam, body: RolUpdateBody },
  }, updateRol);

  // Soft delete / restore
  server.patch("/roles/disable/:id", {
    onRequest: [server.authenticate],
    schema: { params: RolIdParam },
  }, disableRol);

  server.patch("/roles/restore/:id", {
    onRequest: [server.authenticate],
    schema: { params: RolIdParam },
  }, restoreRol);

  // Hard delete (con ?force)
  server.delete("/roles/delete/:id", {
    onRequest: [server.authenticate],
    schema: { params: RolIdParam, querystring: ForceQuery },
  }, deleteRol);
}
