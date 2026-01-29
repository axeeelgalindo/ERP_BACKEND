// src/lib/authz.js
import fp from "fastify-plugin";

export default fp(async function authz(server) {
  server.decorate("authenticate", async (request, reply) => {
    try {
      const user = await request.jwtVerify(); // payload del JWT

      const empresaId =
        user?.empresa?.id ??
        user?.empresa_id ??
        user?.empresaId ??
        request.headers["x-empresa-id"] ??
        null;

      request.user = user;
      request.scope = {
        empresaId,
        userId: user?.userId ?? user?.sub ?? null,
        rolCodigo: user?.rol?.codigo ?? null,
      };

      // Solo obliga empresa para no-MASTER
      if (!request.scope.empresaId && request.scope.rolCodigo !== "MASTER") {
        return reply.unauthorized("Falta empresa en el contexto");
      }
    } catch (err) {
      request.log.error({ err }, "auth failed");
      return reply.unauthorized("Token inválido o ausente");
    }
  });
});
